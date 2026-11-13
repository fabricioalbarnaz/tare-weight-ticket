import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, type Db } from '../db/client.js';
import { createTicketRepository, type TicketRepository } from '../tickets/repository.js';
import { createTruckRepository, type TruckRepository } from '../trucks/repository.js';
import type { ScaleClient, ScaleReadContext, ScaleReadResult } from '../scale/types.js';
import { createTcpScaleClient } from '../scale/tcp-client.js';
import { createPlaceholderFrameParser } from '../scale/placeholder-frame-parser.js';
import { startMockScaleServer, type MockScaleServer } from '../scale/mock-scale-server.js';
import type { DriverSignalAdapter, DriverSignalDirection } from '../driver-signal/types.js';
import type { PrintClient } from '../printing/print-client.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;
let truckRepo: TruckRepository;
let app: FastifyInstance;
let nextScaleReading: ScaleReadResult;
/** Artificial delay before readStableWeight resolves — see the weighing-finished-timestamp tests below. */
let scaleReadDelayMs: number;
let driverSignalCalls: DriverSignalDirection[];
let printCalls: number;
/** Every context the fake scale client was called with, in order. */
let scaleContexts: (ScaleReadContext | undefined)[];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeScaleClient(): ScaleClient {
  return {
    async readStableWeight(context) {
      scaleContexts.push(context);
      if (scaleReadDelayMs > 0) await delay(scaleReadDelayMs);
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
  truckRepo = createTruckRepository(db);
  nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
  scaleReadDelayMs = 0;
  driverSignalCalls = [];
  printCalls = 0;
  scaleContexts = [];
  app = buildApp({
    db,
    scaleClient: createFakeScaleClient(),
    driverSignalAdapter: createFakeDriverSignalAdapter(),
    printClient: createFakePrintClient(),
    adminSessionSecret: 'a'.repeat(32),
  });
});

afterEach(() => {
  // A couple of tests close `sqlite` themselves to simulate a DB write
  // failure — tolerate the double-close here instead of erroring.
  try {
    sqlite.close();
  } catch {
    // already closed
  }
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
function anprXml(options: { plate?: string | null; confidence?: number; deviceId?: string; charBelieve?: string }): string {
  const { plate = 'ABC1234', confidence = 96, deviceId = '88', charBelieve } = options;
  return `<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <dateTime>2026-01-01T08:00:00.000Z</dateTime>
  <deviceID>${deviceId}</deviceID>
  <ANPR>
    ${plate === null ? '' : `<licensePlate>${plate}</licensePlate>`}
    <confidenceLevel>${confidence}</confidenceLevel>
    ${charBelieve === undefined ? '' : `<plateCharBelieve>${charBelieve}</plateCharBelieve>`}
  </ANPR>
</EventNotificationAlert>`;
}

/** Every camera raw event recorded so far, payload parsed. */
function cameraRawEvents(): { source: string; payload: Record<string, unknown> }[] {
  return (
    sqlite
      .prepare("select source, raw_payload from raw_events where source like 'camera_%' order by id")
      .all() as { source: string; raw_payload: string }[]
  ).map((row) => ({ source: row.source, payload: JSON.parse(row.raw_payload) as Record<string, unknown> }));
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
  options: {
    plate?: string | null;
    confidence?: number;
    deviceId?: string;
    charBelieve?: string;
    includeExtraJpegPart?: boolean;
  } = {},
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

  it('sets entryAt to when the scale read finishes, not when the webhook was received', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    scaleReadDelayMs = 100;

    const beforeRequest = Date.now();
    await postEntrance({ plate: 'WGHT001' });
    const afterRequest = Date.now();

    const ticket = repo.findOpenByPlate('WGHT001');
    const entryAtMs = ticket?.entryAt?.getTime() ?? 0;
    // entryAt must land after the scale's artificial delay, not at webhook
    // receipt (which would be ~0ms into the request) — see
    // docs/plans/2026-11-04-ticket-timestamp-from-weighing-plan.md.
    expect(entryAtMs).toBeGreaterThanOrEqual(beforeRequest + scaleReadDelayMs);
    expect(entryAtMs).toBeLessThanOrEqual(afterRequest);
  });

  it('ignores an extra JPEG-like part instead of erroring', async () => {
    const response = await postEntrance({ plate: 'JPEG001', includeExtraJpegPart: true });

    expect(response.statusCode).toBe(200);
    expect(response.json().kind).toBe('ticket_opened');
  });

  it('overwrites the entry on a retrigger for the same open ticket', async () => {
    nextScaleReading = { weightKg: 19000, weightCaptureFailed: false };
    const first = await postEntrance({ plate: 'RET1234' });

    // Backdate past the duplicate-plate debounce window (default 2min —
    // see docs/plans/2026-11-12-camera-duplicate-plate-debounce-plan.md),
    // which otherwise discards a same-plate/same-direction retrigger this
    // soon instead of reaching the last-write-wins rule this test covers.
    const ticket = repo.findOpenByPlate('RET1234')!;
    repo.updateEntry(ticket.id, {
      entryAt: new Date(Date.now() - 130000),
      entryWeightKg: ticket.entryWeightKg,
      entryCameraId: ticket.entryCameraId,
      entryCaptureFailed: false,
    });

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

  it('creates no ticket and withholds the driver signal when the plate is missing from the payload', async () => {
    const response = await postEntrance({ plate: null });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
    // With no readable plate, a captured weight can never be attributed to
    // a truck afterward — the truck must stay held for an operator, not be
    // released (see docs/plans/2026-11-03-withhold-signal-on-unreadable-plate-plan.md).
    expect(driverSignalCalls).toEqual([]);
  });

  it('creates no ticket and withholds the driver signal when confidence is below the reliability threshold', async () => {
    const response = await postEntrance({ plate: 'LOWCONF', confidence: 50 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
    expect(driverSignalCalls).toEqual([]);
  });

  it('creates no ticket and withholds the driver signal when the plate is shorter than expected (likely truncated read)', async () => {
    const response = await postEntrance({ plate: 'V0694', confidence: 99 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
    expect(driverSignalCalls).toEqual([]);
  });

  it('does not signal the driver when the ticket write fails', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    // Forces repo.create/transaction to throw, simulating a DB write
    // failure — the driver must never be released without a durably
    // recorded reading (see the comment in camera/routes.ts).
    sqlite.close();

    const response = await postEntrance({ plate: 'DBFAIL1' });

    expect(response.statusCode).toBe(500);
    expect(driverSignalCalls).toEqual([]);
  });

  // A non-2xx makes the camera (checkResponseEnabled) retry the same push
  // indefinitely, apparently blocking real plate reads behind it — so an
  // unusable push is acknowledged with 200 and otherwise ignored. See
  // docs/plans/2026-11-10-camera-ack-non-anpr-events-plan.md.
  for (const direction of ['entrance', 'exit'] as const) {
    it(`acknowledges (200, ignored) a ${direction} push with no anpr.xml part, doing nothing else`, async () => {
      const { body, contentType } = await buildMultipartBody([
        { fieldName: 'somethingElse', content: 'irrelevant' },
      ]);
      const response = await app.inject({
        method: 'POST',
        url: `/webhooks/camera/${direction}`,
        headers: { 'content-type': contentType },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ kind: 'ignored', reason: 'missing "anpr.xml" part' });
      expect(driverSignalCalls).toEqual([]);
      expect(printCalls).toBe(0);
      expect(repo.listTickets({}).total).toBe(0);
    });

    it(`acknowledges (200, ignored) a ${direction} anpr.xml that is not an ANPR event, doing nothing else`, async () => {
      const { body, contentType } = await buildMultipartBody([
        { fieldName: 'anpr.xml', content: '<EventNotificationAlert></EventNotificationAlert>', filename: 'anpr.xml' },
      ]);
      const response = await app.inject({
        method: 'POST',
        url: `/webhooks/camera/${direction}`,
        headers: { 'content-type': contentType },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().kind).toBe('ignored');
      expect(driverSignalCalls).toEqual([]);
      expect(printCalls).toBe(0);
      expect(repo.listTickets({}).total).toBe(0);
    });
  }

  it('still processes a valid ANPR push normally after an ignored one', async () => {
    const { body, contentType } = await buildMultipartBody([
      { fieldName: 'somethingElse', content: 'irrelevant' },
    ]);
    await app.inject({
      method: 'POST',
      url: '/webhooks/camera/entrance',
      headers: { 'content-type': contentType },
      payload: body,
    });

    const { body: validBody, contentType: validContentType } = await buildMultipartBody([
      { fieldName: 'anpr.xml', content: anprXml({ plate: 'ABC1234' }), filename: 'anpr.xml' },
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/camera/entrance',
      headers: { 'content-type': validContentType },
      payload: validBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().kind).not.toBe('ignored');
    expect(repo.findOpenByPlate('ABC1234')).toBeDefined();
  });
});

describe('POST /webhooks/camera/exit', () => {
  it('sets exitAt to when the scale read finishes, not when the webhook was received', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'WGHT002' });

    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    scaleReadDelayMs = 100;
    const beforeRequest = Date.now();
    const exit = await postExit({ plate: 'WGHT002' });
    const afterRequest = Date.now();

    const ticket = repo.findById(exit.json().ticketId);
    const exitAtMs = ticket?.exitAt?.getTime() ?? 0;
    expect(exitAtMs).toBeGreaterThanOrEqual(beforeRequest + scaleReadDelayMs);
    expect(exitAtMs).toBeLessThanOrEqual(afterRequest);
  });

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

  it('creates no ticket and withholds the driver signal when the plate is missing from the payload', async () => {
    const response = await postExit({ plate: null });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kind: 'plate_unreadable' });
    expect(driverSignalCalls).toEqual([]);
  });

  it('does not signal the driver when the ticket write fails', async () => {
    nextScaleReading = { weightKg: 15000, weightCaptureFailed: false };
    await postEntrance({ plate: 'DBFAIL2' });

    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    sqlite.close();

    const response = await postExit({ plate: 'DBFAIL2' });

    expect(response.statusCode).toBe(500);
    expect(driverSignalCalls).toEqual(['in']);
  });
});

describe('post-release debounce', () => {
  it('discards an exit reading that arrives right after a ticket closes, even for an unrelated plate', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'BOUNCE1' });
    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    await postExit({ plate: 'BOUNCE1' });

    driverSignalCalls = [];
    printCalls = 0;

    // Simulates the truck rolling back moments after release and
    // re-triggering a camera, which reads the *other* plate of the same
    // articulated rig (tractor vs. trailer) — must still be discarded.
    const bounce = await postExit({ plate: 'TRAILER9' });

    expect(bounce.json()).toEqual({ kind: 'reading_debounced' });
    expect(driverSignalCalls).toEqual([]);
    expect(printCalls).toBe(0);
    expect(repo.findOpenByPlate('TRAILER9')).toBeUndefined();

    const unresolved = repo.listUnresolvedEvents({});
    const discarded = unresolved.items.find(
      (e) => (JSON.parse(e.rawPayload) as { discarded?: string }).discarded === 'post_release_debounce',
    );
    expect(discarded).toBeDefined();
  });

  it('discards an entrance reading that arrives right after a ticket closes, even for an unrelated plate', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'BOUNCE2' });
    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    await postExit({ plate: 'BOUNCE2' });

    driverSignalCalls = [];

    // Simulates the rollback reaching back far enough to re-trigger the
    // entrance camera instead, again reading the rig's other plate.
    const bounce = await postEntrance({ plate: 'TRACTOR5' });

    expect(bounce.json()).toEqual({ kind: 'reading_debounced' });
    expect(driverSignalCalls).toEqual([]);
    expect(repo.findOpenByPlate('TRACTOR5')).toBeUndefined();
  });

  it('processes a reading normally once the debounce window has passed', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'BOUNCE3' });
    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    const closed = await postExit({ plate: 'BOUNCE3' });

    // Backdate the close past the debounce window instead of sleeping the
    // test for real: the default window is 15s.
    const ticket = repo.findById(closed.json().ticketId)!;
    repo.correctExit(ticket.id, {
      exitAt: new Date(Date.now() - 20000),
      exitWeightKg: ticket.exitWeightKg,
      exitCameraId: ticket.exitCameraId,
      exitCaptureFailed: false,
    });

    nextScaleReading = { weightKg: 18000, weightCaptureFailed: false };
    const response = await postEntrance({ plate: 'NEXTTRK' });

    expect(response.json().kind).toBe('ticket_opened');
    expect(driverSignalCalls).toContain('in');
  });

  it('never debounces when no ticket has ever closed', async () => {
    const response = await postEntrance({ plate: 'FRESH01' });

    expect(response.json().kind).toBe('ticket_opened');
  });
});

