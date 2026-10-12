import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb, type Db } from './db/client.js';
import type { ScaleClient } from './scale/types.js';
import type { DriverSignalAdapter } from './driver-signal/types.js';
import type { PrintClient } from './printing/print-client.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];

function createFakeScaleClient(): ScaleClient {
  return {
    async readStableWeight() {
      return { weightKg: 1000, weightCaptureFailed: false };
    },
    close() {},
  };
}

function createFakeDriverSignalAdapter(): DriverSignalAdapter {
  return {
    async signalDriver() {},
  };
}

function createFakePrintClient(): PrintClient {
  return {
    async printTicket() {
      return { success: true };
    },
  };
}

function openTempDb(): Db {
  dbPath = path.join(os.tmpdir(), `tare-app-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  sqlite = created.sqlite;
  return created.db;
}

afterEach(() => {
  sqlite?.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('GET /health', () => {
  it('returns ok status', async () => {
    const db = openTempDb();
    const app = buildApp({
      db,
      scaleClient: createFakeScaleClient(),
      driverSignalAdapter: createFakeDriverSignalAdapter(),
      printClient: createFakePrintClient(),
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
