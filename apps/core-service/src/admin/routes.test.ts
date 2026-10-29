import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createDb, type Db } from '../db/client.js';
import { seedAdminUser } from '../db/seed-admin.js';
import { createTicketRepository, type Ticket, type TicketRepository } from '../tickets/repository.js';
import type { ScaleClient, ScaleStatus } from '../scale/types.js';
import type { DriverSignalAdapter, DriverSignalStatus } from '../driver-signal/types.js';
import type { PrintClient } from '../printing/print-client.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;
let app: FastifyInstance;
let printTicketResult: { success: boolean; error?: string };
let printCalls: number;
let scaleStatus: ScaleStatus;
let relayStatus: DriverSignalStatus;

function createFakeScaleClient(): ScaleClient {
  return {
    async readStableWeight() {
      return { weightKg: null, weightCaptureFailed: true };
    },
    getStatus() {
      return scaleStatus;
    },
    close() {},
  };
}

function createFakeDriverSignalAdapter(): DriverSignalAdapter {
  return {
    async signalDriver() {},
    getStatus() {
      return relayStatus;
    },
  };
}

function createFakePrintClient(): PrintClient {
  return {
    async printTicket() {
      printCalls += 1;
      return printTicketResult;
    },
    async checkHealth() {
      return { reachable: true };
    },
  };
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-admin-routes-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createTicketRepository(db);
  printTicketResult = { success: true };
  printCalls = 0;
  scaleStatus = { connected: false, lastSeenAt: null };
  relayStatus = { lastSuccessAt: null, lastFailureAt: null };
  seedAdminUser(db, 'admin', 'correct-password');
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

async function loginCookie(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { username: 'admin', password: 'correct-password' },
  });
  const cookie = response.cookies[0];
  return `${cookie!.name}=${cookie!.value}`;
}

function createOpenTicket(plate: string): Ticket {
  return repo.create({
    plate,
    entryAt: new Date('2026-01-01T08:00:00Z'),
    entryWeightKg: 20000,
    entryCameraId: 'cam-1',
    entryCaptureFailed: false,
  });
}

function createClosedTicket(plate: string): Ticket {
  const created = createOpenTicket(plate);
  return repo.close(created.id, {
    exitAt: new Date('2026-01-01T09:00:00Z'),
    exitWeightKg: 8000,
    exitCameraId: 'cam-2',
    exitCaptureFailed: false,
  });
}

describe('auth', () => {
  it('rejects login with a wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('logs in, reports the current user, then logs out', async () => {
    const cookie = await loginCookie();

    const me = await app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ username: 'admin' });

    const logout = await app.inject({ method: 'POST', url: '/api/admin/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(204);

    const meAfter = await app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } });
    expect(meAfter.statusCode).toBe(401);
  });

  it('rejects protected routes without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/tickets' });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/admin/tickets', () => {
  it('lists tickets and filters by status', async () => {
    const cookie = await loginCookie();
    createOpenTicket('OPEN0001');
    createClosedTicket('CLOSED01');

    const all = await app.inject({ method: 'GET', url: '/api/admin/tickets', headers: { cookie } });
    expect(all.json().total).toBe(2);

    const openOnly = await app.inject({
      method: 'GET',
      url: '/api/admin/tickets?status=OPEN',
      headers: { cookie },
    });
    expect(openOnly.json().items).toHaveLength(1);
    expect(openOnly.json().items[0].plate).toBe('OPEN0001');
  });
});