// See docs/plans/2026-11-12-camera-duplicate-plate-debounce-plan.md.
describe('duplicate plate debounce', () => {
  it('discards a second entrance for the same plate inside the window', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'DUP0001' });

    scaleContexts = [];
    driverSignalCalls = [];
    const duplicate = await postEntrance({ plate: 'DUP0001' });

    expect(duplicate.json()).toEqual({ kind: 'reading_duplicate' });
    expect(scaleContexts).toEqual([]);
    expect(driverSignalCalls).toEqual([]);

    const discarded = cameraRawEvents().find((e) => e.payload.discarded === 'duplicate_plate_read');
    expect(discarded).toBeDefined();
    expect(discarded?.payload).toMatchObject({ rawPlate: 'DUP0001' });
  });

  it('discards a second exit for the same plate inside the window, even after the ticket already closed (no false anomaly)', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'DUP0002' });
    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    const closed = await postExit({ plate: 'DUP0002' });

    // Backdate the close past the global post-release debounce window
    // (15s default) but still inside the per-plate duplicate window (2min
    // default), so this test exercises the duplicate-plate check and not
    // the unrelated post-release one.
    const ticket = repo.findById(closed.json().ticketId)!;
    repo.correctExit(ticket.id, {
      exitAt: new Date(Date.now() - 20000),
      exitWeightKg: ticket.exitWeightKg,
      exitCameraId: ticket.exitCameraId,
      exitCaptureFailed: false,
    });

    scaleContexts = [];
    driverSignalCalls = [];
    const duplicate = await postExit({ plate: 'DUP0002' });

    expect(duplicate.json()).toEqual({ kind: 'reading_duplicate' });
    expect(scaleContexts).toEqual([]);
    expect(driverSignalCalls).toEqual([]);
    expect(repo.listTickets({ status: 'ANOMALY' }).items).toEqual([]);
  });

  it('does not debounce a different plate', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'DUP0003' });

    nextScaleReading = { weightKg: 18000, weightCaptureFailed: false };
    const response = await postEntrance({ plate: 'DUP0004' });

    expect(response.json().kind).toBe('ticket_opened');
  });

  it('does not debounce across directions (entrance vs. exit for the same plate)', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    const opened = await postEntrance({ plate: 'DUP0005' });
    expect(opened.json().kind).toBe('ticket_opened');

    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    const closed = await postExit({ plate: 'DUP0005' });

    expect(closed.json().kind).toBe('ticket_closed');
  });

  it('never debounces an unreadable plate, and does not debounce against one', async () => {
    const first = await postEntrance({ plate: 'DUP0006', confidence: 50 });
    expect(first.json()).toEqual({ kind: 'plate_unreadable' });

    const second = await postEntrance({ plate: 'DUP0006', confidence: 50 });
    expect(second.json()).toEqual({ kind: 'plate_unreadable' });
  });

  it('processes a reading normally once the duplicate window has passed', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    const opened = await postEntrance({ plate: 'DUP0007' });

    // Backdate the entrance past the default 2-minute window instead of
    // sleeping the test for real.
    const ticket = repo.findById(opened.json().ticketId)!;
    repo.updateEntry(ticket.id, {
      entryAt: new Date(Date.now() - 130000),
      entryWeightKg: ticket.entryWeightKg,
      entryCameraId: ticket.entryCameraId,
      entryCaptureFailed: false,
    });

    nextScaleReading = { weightKg: 21000, weightCaptureFailed: false };
    const response = await postEntrance({ plate: 'DUP0007' });

    // The ticket is still open, so this is the existing last-write-wins
    // retrigger path, not a fresh open — confirms it's no longer being
    // swallowed by the duplicate-plate debounce once the window has passed.
    expect(response.json().kind).toBe('ticket_retriggered');
  });
});

