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
    getStatus() {
      return { connected: true, lastSeenAt: null };
    },
    close() {},
  };
}

function createFakeDriverSignalAdapter(): DriverSignalAdapter {
  return {
    async signalDriver(direction) {
      driverSignalCalls.push(direction);
    },
    getStatus() {
      return { lastSuccessAt: null, lastFailureAt: null };
    },
  };
}

function createFakePrintClient(): PrintClient {
  return {
    async printTicket() {
      printCalls += 1;
      return { success: true };
    },
    async checkHealth() {
      return { reachable: true };
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
    adminSessionSecret: 'a'.repeat(32),
  });
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

/**
 * Builds the `anpr.xml` text the real camera sends (see docs/plans master
 * plan §7 item 3) with just the fields this system reads. `plate: null`
 * omits `licensePlate` entirely, mirroring a camera event that fired with
 * no plate read at all.
 */
function anprXml(options: { plate?: string | null; confidence?: number; deviceId?: string }): string {
  const { plate = 'ABC1234', confidence = 96, deviceId = '88' } = options;
  return `<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <dateTime>2026-01-01T08:00:00.000Z</dateTime>
  <deviceID>${deviceId}</deviceID>
  <ANPR>
    ${plate === null ? '' : `<licensePlate>${plate}</licensePlate>`}
    <confidenceLevel>${confidence}</confidenceLevel>
  </ANPR>
</EventNotificationAlert>`;
}

/**
 * Builds a real `multipart/form-data` body using Node's built-in
 * FormData/Blob/Response (undici serializes proper multipart bytes and
 * hands back the matching boundary in the Content-Type header) — avoids
 * adding a multipart-building dependency just for tests.
 */
async function buildMultipartBody(
  parts: { fieldName: string; content: string; filename?: string; contentType?: string }[],
): Promise<{ body: Buffer; contentType: string }> {
  const formData = new FormData();
  for (const part of parts) {
    const blob = new Blob([part.content], { type: part.contentType ?? 'application/octet-stream' });
    formData.append(part.fieldName, blob, part.filename ?? part.fieldName);
  }
  const response = new Response(formData);
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type');
  if (!contentType) throw new Error('Response did not produce a Content-Type header');
  return { body, contentType };
}

async function postCameraEvent(
  url: '/webhooks/camera/entrance' | '/webhooks/camera/exit',
  options: { plate?: string | null; confidence?: number; deviceId?: string; includeExtraJpegPart?: boolean } = {},
) {
  const parts = [
    { fieldName: 'anpr.xml', content: anprXml(options), contentType: 'application/xml', filename: 'anpr.xml' },
  ];
  if (options.includeExtraJpegPart) {
    parts.push({
      fieldName: 'detectionPicture',
      content: 'not-a-real-jpeg',
      contentType: 'image/jpeg',
      filename: 'GU46962021387411438028',
    });
  }
  const { body, contentType } = await buildMultipartBody(parts);
  return app.inject({ method: 'POST', url, headers: { 'content-type': contentType }, payload: body });
}

function postEntrance(options: Parameters<typeof postCameraEvent>[1] = {}) {
  return postCameraEvent('/webhooks/camera/entrance', options);
}

function postExit(options: Parameters<typeof postCameraEvent>[1] = {}) {
  return postCameraEvent('/webhooks/camera/exit', options);
}

describe('POST /webhooks/camera/entrance', () => {
  it('opens a ticket using the scale reading', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };

    const response = await postEntrance({ plate: 'ABC1234' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.kind).toBe('ticket_opened');
    expect(typeof body.ticketId).toBe('number');

    const ticket = repo.findOpenByPlate('ABC1234');
    expect(ticket?.entryWeightKg).toBe(20000);
    expect(ticket?.status).toBe('OPEN');
    expect(ticket?.entryCameraId).toBe('88');
    expect(driverSignalCalls).toEqual(['in']);
  });

  it('ignores an extra JPEG-like part instead of erroring', async () => {
    const response = await postEntrance({ plate: 'JPEG001', includeExtraJpegPart: true });

    expect(response.statusCode).toBe(200);
    expect(response.json().kind).toBe('ticket_opened');
  });

  it('overwrites the entry on a retrigger for the same open ticket', async () => {
    nextScaleReading = { weightKg: 19000, weightCaptureFailed: false };
    const first = await postEntrance({ plate: 'RET1234' });

    nextScaleReading = { weightKg: 19500, weightCaptureFailed: false };
    const second = await postEntrance({ plate: 'RET1234' });

    expect(second.json().kind).toBe('ticket_retriggered');
    expect(second.json().ticketId).toBe(first.json().ticketId);
    expect(repo.findOpenByPlate('RET1234')?.entryWeightKg).toBe(19500);
  });

  it('records entryCaptureFailed when the scale times out, and withholds the driver signal', async () => {
    nextScaleReading = { weightKg: null, weightCaptureFailed: true };

    await postEntrance({ plate: 'TIME001' });

    const ticket = repo.findOpenByPlate('TIME001');
    expect(ticket?.entryWeightKg).toBeNull();
    expect(ticket?.entryCaptureFailed).toBe(true);
    // Never auto-release without a captured weight — the truck stays held
    // until an operator corrects the record (manual release button, not
    // modeled here).
    expect(driverSignalCalls).toEqual([]);
  });

  it('creates no ticket when the plate is missing from the payload', async () => {
    const response = await postEntrance({ plate: null });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
    // The truck was still on the scale — it must still get the move-on signal.
    expect(driverSignalCalls).toEqual(['in']);
  });

  it('creates no ticket when confidence is below the reliability threshold', async () => {
    const response = await postEntrance({ plate: 'LOWCONF', confidence: 50 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
  });

  it('creates no ticket when the plate is shorter than expected (likely truncated read)', async () => {
    const response = await postEntrance({ plate: 'V0694', confidence: 99 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
  });

  it('rejects a request with no anpr.xml part', async () => {
    const { body, contentType } = await buildMultipartBody([
      { fieldName: 'somethingElse', content: 'irrelevant' },
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/camera/entrance',
      headers: { 'content-type': contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an anpr.xml part missing required fields', async () => {
    const { body, contentType } = await buildMultipartBody([
      { fieldName: 'anpr.xml', content: '<EventNotificationAlert></EventNotificationAlert>', filename: 'anpr.xml' },
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/camera/entrance',
      headers: { 'content-type': contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /webhooks/camera/exit', () => {
  it('closes the open ticket and computes net weight', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'LOAD001' });

    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    const exit = await postExit({ plate: 'LOAD001' });

    expect(exit.json().kind).toBe('ticket_closed');
    const ticket = repo.findById(exit.json().ticketId);
    expect(ticket?.status).toBe('CLOSED');
    expect(ticket?.netWeightKg).toBe(12000);
    expect(driverSignalCalls).toEqual(['in', 'out']);
    expect(printCalls).toBe(1);
    expect(ticket?.printedAt).not.toBeNull();
  });

  it('flags an anomaly when there is no open ticket for the plate', async () => {
    const response = await postExit({ plate: 'NOENTR1' });

    expect(response.json().kind).toBe('anomaly_flagged');
    const ticket = repo.findById(response.json().ticketId);
    expect(ticket?.status).toBe('ANOMALY');
    expect(printCalls).toBe(0);
  });

  it('leaves the ticket OPEN and withholds the driver signal when the exit scale read times out', async () => {
    nextScaleReading = { weightKg: 15000, weightCaptureFailed: false };
    await postEntrance({ plate: 'EXITFAI' });

    nextScaleReading = { weightKg: null, weightCaptureFailed: true };
    const exit = await postExit({ plate: 'EXITFAI' });

    // Never auto-close/release without a captured weight — there is no way
    // to re-weigh the truck once it has left the scale, so the ticket is
    // left OPEN, waiting for a later successful exit read or a manual
    // admin correction (PATCH /tickets/:id/exit already closes an OPEN
    // ticket, unchanged).
    expect(exit.json().kind).toBe('exit_capture_pending');
    const ticket = repo.findById(exit.json().ticketId);
    expect(ticket?.status).toBe('OPEN');
    expect(ticket?.exitCaptureFailed).toBe(false);
    expect(ticket?.netWeightKg).toBeNull();
    expect(driverSignalCalls).toEqual(['in']);
    expect(printCalls).toBe(0);
  });

  it('creates no ticket when the plate is missing from the payload', async () => {
    const response = await postExit({ plate: null });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
  });
});
