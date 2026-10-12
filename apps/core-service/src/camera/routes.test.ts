import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, type Db } from '../db/client.js';
import { createTicketRepository, type TicketRepository } from '../tickets/repository.js';
import type { ScaleClient, ScaleReadResult } from '../scale/types.js';
import type { DriverSignalAdapter, DriverSignalDirection } from '../driver-signal/types.js';
import type { PrintClient } from '../printing/print-client.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;
let app: FastifyInstance;
let nextScaleReading: ScaleReadResult;
let driverSignalCalls: DriverSignalDirection[];
let printCalls: number;

function createFakeScaleClient(): ScaleClient {
  return {
    async readStableWeight() {
      return nextScaleReading;
    },
    close() {},
  };
}

function createFakeDriverSignalAdapter(): DriverSignalAdapter {
  return {
    async signalDriver(direction) {
      driverSignalCalls.push(direction);
    },
  };
}

function createFakePrintClient(): PrintClient {
  return {
    async printTicket() {
      printCalls += 1;
      return { success: true };
    },
  };
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-routes-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createTicketRepository(db);
  nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
  driverSignalCalls = [];
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

function postEntrance(body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/webhooks/camera/entrance', payload: body });
}

function postExit(body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/webhooks/camera/exit', payload: body });
}

describe('POST /webhooks/camera/entrance', () => {
  it('opens a ticket using the scale reading', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };

    const response = await postEntrance({ plate: 'ABC1234', cameraId: 'cam-entrance-1' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.kind).toBe('ticket_opened');
    expect(typeof body.ticketId).toBe('number');

    const ticket = repo.findOpenByPlate('ABC1234');
    expect(ticket?.entryWeightKg).toBe(20000);
    expect(ticket?.status).toBe('OPEN');
    expect(driverSignalCalls).toEqual(['in']);
  });

  it('overwrites the entry on a retrigger for the same open ticket', async () => {
    nextScaleReading = { weightKg: 19000, weightCaptureFailed: false };
    const first = await postEntrance({ plate: 'RET1234', cameraId: 'cam-entrance-1' });

    nextScaleReading = { weightKg: 19500, weightCaptureFailed: false };
    const second = await postEntrance({ plate: 'RET1234', cameraId: 'cam-entrance-1' });

    expect(second.json().kind).toBe('ticket_retriggered');
    expect(second.json().ticketId).toBe(first.json().ticketId);
    expect(repo.findOpenByPlate('RET1234')?.entryWeightKg).toBe(19500);
  });

  it('records entryCaptureFailed when the scale times out', async () => {
    nextScaleReading = { weightKg: null, weightCaptureFailed: true };

    await postEntrance({ plate: 'TIME0001', cameraId: 'cam-entrance-1' });

    const ticket = repo.findOpenByPlate('TIME0001');
    expect(ticket?.entryWeightKg).toBeNull();
    expect(ticket?.entryCaptureFailed).toBe(true);
  });

  it('creates no ticket when the plate is unreadable', async () => {
    const response = await postEntrance({ plate: null, cameraId: 'cam-entrance-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
    // The truck was still on the scale — it must still get the move-on signal.
    expect(driverSignalCalls).toEqual(['in']);
  });

  it('rejects a payload missing cameraId', async () => {
    const response = await postEntrance({ plate: 'ABC1234' });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /webhooks/camera/exit', () => {
  it('closes the open ticket and computes net weight', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'LOAD0001', cameraId: 'cam-entrance-1' });

    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    const exit = await postExit({ plate: 'LOAD0001', cameraId: 'cam-exit-1' });

    expect(exit.json().kind).toBe('ticket_closed');
    const ticket = repo.findById(exit.json().ticketId);
    expect(ticket?.status).toBe('CLOSED');
    expect(ticket?.netWeightKg).toBe(12000);
    expect(driverSignalCalls).toEqual(['in', 'out']);
    expect(printCalls).toBe(1);
    expect(ticket?.printedAt).not.toBeNull();
  });

  it('flags an anomaly when there is no open ticket for the plate', async () => {
    const response = await postExit({ plate: 'NOENTRY1', cameraId: 'cam-exit-1' });

    expect(response.json().kind).toBe('anomaly_flagged');
    const ticket = repo.findById(response.json().ticketId);
    expect(ticket?.status).toBe('ANOMALY');
    expect(printCalls).toBe(0);
  });

  it('records exitCaptureFailed when the scale times out', async () => {
    nextScaleReading = { weightKg: 15000, weightCaptureFailed: false };
    await postEntrance({ plate: 'EXITFAIL', cameraId: 'cam-entrance-1' });

    nextScaleReading = { weightKg: null, weightCaptureFailed: true };
    const exit = await postExit({ plate: 'EXITFAIL', cameraId: 'cam-exit-1' });

    const ticket = repo.findById(exit.json().ticketId);
    expect(ticket?.status).toBe('CLOSED');
    expect(ticket?.exitCaptureFailed).toBe(true);
    expect(ticket?.netWeightKg).toBeNull();
  });

  it('creates no ticket when the plate is unreadable', async () => {
    const response = await postExit({ plate: '', cameraId: 'cam-exit-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
  });
});