// See docs/plans/2026-11-12-exit-reweigh-plan.md and master plan §5/§11.
describe('exit re-weigh', () => {
  it('prints and signals the driver again on a re-weigh, same as a normal exit close', async () => {
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postEntrance({ plate: 'RWG0001' });

    nextScaleReading = { weightKg: 19500, weightCaptureFailed: false };
    const firstExit = await postExit({ plate: 'RWG0001' });
    expect(firstExit.json().kind).toBe('ticket_closed');

    // Backdate the close past both the post-release (15s) and
    // duplicate-plate (2min) debounce windows, but still inside the
    // default 2h re-weigh window, so this test exercises the re-weigh path
    // itself rather than getting swallowed by an unrelated debounce.
    const originalTicket = repo.findById(firstExit.json().ticketId)!;
    repo.correctExit(originalTicket.id, {
      exitAt: new Date(Date.now() - 5 * 60 * 1000),
      exitWeightKg: originalTicket.exitWeightKg,
      exitCameraId: originalTicket.exitCameraId,
      exitCaptureFailed: false,
    });

    driverSignalCalls = [];
    printCalls = 0;
    nextScaleReading = { weightKg: 8000, weightCaptureFailed: false };
    const reweighResponse = await postExit({ plate: 'RWG0001' });

    expect(reweighResponse.json().kind).toBe('ticket_reweighed');
    expect(driverSignalCalls).toEqual(['out']);
    expect(printCalls).toBe(1);

    const reweighTicket = repo.findById(reweighResponse.json().ticketId);
    expect(reweighTicket?.status).toBe('CLOSED');
    expect(reweighTicket?.printedAt).not.toBeNull();
    expect(reweighTicket?.reweighOfTicketId).toBe(originalTicket.id);
    expect(reweighTicket?.entryWeightKg).toBe(20000);
    expect(reweighTicket?.netWeightKg).toBe(12000);

    expect(repo.findById(originalTicket.id)?.reweighedByTicketId).toBe(reweighTicket?.id);
  });
});

