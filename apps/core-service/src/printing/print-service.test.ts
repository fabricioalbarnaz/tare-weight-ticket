import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PrintTicketRequest, PrintTicketResponse } from '@tare/shared';
import { createDb, type Db } from '../db/client.js';
import { ticketAuditLog } from '../db/schema.js';
import { createTicketRepository, type Ticket, type TicketRepository } from '../tickets/repository.js';
import type { PrintClient } from './print-client.js';
import { createPrintService, type PrintService } from './print-service.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;
let printCalls: PrintTicketRequest[];
let nextPrintResult: PrintTicketResponse;
let printService: PrintService;

function createFakePrintClient(): PrintClient {
  return {
    async printTicket(ticket) {
      printCalls.push(ticket);
      return nextPrintResult;
    },
    async checkHealth() {
      return { reachable: true };
    },
  };
}

function auditActionsFor(ticketId: number): string[] {
  return db
    .select()
    .from(ticketAuditLog)
    .where(eq(ticketAuditLog.ticketId, ticketId))
    .all()
    .map((row) => row.action);
}

function createClosedTicket(plate: string): Ticket {
  const created = repo.create({
    plate,
    entryAt: new Date('2026-01-01T08:00:00Z'),
    entryWeightKg: 20000,
    entryCameraId: 'cam-1',
    entryCaptureFailed: false,
  });
  return repo.close(created.id, {
    exitAt: new Date('2026-01-01T09:00:00Z'),
    exitWeightKg: 8000,
    exitCameraId: 'cam-2',
    exitCaptureFailed: false,
  });
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-print-service-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createTicketRepository(db);
  printCalls = [];
  nextPrintResult = { success: true };
  printService = createPrintService(repo, createFakePrintClient());
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('printIfNeeded', () => {
  it('prints a CLOSED ticket that has not been printed yet, marking printedAt', async () => {
    const ticket = createClosedTicket('PRINT001');

    await printService.printIfNeeded(ticket);

    expect(printCalls).toHaveLength(1);
    expect(printCalls[0]).toMatchObject({ ticketId: ticket.id, plate: 'PRINT001', netWeightKg: 12000 });
    expect(repo.findById(ticket.id)?.printedAt).not.toBeNull();
    expect(auditActionsFor(ticket.id)).toContain('ticket_printed');
  });

  it('does nothing when the ticket is not CLOSED', async () => {
    const open = repo.create({
      plate: 'OPEN0001',
      entryAt: new Date(),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    await printService.printIfNeeded(open);

    expect(printCalls).toHaveLength(0);
  });

  it('does nothing when the ticket was already printed (single-print guarantee)', async () => {
    const ticket = createClosedTicket('PRINT002');
    await printService.printIfNeeded(ticket);
    printCalls = [];

    const reloaded = repo.findById(ticket.id)!;
    await printService.printIfNeeded(reloaded);

    expect(printCalls).toHaveLength(0);
  });

  it('logs a failure audit entry and leaves printedAt null when the print bridge fails', async () => {
    nextPrintResult = { success: false, error: 'printer offline' };
    const ticket = createClosedTicket('PRINT003');

    await printService.printIfNeeded(ticket);

    expect(repo.findById(ticket.id)?.printedAt).toBeNull();
    expect(auditActionsFor(ticket.id)).toContain('ticket_print_failed');
  });
});

describe('reprint', () => {
  it('forces a print even if the ticket was already printed, logging it as a reprint', async () => {
    const ticket = createClosedTicket('REPRINT1');
    await printService.printIfNeeded(ticket);
    printCalls = [];

    const result = await printService.reprint(ticket.id);

    expect(result).toEqual({ success: true });
    expect(printCalls).toHaveLength(1);
    expect(auditActionsFor(ticket.id)).toEqual(['ticket_printed', 'ticket_reprinted']);
  });

  it('returns a failure result when the ticket does not exist', async () => {
    const result = await printService.reprint(999999);

    expect(result.success).toBe(false);
  });

  it('returns a failure result when the ticket is not CLOSED', async () => {
    const open = repo.create({
      plate: 'OPEN0002',
      entryAt: new Date(),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    const result = await printService.reprint(open.id);

    expect(result.success).toBe(false);
    expect(printCalls).toHaveLength(0);
  });
});