describe('GET /api/admin/tickets/:id', () => {
  it('returns the ticket with its audit log', async () => {
    const cookie = await loginCookie();
    const ticket = createOpenTicket('AUD0001');
    repo.appendAuditLog(ticket.id, 'system', 'entry_captured', { weightKg: 20000 });

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/tickets/${ticket.id}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ticket.plate).toBe('AUD0001');
    expect(response.json().auditLog).toHaveLength(1);
  });

  it('returns 404 for an unknown ticket', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({ method: 'GET', url: '/api/admin/tickets/999999', headers: { cookie } });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/admin/tickets', () => {
  it('creates a ticket marked createdByAdmin and records an audit entry', async () => {
    const cookie = await loginCookie();

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/tickets',
      headers: { cookie },
      payload: {
        plate: 'MANUAL01',
        entryAt: '2026-01-01T08:00:00.000Z',
        entryWeightKg: 15000,
        reason: 'camera was offline',
      },
    });

    expect(response.statusCode).toBe(201);
    const ticket = response.json().ticket;
    expect(ticket.plate).toBe('MANUAL01');
    expect(ticket.createdByAdmin).toBe(true);

    const auditLog = repo.findAuditLogByTicketId(ticket.id);
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0]!.actor).toBe('admin');
    expect(JSON.parse(auditLog[0]!.payload!)).toMatchObject({ reason: 'camera was offline' });
  });

  it('rejects a payload missing the mandatory reason', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/tickets',
      headers: { cookie },
      payload: { plate: 'X', entryAt: '2026-01-01T08:00:00.000Z', entryWeightKg: 1000 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('PATCH /api/admin/tickets/:id/entry', () => {
  it('edits the entry of an OPEN ticket and records an audit entry', async () => {
    const cookie = await loginCookie();
    const ticket = createOpenTicket('EDIT0001');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tickets/${ticket.id}/entry`,
      headers: { cookie },
      payload: {
        entryAt: '2026-01-01T08:05:00.000Z',
        entryWeightKg: 19500,
        reason: 'misread weight',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ticket.entryWeightKg).toBe(19500);
    expect(repo.findAuditLogByTicketId(ticket.id)).toHaveLength(1);
  });

  it('refuses to edit entry on a CLOSED ticket', async () => {
    const cookie = await loginCookie();
    const ticket = createClosedTicket('EDIT0002');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tickets/${ticket.id}/entry`,
      headers: { cookie },
      payload: { entryAt: '2026-01-01T08:05:00.000Z', entryWeightKg: 1000, reason: 'x' },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('PATCH /api/admin/tickets/:id/exit', () => {
  it('closes an OPEN ticket and triggers an automatic print', async () => {
    const cookie = await loginCookie();
    const ticket = createOpenTicket('CLOSE001');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tickets/${ticket.id}/exit`,
      headers: { cookie },
      payload: { exitAt: '2026-01-01T09:00:00.000Z', exitWeightKg: 8000, reason: 'exit camera offline' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ticket.status).toBe('CLOSED');
    expect(response.json().ticket.netWeightKg).toBe(12000);
    expect(printCalls).toBe(1);
  });

  it('corrects exit data on an already-CLOSED, already-printed ticket without reprinting automatically', async () => {
    const cookie = await loginCookie();
    const ticket = createClosedTicket('CORR0001');
    repo.markPrinted(ticket.id, new Date());
    expect(printCalls).toBe(0);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tickets/${ticket.id}/exit`,
      headers: { cookie },
      payload: { exitAt: '2026-01-01T09:05:00.000Z', exitWeightKg: 7500, reason: 'scale was misread' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ticket.status).toBe('CLOSED');
    expect(response.json().ticket.exitWeightKg).toBe(7500);
    // printIfNeeded is a no-op once printedAt is already set from the normal auto-print path.
    expect(printCalls).toBe(0);
  });

  it('refuses to edit exit data on an ANOMALY ticket', async () => {
    const cookie = await loginCookie();
    const anomaly = repo.flagAnomaly({
      plate: 'ANOM0001',
      exitAt: new Date(),
      exitWeightKg: 9000,
      exitCameraId: 'cam-2',
      exitCaptureFailed: false,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tickets/${anomaly.id}/exit`,
      headers: { cookie },
      payload: { exitAt: '2026-01-01T09:00:00.000Z', exitWeightKg: 9000, reason: 'x' },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('POST /api/admin/tickets/:id/reprint', () => {
  it('reprints a CLOSED ticket and records a reason when given', async () => {
    const cookie = await loginCookie();
    const ticket = createClosedTicket('REPR0001');

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/tickets/${ticket.id}/reprint`,
      headers: { cookie },
      payload: { reason: 'driver lost the original' },
    });

    expect(response.statusCode).toBe(202);
    expect(printCalls).toBe(1);
    const auditLog = repo.findAuditLogByTicketId(ticket.id);
    expect(auditLog.some((e) => e.action === 'reprint_requested')).toBe(true);
  });

  it('returns 409 for a ticket that is not CLOSED', async () => {
    const cookie = await loginCookie();
    const ticket = createOpenTicket('REPR0002');

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/tickets/${ticket.id}/reprint`,
      headers: { cookie },
      payload: {},
    });

    expect(response.statusCode).toBe(409);
  });

  it('returns 502 when the print bridge fails', async () => {
    const cookie = await loginCookie();
    printTicketResult = { success: false, error: 'printer offline' };
    const ticket = createClosedTicket('REPR0003');

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/tickets/${ticket.id}/reprint`,
      headers: { cookie },
      payload: {},
    });

    expect(response.statusCode).toBe(502);
  });
});

describe('GET /api/admin/unresolved-events', () => {
  it('lists only events with no linked ticket', async () => {
    const cookie = await loginCookie();
    repo.recordRawEvent('camera_entrance', { plate: '', raw: 'unreadable' });
    const ticket = createOpenTicket('LINKED01');
    repo.recordRawEvent('camera_entrance', { plate: 'LINKED01' }, ticket.id);

    const response = await app.inject({ method: 'GET', url: '/api/admin/unresolved-events', headers: { cookie } });

    expect(response.json().total).toBe(1);
  });
});

describe('GET /api/admin/status', () => {
  it('reports the hardware status of every component', async () => {
    const cookie = await loginCookie();
    scaleStatus = { connected: true, lastSeenAt: new Date('2026-01-01T00:00:00Z') };

    const response = await app.inject({ method: 'GET', url: '/api/admin/status', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.scale).toEqual({ reachable: true, lastSeenAt: '2026-01-01T00:00:00.000Z' });
    expect(body.printBridge).toEqual({ reachable: true, lastSeenAt: null });
  });
});

describe('Internal trucks / conjuntos', () => {
  async function createTruck(cookie: string, plate: string, label?: string): Promise<number> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/trucks',
      headers: { cookie },
      payload: label ? { plate, label } : { plate },
    });
    return response.json().truck.id;
  }

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/trucks' });
    expect(response.statusCode).toBe(401);
  });

  it('creates a truck, lists it, and fetches its detail with an empty audit log at first', async () => {
    const cookie = await loginCookie();

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/trucks',
      headers: { cookie },
      payload: { plate: 'INT0001', label: 'Caminhão 1' },
    });
    expect(created.statusCode).toBe(201);
    const truckId = created.json().truck.id;

    const list = await app.inject({ method: 'GET', url: '/api/admin/trucks', headers: { cookie } });
    expect(list.json()).toEqual([
      expect.objectContaining({ id: truckId, plate: 'INT0001', label: 'Caminhão 1', conjuntos: [] }),
    ]);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/admin/trucks/${truckId}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().truck.conjuntos).toEqual([]);
    expect(detail.json().auditLog).toHaveLength(1);
    expect(detail.json().auditLog[0].action).toBe('truck_created');
  });

  it('returns 404 for a truck that does not exist', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({ method: 'GET', url: '/api/admin/trucks/999999', headers: { cookie } });
    expect(response.statusCode).toBe(404);
  });

  it('creates a conjunto, lists shared conjuntos, and rejects a duplicate name', async () => {
    const cookie = await loginCookie();

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/conjuntos',
      headers: { cookie },
      payload: { name: 'Vanderleia' },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: '/api/admin/conjuntos', headers: { cookie } });
    expect(list.json()).toEqual([expect.objectContaining({ name: 'Vanderleia' })]);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/admin/conjuntos',
      headers: { cookie },
      payload: { name: 'Vanderleia' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('assigns a new (inline-created) conjunto to a truck by name', async () => {
    const cookie = await loginCookie();
    const truckId = await createTruck(cookie, 'INT0002');

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/trucks/${truckId}/conjuntos`,
      headers: { cookie },
      payload: { conjuntoName: 'Conjunto A', tareWeightKg: 8000 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().truck.conjuntos).toEqual([
      expect.objectContaining({ conjuntoName: 'Conjunto A', tareWeightKg: 8000, isActive: false }),
    ]);
  });

  it('assigns the same shared conjunto to two trucks with different tares each', async () => {
    const cookie = await loginCookie();
    const conjunto = await app.inject({
      method: 'POST',
      url: '/api/admin/conjuntos',
      headers: { cookie },
      payload: { name: 'Bitrem Bicaçamba' },
    });
    const conjuntoId = conjunto.json().conjunto.id;

    const truckA = await createTruck(cookie, 'INT0003');
    const truckB = await createTruck(cookie, 'INT0004');

    const assignA = await app.inject({
      method: 'POST',
      url: `/api/admin/trucks/${truckA}/conjuntos`,
      headers: { cookie },
      payload: { conjuntoId, tareWeightKg: 22860 },
    });
    const assignB = await app.inject({
      method: 'POST',
      url: `/api/admin/trucks/${truckB}/conjuntos`,
      headers: { cookie },
      payload: { conjuntoId, tareWeightKg: 20800 },
    });

    expect(assignA.json().truck.conjuntos[0]).toEqual(
      expect.objectContaining({ conjuntoId, tareWeightKg: 22860 }),
    );
    expect(assignB.json().truck.conjuntos[0]).toEqual(
      expect.objectContaining({ conjuntoId, tareWeightKg: 20800 }),
    );
  });

  it('rejects assigning a conjunto with neither conjuntoId nor conjuntoName', async () => {
    const cookie = await loginCookie();
    const truckId = await createTruck(cookie, 'INT0005');

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/trucks/${truckId}/conjuntos`,
      headers: { cookie },
      payload: { tareWeightKg: 8000 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('activates a conjunto assignment and deactivates any other assignment of the same truck', async () => {
    const cookie = await loginCookie();
    const truckId = await createTruck(cookie, 'INT0006');

    const assignmentA = await app.inject({
      method: 'POST',
      url: `/api/admin/trucks/${truckId}/conjuntos`,
      headers: { cookie },
      payload: { conjuntoName: 'A', tareWeightKg: 8000 },
    });
    const assignmentAId = assignmentA.json().truck.conjuntos[0].id;

    const assignmentB = await app.inject({
      method: 'POST',
      url: `/api/admin/trucks/${truckId}/conjuntos`,
      headers: { cookie },
      payload: { conjuntoName: 'B', tareWeightKg: 8500 },
    });
    const assignmentBId = assignmentB.json().truck.conjuntos.find(
      (c: { conjuntoName: string }) => c.conjuntoName === 'B',
    ).id;

    await app.inject({
      method: 'POST',
      url: `/api/admin/truck-conjuntos/${assignmentAId}/activate`,
      headers: { cookie },
    });
    const afterActivatingB = await app.inject({
      method: 'POST',
      url: `/api/admin/truck-conjuntos/${assignmentBId}/activate`,
      headers: { cookie },
    });

    const assignments = afterActivatingB.json().truck.conjuntos as Array<{ id: number; isActive: boolean }>;
    expect(assignments.find((a) => a.id === assignmentAId)?.isActive).toBe(false);
    expect(assignments.find((a) => a.id === assignmentBId)?.isActive).toBe(true);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/admin/trucks/${truckId}`,
      headers: { cookie },
    });
    expect(detail.json().auditLog.map((e: { action: string }) => e.action)).toEqual([
      'conjunto_activated',
      'conjunto_activated',
      'conjunto_assigned',
      'conjunto_assigned',
      'truck_created',
    ]);
  });

  it('returns 404 when activating a conjunto assignment that does not exist', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/truck-conjuntos/999999/activate',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