// See docs/plans/2026-11-10-store-anpr-confidence-plan.md.
describe('ANPR read confidence stored in camera raw events', () => {
  const CHAR_BELIEVE = '41,98,97,99,99,99,99';
  const EXPECTED_QUALITY = { confidenceLevel: 91, plateCharBelieve: [41, 98, 97, 99, 99, 99, 99] };

  it('on a normal entrance and exit, linked to the ticket', async () => {
    await postEntrance({ plate: 'GGG8319', confidence: 91, charBelieve: CHAR_BELIEVE });
    await postExit({ plate: 'GGG8319', confidence: 91, charBelieve: CHAR_BELIEVE });

    const events = cameraRawEvents();
    expect(events.map((e) => e.source)).toEqual(['camera_entrance', 'camera_exit']);
    for (const event of events) {
      expect(event.payload).toMatchObject({ rawPlate: 'GGG8319', readPlate: 'GGG8319', ...EXPECTED_QUALITY });
    }
  });

  it('on an anomaly (exit with no open ticket)', async () => {
    await postExit({ plate: 'IGG8319', confidence: 91, charBelieve: CHAR_BELIEVE });

    expect(cameraRawEvents()[0]?.payload).toMatchObject({ readPlate: 'IGG8319', ...EXPECTED_QUALITY });
  });

  it('on an unreadable read, keeping the plate the camera actually saw', async () => {
    await postEntrance({ plate: 'GGG8319', confidence: 62, charBelieve: CHAR_BELIEVE });

    expect(cameraRawEvents()[0]?.payload).toMatchObject({
      rawPlate: '',
      readPlate: 'GGG8319',
      confidenceLevel: 62,
      plateCharBelieve: [41, 98, 97, 99, 99, 99, 99],
    });
  });

  it('on a reading discarded by the post-release debounce', async () => {
    await postEntrance({ plate: 'BOUNCE1' });
    await postExit({ plate: 'BOUNCE1' });
    await postExit({ plate: 'TRAILER9', confidence: 91, charBelieve: CHAR_BELIEVE });

    const discarded = cameraRawEvents().find((e) => e.payload.discarded === 'post_release_debounce');
    expect(discarded?.payload).toMatchObject({ readPlate: 'TRAILER9', ...EXPECTED_QUALITY });
  });

  it('on a reading discarded by scale-read preemption', async () => {
    nextScaleReading = { weightKg: null, weightCaptureFailed: true, failureReason: 'preempted', waitedMs: 10, attemptsUsed: 1 };
    await postEntrance({ plate: 'PRE0001', confidence: 91, charBelieve: CHAR_BELIEVE });

    const discarded = cameraRawEvents().find((e) => e.payload.discarded === 'preempted_by_new_plate');
    expect(discarded?.payload).toMatchObject({ readPlate: 'PRE0001', ...EXPECTED_QUALITY });
  });
});

