import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, type Db } from '../db/client.js';
import { seedAdminUser } from '../db/seed-admin.js';
import { createTruckRepository } from '../trucks/repository.js';
import type { ScaleClient, ScaleReadResult, ScaleStatus } from '../scale/types.js';
import type { DriverSignalAdapter, DriverSignalStatus } from '../driver-signal/types.js';
import type { PrintClient } from '../printing/print-client.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let app: FastifyInstance;
let baseUrl: string;
let nextScaleReading: ScaleReadResult;

function createFakeScaleClient(): ScaleClient {
  const status: ScaleStatus = { connected: true, lastSeenAt: null };
  return {
    async readStableWeight() {
      return nextScaleReading;
    },
    getStatus() {
      return status;
    },
    close() {},
  };
}

function createFakeDriverSignalAdapter(): DriverSignalAdapter {
  const status: DriverSignalStatus = { lastSuccessAt: null, lastFailureAt: null };
  return {
    async signalDriver() {},
    getStatus() {
      return status;
    },
  };
}

function createFakePrintClient(): PrintClient {
  return {
    async printTicket() {
      return { success: true };
    },
    async checkHealth() {
      return { reachable: true };
    },
  };
}

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `tare-weighing-stream-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  seedAdminUser(db, 'admin', 'correct-password');
  nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };

  app = buildApp({
    db,
    scaleClient: createFakeScaleClient(),
    driverSignalAdapter: createFakeDriverSignalAdapter(),
    printClient: createFakePrintClient(),
    adminSessionSecret: 'a'.repeat(32),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

async function loginCookie(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-password' }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('no set-cookie header on login response');
  return setCookie.split(';')[0]!;
}

/**
 * Builds the `anpr.xml` text the real camera sends, with just the fields
 * this system reads — see `camera/routes.test.ts`. `plate: null` omits
 * `licensePlate` entirely, mirroring a camera event with no plate read.
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
  options: { plate?: string | null; confidence?: number; deviceId?: string } = {},
): Promise<Response> {
  const { body, contentType } = await buildMultipartBody([
    { fieldName: 'anpr.xml', content: anprXml(options), contentType: 'application/xml', filename: 'anpr.xml' },
  ]);
  return fetch(`${baseUrl}${url}`, { method: 'POST', headers: { 'content-type': contentType }, body });
}

interface SseFrame {
  event: string;
  data: unknown;
}

/** Splits accumulated SSE text into complete `event:`/`data:` frames, keeping any trailing partial block. */
function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const blocks = buffer.split('\n\n');
  const rest = blocks.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event: '));
    const dataLine = lines.find((line) => line.startsWith('data: '));
    if (eventLine && dataLine) {
      frames.push({ event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) });
    }
  }
  return { frames, rest };
}

/**
 * Opens the admin ticket/weighing SSE stream, runs `trigger`, and collects
 * every frame observed up to and including the first one named
 * `untilEventName`.
 */
async function collectSseEventsUntil(
  cookie: string,
  untilEventName: string,
  trigger: () => Promise<unknown>,
  timeoutMs = 2000,
): Promise<SseFrame[]> {
  const controller = new AbortController();
  const streamResponse = await fetch(`${baseUrl}/api/admin/tickets/stream`, {
    headers: { Cookie: cookie },
    signal: controller.signal,
  });
  const reader = streamResponse.body!.getReader();
  const decoder = new TextDecoder();

  const collected: SseFrame[] = [];
  let buffer = '';

  const run = (async () => {
    while (!collected.some((frame) => frame.event === untilEventName)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`stream closed before observing "${untilEventName}"`);
      buffer += decoder.decode(value);
      const { frames, rest } = parseSseFrames(buffer);
      collected.push(...frames);
      buffer = rest;
    }
    return collected;
  })();

  // Give the stream a moment to attach its listeners before triggering.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await trigger();

  try {
    return await Promise.race([
      run,
      new Promise<SseFrame[]>((_, reject) =>
        setTimeout(() => reject(new Error(`timed out waiting for "${untilEventName}"`)), timeoutMs),
      ),
    ]);
  } finally {
    controller.abort();
  }
}

describe('weighing narration on GET /api/admin/tickets/stream', () => {
  it('emits weighing-plate-received then a weighing-result for a normal entrance', async () => {
    const cookie = await loginCookie();
    nextScaleReading = { weightKg: 18500, weightCaptureFailed: false };

    const frames = await collectSseEventsUntil(cookie, 'weighing-result', () =>
      postCameraEvent('/webhooks/camera/entrance', { plate: 'ABC1234' }),
    );

    const plateReceived = frames.find((frame) => frame.event === 'weighing-plate-received');
    expect(plateReceived?.data).toEqual({ direction: 'entrance', rawPlate: 'ABC1234' });

    const result = frames.find((frame) => frame.event === 'weighing-result');
    expect(result?.data).toMatchObject({
      direction: 'entrance',
      rawPlate: 'ABC1234',
      weightKg: 18500,
      weightCaptureFailed: false,
      outcome: 'ticket_opened',
    });
    expect((result?.data as { ticket: unknown }).ticket).toMatchObject({
      plate: 'ABC1234',
      status: 'OPEN',
      entryWeightKg: 18500,
    });
  });

  it('emits a closing weighing-result with entry, exit, and net weight on a normal exit', async () => {
    const cookie = await loginCookie();
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postCameraEvent('/webhooks/camera/entrance', { plate: 'XYZ9876' });

    nextScaleReading = { weightKg: 32000, weightCaptureFailed: false };
    const frames = await collectSseEventsUntil(cookie, 'weighing-result', () =>
      postCameraEvent('/webhooks/camera/exit', { plate: 'XYZ9876' }),
    );

    const result = frames.find((frame) => frame.event === 'weighing-result');
    expect(result?.data).toMatchObject({ direction: 'exit', outcome: 'ticket_closed', weightKg: 32000 });
    expect((result?.data as { ticket: unknown }).ticket).toMatchObject({
      status: 'CLOSED',
      entryWeightKg: 20000,
      exitWeightKg: 32000,
      netWeightKg: 12000,
    });
  });

  it('closes the ticket via the registered tare on a single entrance event for an internal truck, flagging the tare leg', async () => {
    const truckRepo = createTruckRepository(db);
    const truck = truckRepo.createTruck({ plate: 'INT0001' });
    const conjunto = truckRepo.createConjunto({ name: 'Vanderleia' });
    const assignment = truckRepo.assignConjuntoToTruck({ truckId: truck.id, conjuntoId: conjunto.id, tareWeightKg: 9000 });
    truckRepo.activateTruckConjunto(assignment.id);

    const cookie = await loginCookie();
    nextScaleReading = { weightKg: 21000, weightCaptureFailed: false };

    const frames = await collectSseEventsUntil(cookie, 'weighing-result', () =>
      postCameraEvent('/webhooks/camera/entrance', { plate: 'INT0001' }),
    );

    const result = frames.find((frame) => frame.event === 'weighing-result');
    expect(result?.data).toMatchObject({ direction: 'entrance', outcome: 'ticket_closed_via_tare', weightKg: 21000 });
    // exitCameraId: null is the existing marker for "this leg came from the
    // registered tare, not a camera event" (docs/plans/2026-10-27-internal-trucks-tare-plan.md)
    // — the frontend derives the "tara fixa" badge from this, not a new field.
    expect((result?.data as { ticket: unknown }).ticket).toMatchObject({
      status: 'CLOSED',
      entryWeightKg: 21000,
      exitWeightKg: 9000,
      netWeightKg: 12000,
      exitCameraId: null,
    });
  });

  it('emits exit_capture_pending with the ticket still OPEN when the exit weight capture fails', async () => {
    const cookie = await loginCookie();
    nextScaleReading = { weightKg: 20000, weightCaptureFailed: false };
    await postCameraEvent('/webhooks/camera/entrance', { plate: 'FAIL001' });

    nextScaleReading = { weightKg: null, weightCaptureFailed: true, failureReason: 'stability_timeout' };
    const frames = await collectSseEventsUntil(cookie, 'weighing-result', () =>
      postCameraEvent('/webhooks/camera/exit', { plate: 'FAIL001' }),
    );

    const result = frames.find((frame) => frame.event === 'weighing-result');
    expect(result?.data).toMatchObject({
      direction: 'exit',
      outcome: 'exit_capture_pending',
      weightCaptureFailed: true,
      failureReason: 'stability_timeout',
    });
    expect((result?.data as { ticket: unknown }).ticket).toMatchObject({ status: 'OPEN' });
  });

  it('emits anomaly_flagged when an exit has no matching open ticket', async () => {
    const cookie = await loginCookie();
    nextScaleReading = { weightKg: 15000, weightCaptureFailed: false };

    const frames = await collectSseEventsUntil(cookie, 'weighing-result', () =>
      postCameraEvent('/webhooks/camera/exit', { plate: 'GHOST01' }),
    );

    const result = frames.find((frame) => frame.event === 'weighing-result');
    expect(result?.data).toMatchObject({ direction: 'exit', outcome: 'anomaly_flagged', weightKg: 15000 });
    expect((result?.data as { ticket: unknown }).ticket).toMatchObject({ status: 'ANOMALY' });
  });

  it('emits plate_unreadable with no ticket when the plate cannot be read', async () => {
    const cookie = await loginCookie();

    const frames = await collectSseEventsUntil(cookie, 'weighing-result', () =>
      postCameraEvent('/webhooks/camera/entrance', { plate: null }),
    );

    const result = frames.find((frame) => frame.event === 'weighing-result');
    expect(result?.data).toMatchObject({ direction: 'entrance', outcome: 'plate_unreadable' });
    expect((result?.data as { ticket?: unknown }).ticket).toBeUndefined();
  });
});
