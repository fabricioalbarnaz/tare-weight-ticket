import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, type Db } from '../db/client.js';
import { createTicketRepository, type TicketRepository } from '../tickets/repository.js';
import type { ScaleClient } from '../scale/types.js';
import type { DriverSignalAdapter } from '../driver-signal/types.js';
import type { PrintClient } from './print-client.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;
let app: FastifyInstance;
let printTicketResult: { success: boolean; error?: string };
let printCalls: number;

function createFakeScaleClient(): ScaleClient {
  return {
    async readStableWeight() {
      return { weightKg: 0, weightCaptureFailed: true };
    },
    close() {},
  };
}

function createFakeDriverSignalAdapter(): DriverSignalAdapter {
  return { async signalDriver() {} };
}

function createFakePrintClient(): PrintClient {
  return {
    async printTicket() {
      printCalls += 1;
      return printTicketResult;
    },
  };
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-print-routes-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createTicketRepository(db);
  printTicketResult = { success: true };
  printCalls = 0;
  app = buildApp({
    db,
    scaleClient: createFakeScaleClient(),
    driverSignalAdapter: createFakeDriverSignalAdapter(),
    printClient: createFakePrintClient(),
  });
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

function createClosedTicket(plate: string) {
  const created = repo.create({
    plate,
    entryAt: new Date(),
    entryWeightKg: 20000,
    entryCameraId: 'cam-1',
    entryCaptureFailed: false,
  });
  return repo.close(created.id, {
    exitAt: new Date(),
    exitWeightKg: 8000,
    exitCameraId: 'cam-2',
    exitCaptureFailed: false,
  });
}

describe('POST /tickets/:id/reprint', () => {
  it('reprints a CLOSED ticket', async () => {
    const ticket = createClosedTicket('REPRINT1');

    const response = await app.inject({ method: 'POST', url: `/tickets/${ticket.id}/reprint` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(printCalls).toBe(1);
  });

  it('reports failure (200 with success: false) for a ticket that does not exist', async () => {
    const response = await app.inject({ method: 'POST', url: '/tickets/999999/reprint' });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(false);
  });

  it('reports failure for a non-numeric ticket id', async () => {
    const response = await app.inject({ method: 'POST', url: '/tickets/not-a-number/reprint' });

    expect(response.statusCode).toBe(400);
  });

  it('reports the print bridge error when the print fails', async () => {
    printTicketResult = { success: false, error: 'printer offline' };
    const ticket = createClosedTicket('REPRINT2');

    const response = await app.inject({ method: 'POST', url: `/tickets/${ticket.id}/reprint` });

    expect(response.json()).toEqual({ success: false, error: 'printer offline' });
  });
});