// See docs/plans/2026-11-10-preempt-scale-read-on-new-plate-plan.md.
describe('scale read preempted by a newer plate', () => {
  function findPreemptedRawEvent() {
    return repo
      .listUnresolvedEvents({})
      .items.find((e) => (JSON.parse(e.rawPayload) as { discarded?: string }).discarded === 'preempted_by_new_plate');
  }

  it('passes the normalized plate as the scale plateKey, and an empty key for an unreadable plate', async () => {
    // Unreadable read before the exit: the exit closes a ticket, which would
    // put any later reading inside the post-release debounce window.
    await postEntrance({ plate: 'KEY0001' });
    await postEntrance({ plate: null });
    await postExit({ plate: 'KEY0001' });

    expect(scaleContexts.map((c) => c?.plateKey)).toEqual(['KEY0001', '', 'KEY0001']);
  });

  for (const direction of ['entrance', 'exit'] as const) {
    it(`discards a preempted ${direction} reading entirely: no ticket, signal or print — only a raw event`, async () => {
      if (direction === 'exit') {
        await postEntrance({ plate: 'PRE0001' });
        driverSignalCalls = [];
      }
      nextScaleReading = { weightKg: null, weightCaptureFailed: true, failureReason: 'preempted', waitedMs: 1200, attemptsUsed: 1 };

      const response = direction === 'entrance' ? await postEntrance({ plate: 'PRE0001' }) : await postExit({ plate: 'PRE0001' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ kind: 'reading_preempted' });
      expect(driverSignalCalls).toEqual([]);
      expect(printCalls).toBe(0);
      const tickets = repo.listTickets({}).items;
      if (direction === 'entrance') {
        expect(tickets).toHaveLength(0);
      } else {
        // The earlier entrance's ticket is untouched: still open, no exit leg.
        expect(tickets).toHaveLength(1);
        const ticket = repo.findById(tickets[0]!.id);
        expect(ticket?.status).toBe('OPEN');
        expect(ticket?.exitWeightKg).toBeNull();
        expect(ticket?.exitCaptureFailed).toBe(false);
      }
      const raw = findPreemptedRawEvent();
      expect(raw?.source).toBe(direction === 'entrance' ? 'camera_entrance' : 'camera_exit');
      expect(JSON.parse(raw!.rawPayload)).toMatchObject({ rawPlate: 'PRE0001', waitedMs: 1200, attemptsUsed: 1 });
    });
  }

  describe('end to end with the real TCP scale client', () => {
    let scaleServer: MockScaleServer;
    let realApp: FastifyInstance;
    let realClient: ScaleClient;
    let readCalls: number;

    beforeEach(async () => {
      scaleServer = await startMockScaleServer();
      const tcpClient = createTcpScaleClient({
        host: '127.0.0.1',
        port: scaleServer.port,
        stabilityTimeoutMs: 5000,
        stabilityRetryCount: 3,
        createParser: createPlaceholderFrameParser,
      });
      readCalls = 0;
      realClient = {
        ...tcpClient,
        readStableWeight(context) {
          readCalls += 1;
          return tcpClient.readStableWeight(context);
        },
      };
      realApp = buildApp({
        db,
        scaleClient: realClient,
        driverSignalAdapter: createFakeDriverSignalAdapter(),
        printClient: createFakePrintClient(),
        adminSessionSecret: 'a'.repeat(32),
      });
    });

    afterEach(async () => {
      realClient.close();
      await realApp.close();
      await scaleServer.close();
    });

    async function inject(url: '/webhooks/camera/entrance' | '/webhooks/camera/exit', plate: string) {
      const { body, contentType } = await buildMultipartBody([
        { fieldName: 'anpr.xml', content: anprXml({ plate }), contentType: 'application/xml', filename: 'anpr.xml' },
      ]);
      return realApp.inject({ method: 'POST', url, headers: { 'content-type': contentType }, payload: body });
    }

    async function waitForReadCalls(count: number) {
      const deadline = Date.now() + 3000;
      while (readCalls < count) {
        if (Date.now() > deadline) throw new Error(`scale read #${count} never started`);
        await delay(10);
      }
      // Let the read actually reach its wait on the connection.
      await delay(50);
    }

    it('MFX8B10/IRR7J60 scenario: a new entrance preempts a stalled exit, which no longer steals the new truck\'s weight', async () => {
      // MFX8B10 enters normally.
      const entering = inject('/webhooks/camera/entrance', 'MFX8B10');
      await scaleServer.waitForConnection();
      await waitForReadCalls(1);
      scaleServer.send('ST,54280');
      expect((await entering).json().kind).toBe('ticket_opened');

      // Its exit read stalls: the truck drives off, the weight never settles.
      const exiting = inject('/webhooks/camera/exit', 'MFX8B10');
      await waitForReadCalls(2);
      scaleServer.send('US,19500');
      scaleServer.send('US,0');

      // IRR7J60's entrance arrives: it takes the scale over.
      const nextEntering = inject('/webhooks/camera/entrance', 'IRR7J60');
      const exitResponse = await exiting;
      expect(exitResponse.json()).toEqual({ kind: 'reading_preempted' });

      await waitForReadCalls(3);
      scaleServer.send('ST,53300');
      const nextResponse = await nextEntering;
      expect(nextResponse.json().kind).toBe('ticket_opened');

      // MFX8B10's ticket was not closed with IRR7J60's weight.
      const mfx = repo.findOpenByPlate('MFX8B10');
      expect(mfx?.status).toBe('OPEN');
      expect(mfx?.exitWeightKg).toBeNull();
      expect(printCalls).toBe(0);
      expect(repo.findOpenByPlate('IRR7J60')?.entryWeightKg).toBe(53300);
      expect(findPreemptedRawEvent()?.source).toBe('camera_exit');
    });

    it('an unreadable plate arriving mid-capture does not preempt it', async () => {
      const entering = inject('/webhooks/camera/entrance', 'KEEP001');
      await scaleServer.waitForConnection();
      await waitForReadCalls(1);

      const unreadable = (async () => {
        const { body, contentType } = await buildMultipartBody([
          { fieldName: 'anpr.xml', content: anprXml({ plate: null }), contentType: 'application/xml', filename: 'anpr.xml' },
        ]);
        return realApp.inject({ method: 'POST', url: '/webhooks/camera/entrance', headers: { 'content-type': contentType }, payload: body });
      })();
      await waitForReadCalls(2);

      scaleServer.send('ST,21000');
      expect((await entering).json().kind).toBe('ticket_opened');
      expect(repo.findOpenByPlate('KEEP001')?.entryWeightKg).toBe(21000);

      // The queued unreadable read only starts once KEEP001's has settled.
      await delay(100);
      scaleServer.send('ST,21000');
      expect((await unreadable).json().kind).toBe('plate_unreadable');
      expect(findPreemptedRawEvent()).toBeUndefined();
    });
  });
});

