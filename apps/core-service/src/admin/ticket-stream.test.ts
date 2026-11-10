import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, type Db } from '../db/client.js';
import { seedAdminUser } from '../db/seed-admin.js';
import { createUserRepository } from '../users/repository.js';
import type { ScaleClient, ScaleStatus } from '../scale/types.js';
import type { DriverSignalAdapter, DriverSignalStatus } from '../driver-signal/types.js';
import type { PrintClient } from '../printing/print-client.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let app: FastifyInstance;
let baseUrl: string;

function createFakeScaleClient(): ScaleClient {
  const status: ScaleStatus = { connected: false, lastSeenAt: null };
  return {
    async readStableWeight() {
      return { weightKg: null, weightCaptureFailed: true };
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
  dbPath = path.join(os.tmpdir(), `tare-ticket-stream-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  seedAdminUser(db, 'admin', 'correct-password');

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

async function loginCookie(username = 'admin', password = 'correct-password'): Promise<string> {
  const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('no set-cookie header on login response');
  return setCookie.split(';')[0]!;
}

describe('GET /api/admin/tickets/stream', () => {
  it('rejects a request without a session', async () => {
    const response = await fetch(`${baseUrl}/api/admin/tickets/stream`);
    expect(response.status).toBe(401);
  });

  it('is open to the operator profile (the Operação screen depends on it)', async () => {
    createUserRepository(db).createUser({
      username: 'op',
      name: 'Operador',
      role: 'operator',
      passwordHash: bcrypt.hashSync('op-password', 4),
      mustChangePassword: false,
    });
    const cookie = await loginCookie('op', 'op-password');

    const controller = new AbortController();
    const streamResponse = await fetch(`${baseUrl}/api/admin/tickets/stream`, {
      headers: { Cookie: cookie },
      signal: controller.signal,
    });
    expect(streamResponse.status).toBe(200);
    controller.abort();
  });

  it('pushes a ticket-changed event when a ticket is created', async () => {
    const cookie = await loginCookie();

    const controller = new AbortController();
    const streamResponse = await fetch(`${baseUrl}/api/admin/tickets/stream`, {
      headers: { Cookie: cookie },
      signal: controller.signal,
    });
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream');

    const reader = streamResponse.body!.getReader();
    const decoder = new TextDecoder();

    const waitForTicketChanged = (async () => {
      let buffer = '';
      while (!buffer.includes('event: ticket-changed')) {
        const { value, done } = await reader.read();
        if (done) return buffer;
        buffer += decoder.decode(value);
      }
      return buffer;
    })();

    // Give the stream a moment to attach its listener before mutating.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fetch(`${baseUrl}/api/admin/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        plate: 'ABC1234',
        entryAt: '2026-01-01T08:00:00.000Z',
        entryWeightKg: 20000,
        reason: 'manual entry',
      }),
    });

    const buffer = await Promise.race([
      waitForTicketChanged,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for SSE event')), 2000)),
    ]);
    expect(buffer).toContain('event: ticket-changed');

    controller.abort();
  });
});
