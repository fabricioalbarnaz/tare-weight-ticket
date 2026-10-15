import { and, count, desc, eq, gte, isNull, like, lte, sql } from 'drizzle-orm';
import {
  tickets,
  ticketAuditLog,
  rawEvents,
  adminUsers,
  type RawEventSource,
  type TicketStatus,
} from '../db/schema.js';
import type { Db } from '../db/client.js';
import { calculateNetWeightKg } from '../domain/net-weight.js';

export type Ticket = typeof tickets.$inferSelect;
export type TicketAuditLogEntry = typeof ticketAuditLog.$inferSelect;
export type RawEvent = typeof rawEvents.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;

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
  listTickets(query: ListTicketsQuery): Paginated<Ticket>;
  listUnresolvedEvents(query: ListUnresolvedEventsQuery): Paginated<RawEvent>;
  findAuditLogByTicketId(ticketId: number): TicketAuditLogEntry[];
  findAdminUserByUsername(username: string): AdminUser | undefined;
  /** Timestamp of the most recent raw event received from this source, or null if none ever arrived. */
  findLastEventTimestamp(source: RawEventSource): Date | null;
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

export function createTicketRepository(db: Db): TicketRepository {
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
        .orderBy(desc(tickets.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all();

      const { total } = db.select({ total: count() }).from(tickets).where(where).get() ?? {
        total: 0,
      };

      return { items, total, page, pageSize };
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

    findAdminUserByUsername(username) {
      return db.select().from(adminUsers).where(eq(adminUsers.username, username)).get();
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
      return db
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

      return db
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
      return updated;
    },

    flagAnomaly(input) {
      const now = new Date();
      return db
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