describe('internal trucks (pre-registered tare)', () => {
  function registerTruckWithActiveTare(plate: string, tareWeightKg: number): void {
    const truck = truckRepo.createTruck({ plate, label: 'Test truck' });
    const conjunto = truckRepo.createConjunto({ name: `Conjunto ${plate}` });
    const assignment = truckRepo.assignConjuntoToTruck({ truckId: truck.id, conjuntoId: conjunto.id, tareWeightKg });
    truckRepo.activateTruckConjunto(assignment.id);
  }

  it('closes and prints a ticket on the entrance event alone, using the tare as the exit weight', async () => {
    registerTruckWithActiveTare('INT0001', 9000);
    nextScaleReading = { weightKg: 21000, weightCaptureFailed: false };

    const response = await postEntrance({ plate: 'INT0001' });

    expect(response.json().kind).toBe('ticket_closed_via_tare');
    const ticket = repo.findById(response.json().ticketId);
    expect(ticket?.status).toBe('CLOSED');
    expect(ticket?.entryWeightKg).toBe(21000);
    expect(ticket?.exitWeightKg).toBe(9000);
    expect(ticket?.netWeightKg).toBe(12000);
    expect(driverSignalCalls).toEqual(['in']);
    expect(printCalls).toBe(1);
    expect(ticket?.printedAt).not.toBeNull();
    // No matching exit event ever arrives for this trip.
    expect(repo.findOpenByPlate('INT0001')).toBeUndefined();
  });

  it('closes and prints a ticket on the exit event alone, using the tare as the entry weight', async () => {
    registerTruckWithActiveTare('INT0002', 9000);
    nextScaleReading = { weightKg: 23000, weightCaptureFailed: false };

    const response = await postExit({ plate: 'INT0002' });

    expect(response.json().kind).toBe('ticket_closed');
    const ticket = repo.findById(response.json().ticketId);
    expect(ticket?.status).toBe('CLOSED');
    expect(ticket?.entryWeightKg).toBe(9000);
    expect(ticket?.exitWeightKg).toBe(23000);
    expect(ticket?.netWeightKg).toBe(14000);
    expect(driverSignalCalls).toEqual(['out']);
    expect(printCalls).toBe(1);
  });

  it('does not flag an anomaly for an internal truck exiting with no prior entrance event', async () => {
    registerTruckWithActiveTare('INT0003', 9000);
    nextScaleReading = { weightKg: 23000, weightCaptureFailed: false };

    const response = await postExit({ plate: 'INT0003' });

    expect(response.json().kind).not.toBe('anomaly_flagged');
  });

  it('falls through to the normal flow for an internal truck with no active conjunto', async () => {
    truckRepo.createTruck({ plate: 'INT0004', label: 'No conjunto yet' });
    nextScaleReading = { weightKg: 18000, weightCaptureFailed: false };

    const response = await postEntrance({ plate: 'INT0004' });

    expect(response.json().kind).toBe('ticket_opened');
    expect(repo.findOpenByPlate('INT0004')?.status).toBe('OPEN');
  });
});
