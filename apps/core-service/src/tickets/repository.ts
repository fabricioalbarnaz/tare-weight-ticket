import { and, count, desc, eq, gte, inArray, isNotNull, isNull, like, lte, sql } from 'drizzle-orm';
import {
  tickets,
  ticketAuditLog,
  rawEvents,
  type RawEventSource,
  type TicketStatus,
} from '../db/schema.js';
import type { Db } from '../db/client.js';
import { calculateNetWeightKg } from '../domain/net-weight.js';
import { createTicketEvents, type TicketEvents } from './ticket-events.js';

export type Ticket = typeof tickets.$inferSelect;
export type TicketAuditLogEntry = typeof ticketAuditLog.$inferSelect;
export type RawEvent = typeof rawEvents.$inferSelect;

/**
 * A ticket as returned by `listTickets`, flagged when any of its audit log
 * entries recorded a scale read that needed more than one attempt — see
 * docs/plans/2026-10-31-scale-weight-attribution-fix-plan.md. Not a
 * confirmed error, just worth a human glance: a truck can legitimately take
 * a couple of retries to settle.
 */
export interface TicketListItem extends Ticket {
  suspectWeight: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListTicketsQuery {
  status?: TicketStatus;
  search?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface ListUnresolvedEventsQuery {
  source?: RawEventSource;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;

export interface CreateTicketInput {
  plate: string;
  entryAt: Date;
  entryWeightKg: number | null;
  entryCameraId: string | null;
  entryCaptureFailed: boolean;
  /** True for tickets created from scratch by an admin (master plan §3.4 manual-create flow). Defaults to false. */
  createdByAdmin?: boolean;
}

export interface UpdateEntryInput {
  entryAt: Date;
  entryWeightKg: number | null;
  entryCameraId: string | null;
  entryCaptureFailed: boolean;
}

export interface CloseTicketInput {
  exitAt: Date;
  exitWeightKg: number | null;
  exitCameraId: string | null;
  exitCaptureFailed: boolean;
}

export interface FlagAnomalyInput {
  plate: string;
  exitAt: Date;
  exitWeightKg: number | null;
  exitCameraId: string | null;
  exitCaptureFailed: boolean;
}

export interface TicketRepository {
  findOpenByPlate(plate: string): Ticket | undefined;
  findById(ticketId: number): Ticket | undefined;
  listTickets(query: ListTicketsQuery): Paginated<TicketListItem>;
  listUnresolvedEvents(query: ListUnresolvedEventsQuery): Paginated<RawEvent>;
  findAuditLogByTicketId(ticketId: number): TicketAuditLogEntry[];
  /** Timestamp of the most recent raw event received from this source, or null if none ever arrived. */
  findLastEventTimestamp(source: RawEventSource): Date | null;
  /**
   * `exitAt` of the most recently closed ticket (any closing path,
   * including an internal truck's tare-based close), or null if no ticket
   * has ever closed. Deliberately not scoped by plate — anchors the camera
   * post-release debounce (see
   * docs/plans/2026-11-03-camera-post-release-debounce-plan.md), which
   * exists precisely because a truck rollback can trigger a camera reading
   * the *other* plate of the same articulated rig (tractor vs. trailer).
   */
  findMostRecentExitAt(): Date | null;
  create(input: CreateTicketInput): Ticket;
  updateEntry(ticketId: number, input: UpdateEntryInput): Ticket;
  close(ticketId: number, input: CloseTicketInput): Ticket;
  /** Corrects exit data on an already-CLOSED ticket (admin fix-after-the-fact), recomputing net weight. Does not change status. */
  correctExit(ticketId: number, input: CloseTicketInput): Ticket;
  markPrinted(ticketId: number, printedAt: Date): Ticket;
  flagAnomaly(input: FlagAnomalyInput): Ticket;
  appendAuditLog(ticketId: number, actor: string, action: string, payload?: unknown): void;
  recordRawEvent(source: RawEventSource, rawPayload: unknown, linkedTicketId?: number): void;
  /**
   * Runs `fn` inside a single SQLite transaction: all repository calls made
   * inside it (via this same repository instance) commit together, or roll
   * back together if `fn` throws. Synchronous, matching better-sqlite3.
   */
  transaction<T>(fn: () => T): T;
}

export function createTicketRepository(db: Db, events: TicketEvents = createTicketEvents()): TicketRepository {
  function nextTicketNumber(): number {
    const row = db.get<{ maxNumber: number | null }>(
      sql`SELECT MAX(${tickets.ticketNumber}) as maxNumber FROM ${tickets}`,
    );
    return (row?.maxNumber ?? 0) + 1;
  }

  function requireById(ticketId: number): Ticket {
    const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found`);
    }
    return ticket;
  }

  /**
   * Ticket ids among `ticketIds` with at least one audit log entry whose
   * payload recorded `attemptsUsed > 1` (a scale read that only resolved
   * after a retry — see docs/plans/2026-10-31-scale-weight-attribution-fix-plan.md).
   * Payload is a loosely-typed JSON blob (`appendAuditLog`'s `payload?: unknown`),
   * so this parses defensively rather than relying on a DB-level JSON query.
   */
  function findSuspectTicketIds(ticketIds: number[]): Set<number> {
    const entries = db
      .select({ ticketId: ticketAuditLog.ticketId, payload: ticketAuditLog.payload })
      .from(ticketAuditLog)
      .where(inArray(ticketAuditLog.ticketId, ticketIds))
      .all();

    const suspectIds = new Set<number>();
    for (const entry of entries) {
      if (!entry.payload) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.payload);
      } catch {
        continue;
      }
      const attemptsUsed = (parsed as { attemptsUsed?: unknown } | null)?.attemptsUsed;
      if (typeof attemptsUsed === 'number' && attemptsUsed > 1) {
        suspectIds.add(entry.ticketId);
      }
    }
    return suspectIds;
  }

  return {
    findOpenByPlate(plate) {
      return db
        .select()
        .from(tickets)
        .where(and(eq(tickets.plate, plate), eq(tickets.status, 'OPEN')))
        .get();
    },

    findById(ticketId) {
      return db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    },

    listTickets(query) {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

      const conditions = [];
      if (query.status) {
        conditions.push(eq(tickets.status, query.status));
      }
      if (query.search) {
        conditions.push(like(sql`upper(${tickets.plate})`, `%${query.search.toUpperCase()}%`));
      }
      if (query.from) {
        conditions.push(gte(tickets.createdAt, query.from));
      }
      if (query.to) {
        conditions.push(lte(tickets.createdAt, query.to));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const items = db
        .select()
        .from(tickets)
        .where(where)
        .orderBy(desc(tickets.updatedAt), desc(tickets.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all();

      const { total } = db.select({ total: count() }).from(tickets).where(where).get() ?? {
        total: 0,
      };

      const suspectTicketIds = items.length > 0 ? findSuspectTicketIds(items.map((t) => t.id)) : new Set<number>();
      const itemsWithSuspectFlag = items.map((item) => ({
        ...item,
        suspectWeight: suspectTicketIds.has(item.id),
      }));

      return { items: itemsWithSuspectFlag, total, page, pageSize };
    },

    listUnresolvedEvents(query) {
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

      const conditions = [isNull(rawEvents.linkedTicketId)];
      if (query.source) {
        conditions.push(eq(rawEvents.source, query.source));
      }
      const where = and(...conditions);

      const items = db
        .select()
        .from(rawEvents)
        .where(where)
        .orderBy(desc(rawEvents.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all();

      const { total } = db.select({ total: count() }).from(rawEvents).where(where).get() ?? {
        total: 0,
      };

      return { items, total, page, pageSize };
    },

    findAuditLogByTicketId(ticketId) {
      return db
        .select()
        .from(ticketAuditLog)
        .where(eq(ticketAuditLog.ticketId, ticketId))
        .orderBy(desc(ticketAuditLog.id))
        .all();
    },

    findMostRecentExitAt() {
      const row = db
        .select({ exitAt: tickets.exitAt })
        .from(tickets)
        .where(isNotNull(tickets.exitAt))
        .orderBy(desc(tickets.exitAt))
        .limit(1)
        .get();
      return row?.exitAt ?? null;
    },

    findLastEventTimestamp(source) {
      const row = db
        .select()
        .from(rawEvents)
        .where(eq(rawEvents.source, source))
        .orderBy(desc(rawEvents.id))
        .limit(1)
        .get();
      return row?.receivedAt ?? null;
    },

    create(input) {
      const now = new Date();
      const created = db
        .insert(tickets)
        .values({
          ticketNumber: nextTicketNumber(),
          plate: input.plate,
          status: 'OPEN',
          entryAt: input.entryAt,
          entryWeightKg: input.entryWeightKg,
          entryCameraId: input.entryCameraId,
          entryCaptureFailed: input.entryCaptureFailed,
          createdByAdmin: input.createdByAdmin ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      events.emitChanged(created);
      return created;
    },

    updateEntry(ticketId, input) {
      const updated = db
        .update(tickets)
        .set({
          entryAt: input.entryAt,
          entryWeightKg: input.entryWeightKg,
          entryCameraId: input.entryCameraId,
          entryCaptureFailed: input.entryCaptureFailed,
          updatedAt: new Date(),
        })
        .where(and(eq(tickets.id, ticketId), eq(tickets.status, 'OPEN')))
        .returning()
        .get();

      if (!updated) {
        throw new Error(`Cannot update entry for ticket ${ticketId}: not found or not OPEN`);
      }
      events.emitChanged(updated);
      return updated;
    },

    close(ticketId, input) {
      const current = requireById(ticketId);
      const netWeightKg =
        current.entryWeightKg !== null && input.exitWeightKg !== null
          ? calculateNetWeightKg(current.entryWeightKg, input.exitWeightKg)
          : null;

      const closed = db
        .update(tickets)
        .set({
          status: 'CLOSED',
          exitAt: input.exitAt,
          exitWeightKg: input.exitWeightKg,
          exitCameraId: input.exitCameraId,
          exitCaptureFailed: input.exitCaptureFailed,
          netWeightKg,
          updatedAt: new Date(),
        })
        .where(and(eq(tickets.id, ticketId), eq(tickets.status, 'OPEN')))
        .returning()
        .get();

      if (!closed) {
        throw new Error(`Cannot close ticket ${ticketId}: not found or not OPEN`);
      }
      events.emitChanged(closed);
      return closed;
    },

    correctExit(ticketId, input) {
      const current = requireById(ticketId);
      if (current.status !== 'CLOSED') {
        throw new Error(`Cannot correct exit for ticket ${ticketId}: not found or not CLOSED`);
      }

      const netWeightKg =
        current.entryWeightKg !== null && input.exitWeightKg !== null
          ? calculateNetWeightKg(current.entryWeightKg, input.exitWeightKg)
          : null;

      const corrected = db
        .update(tickets)
        .set({
          exitAt: input.exitAt,
          exitWeightKg: input.exitWeightKg,
          exitCameraId: input.exitCameraId,
          exitCaptureFailed: input.exitCaptureFailed,
          netWeightKg,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticketId))
        .returning()
        .get()!;
      events.emitChanged(corrected);
      return corrected;
    },

    markPrinted(ticketId, printedAt) {
      const updated = db
        .update(tickets)
        .set({ printedAt, updatedAt: new Date() })
        .where(and(eq(tickets.id, ticketId), eq(tickets.status, 'CLOSED')))
        .returning()
        .get();

      if (!updated) {
        throw new Error(`Cannot mark ticket ${ticketId} as printed: not found or not CLOSED`);
      }
      events.emitChanged(updated);
      return updated;
    },

    flagAnomaly(input) {
      const now = new Date();
      const flagged = db
        .insert(tickets)
        .values({
          ticketNumber: nextTicketNumber(),
          plate: input.plate,
          status: 'ANOMALY',
          exitAt: input.exitAt,
          exitWeightKg: input.exitWeightKg,
          exitCameraId: input.exitCameraId,
          exitCaptureFailed: input.exitCaptureFailed,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      events.emitChanged(flagged);
      return flagged;
    },

    appendAuditLog(ticketId, actor, action, payload) {
      db.insert(ticketAuditLog)
        .values({
          ticketId,
          actor,
          action,
          payload: payload !== undefined ? JSON.stringify(payload) : null,
          createdAt: new Date(),
        })
        .run();
    },

    recordRawEvent(source, rawPayload, linkedTicketId) {
      db.insert(rawEvents)
        .values({
          source,
          rawPayload: JSON.stringify(rawPayload),
          receivedAt: new Date(),
          linkedTicketId: linkedTicketId ?? null,
        })
        .run();
    },

    transaction(fn) {
      return db.transaction(() => fn());
    },
  };
}
