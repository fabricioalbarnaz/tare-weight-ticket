import { and, eq, sql } from 'drizzle-orm';
import { tickets, ticketAuditLog, rawEvents, type RawEventSource } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { calculateNetWeightKg } from '../domain/net-weight.js';

export type Ticket = typeof tickets.$inferSelect;

export interface CreateTicketInput {
  plate: string;
  entryAt: Date;
  entryWeightKg: number | null;
  entryCameraId: string | null;
  entryCaptureFailed: boolean;
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
  create(input: CreateTicketInput): Ticket;
  updateEntry(ticketId: number, input: UpdateEntryInput): Ticket;
  close(ticketId: number, input: CloseTicketInput): Ticket;
  flagAnomaly(input: FlagAnomalyInput): Ticket;
  appendAuditLog(ticketId: number, actor: string, action: string, payload?: unknown): void;
  recordRawEvent(source: RawEventSource, rawPayload: unknown, linkedTicketId?: number): void;
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
  };
}
