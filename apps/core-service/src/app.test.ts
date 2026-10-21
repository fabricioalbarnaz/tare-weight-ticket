import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    getStatus() {
      return { connected: true, lastSeenAt: null };
    },
    close() {},
  };
}

function createFakeDriverSignalAdapter(): DriverSignalAdapter {
  return {
    async signalDriver() {},
    getStatus() {
      return { lastSuccessAt: null, lastFailureAt: null };
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
      adminSessionSecret: 'a'.repeat(32),
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('Admin UI static serving', () => {
  let adminUiDir: string;

  beforeEach(() => {
    adminUiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tare-admin-ui-'));
    fs.writeFileSync(path.join(adminUiDir, 'index.html'), '<html>admin ui</html>');
    fs.writeFileSync(path.join(adminUiDir, 'app.js'), 'console.log("hi")');
  });

  afterEach(() => {
    fs.rmSync(adminUiDir, { recursive: true, force: true });
  });

  function buildAppWithAdminUi() {
    const db = openTempDb();
    return buildApp({
      db,
      scaleClient: createFakeScaleClient(),
      driverSignalAdapter: createFakeDriverSignalAdapter(),
      printClient: createFakePrintClient(),
      adminSessionSecret: 'a'.repeat(32),
      adminUiDir,
    });
  }

  it('serves a known static file', async () => {
    const app = buildAppWithAdminUi();

    const response = await app.inject({ method: 'GET', url: '/app.js' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('console.log("hi")');
  });

  it('falls back to index.html for an unmatched client-side route', async () => {
    const app = buildAppWithAdminUi();

    const response = await app.inject({ method: 'GET', url: '/tickets/42' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<html>admin ui</html>');
  });

  it('still returns a plain 404 for an unmatched API route', async () => {
    const app = buildAppWithAdminUi();

    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('leaves real API routes untouched', async () => {
    const app = buildAppWithAdminUi();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
