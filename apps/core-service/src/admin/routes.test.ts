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
import { createTicketRepository, type Ticket, type TicketRepository } from '../tickets/repository.js';
import { createUserRepository, type AdminUser, type UserRepository } from '../users/repository.js';
import type { ScaleClient, ScaleStatus } from '../scale/types.js';
import type { DriverSignalAdapter, DriverSignalStatus } from '../driver-signal/types.js';
import type { PrintClient } from '../printing/print-client.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;
let userRepo: UserRepository;
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
  userRepo = createUserRepository(db);
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

async function loginCookie(username = 'admin', password = 'correct-password'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    payload: { username, password },
  });
  const cookie = response.cookies[0];
  return `${cookie!.name}=${cookie!.value}`;
}

/** Creates a user directly (bypassing the API), already past the forced password change unless asked otherwise. */
function createUser(
  username: string,
  role: 'admin' | 'operator',
  options: { mustChangePassword?: boolean } = {},
): AdminUser {
  return userRepo.createUser({
    username,
    name: `Name ${username}`,
    role,
    passwordHash: bcrypt.hashSync('user-password', 4),
    mustChangePassword: options.mustChangePassword ?? false,
  });
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
    expect(me.json()).toEqual({
      id: expect.any(Number),
      username: 'admin',
      name: 'admin',
      role: 'admin',
      mustChangePassword: false,
    });

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

  it('flags suspectWeight on tickets whose audit log recorded a retried scale read', async () => {
    const cookie = await loginCookie();
    const suspect = createOpenTicket('SUSP0001');
    repo.appendAuditLog(suspect.id, 'system', 'entry_captured', {
      weightKg: 20000,
      cameraId: 'cam-1',
      attemptsUsed: 3,
    });
    createOpenTicket('NORMAL01');

    const response = await app.inject({ method: 'GET', url: '/api/admin/tickets', headers: { cookie } });
    const items: Array<{ plate: string; suspectWeight: boolean }> = response.json().items;

    expect(items.find((i) => i.plate === 'SUSP0001')?.suspectWeight).toBe(true);
    expect(items.find((i) => i.plate === 'NORMAL01')?.suspectWeight).toBe(false);
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

  it('normalizes the plate on creation the same way camera reads are normalized', async () => {
    const cookie = await loginCookie();

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/trucks',
      headers: { cookie },
      payload: { plate: ' int-0020 ' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().truck.plate).toBe('INT0020');
  });

  it('rejects creating a truck with a plate that is already registered', async () => {
    const cookie = await loginCookie();
    await createTruck(cookie, 'INT0021');

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/trucks',
      headers: { cookie },
      payload: { plate: 'int-0021' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects creating a truck whose plate is empty after normalization', async () => {
    const cookie = await loginCookie();

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/trucks',
      headers: { cookie },
      payload: { plate: '---' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for a truck that does not exist', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({ method: 'GET', url: '/api/admin/trucks/999999', headers: { cookie } });
    expect(response.statusCode).toBe(404);
  });

  it('edits a truck plate and records it in the audit log', async () => {
    const cookie = await loginCookie();
    const truckId = await createTruck(cookie, 'INT0010');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/trucks/${truckId}/plate`,
      headers: { cookie },
      payload: { plate: 'INT0011', reason: 'Placa cadastrada errada, corrigida pelo motorista' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().truck.plate).toBe('INT0011');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/admin/trucks/${truckId}`,
      headers: { cookie },
    });
    expect(detail.json().truck.plate).toBe('INT0011');
    expect(detail.json().auditLog[0]).toEqual(
      expect.objectContaining({
        action: 'plate_edited',
        payload: {
          reason: 'Placa cadastrada errada, corrigida pelo motorista',
          before: { plate: 'INT0010' },
          after: { plate: 'INT0011' },
        },
      }),
    );
  });

  it('returns 404 editing the plate of a truck that does not exist', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/trucks/999999/plate',
      headers: { cookie },
      payload: { plate: 'INT0099', reason: 'teste' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('normalizes the edited plate the same way camera reads are normalized', async () => {
    const cookie = await loginCookie();
    const truckId = await createTruck(cookie, 'INT0014');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/trucks/${truckId}/plate`,
      headers: { cookie },
      payload: { plate: ' int-0015 ', reason: 'teste' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().truck.plate).toBe('INT0015');
  });

  it('rejects editing a plate to one already used by another truck', async () => {
    const cookie = await loginCookie();
    const truckA = await createTruck(cookie, 'INT0012');
    await createTruck(cookie, 'INT0013');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/trucks/${truckA}/plate`,
      headers: { cookie },
      payload: { plate: 'INT0013', reason: 'teste' },
    });

    expect(response.statusCode).toBe(409);
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

  it('activates a conjunto assignment when the client sends Content-Type: application/json with no body (as the real admin-ui fetch client does)', async () => {
    const cookie = await loginCookie();
    const truckId = await createTruck(cookie, 'INT0007');

    const assignment = await app.inject({
      method: 'POST',
      url: `/api/admin/trucks/${truckId}/conjuntos`,
      headers: { cookie },
      payload: { conjuntoName: 'C', tareWeightKg: 9000 },
    });
    const assignmentId = assignment.json().truck.conjuntos[0].id;

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/truck-conjuntos/${assignmentId}/activate`,
      headers: { cookie, 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
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

describe('profiles and session revalidation', () => {
  it('rejects login for an inactive user', async () => {
    const user = createUser('inactive', 'operator');
    userRepo.setActive(user.id, false);

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'inactive', password: 'user-password' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('ends an already-open session as soon as the user is deactivated', async () => {
    const user = createUser('soon-inactive', 'operator');
    const cookie = await loginCookie('soon-inactive', 'user-password');
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/tickets', headers: { cookie } }))
        .statusCode,
    ).toBe(200);

    userRepo.setActive(user.id, false);

    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/tickets', headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it('lets an operator list tickets but rejects admin-only routes with 403', async () => {
    createUser('op', 'operator');
    const cookie = await loginCookie('op', 'user-password');

    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/tickets', headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    for (const url of [
      '/api/admin/status',
      '/api/admin/trucks',
      '/api/admin/unresolved-events',
      '/api/admin/users',
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(response.statusCode, url).toBe(403);
      expect(response.body).toBe('admin_required');
    }
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/tickets',
      headers: { cookie },
      payload: {
        plate: 'ABC1234',
        entryAt: '2026-01-01T08:00:00.000Z',
        entryWeightKg: 20000,
        reason: 'x',
      },
    });
    expect(create.statusCode).toBe(403);
  });

  it('applies a profile change to an already-open session immediately', async () => {
    const user = createUser('promoted', 'operator');
    const cookie = await loginCookie('promoted', 'user-password');
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/trucks', headers: { cookie } }))
        .statusCode,
    ).toBe(403);

    userRepo.updateUser(user.id, { name: user.name, role: 'admin' });

    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/trucks', headers: { cookie } }))
        .statusCode,
    ).toBe(200);
  });

  it('blocks everything but me/logout/change-password until an admin-set password is changed', async () => {
    createUser('fresh', 'admin', { mustChangePassword: true });
    const cookie = await loginCookie('fresh', 'user-password');

    const me = await app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().mustChangePassword).toBe(true);

    const tickets = await app.inject({
      method: 'GET',
      url: '/api/admin/tickets',
      headers: { cookie },
    });
    expect(tickets.statusCode).toBe(403);
    expect(tickets.body).toBe('password_change_required');

    const change = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: 'user-password', newPassword: 'my-own-password' },
    });
    expect(change.statusCode).toBe(200);
    expect(change.json().mustChangePassword).toBe(false);

    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/tickets', headers: { cookie } }))
        .statusCode,
    ).toBe(200);
  });
});

describe('POST /api/admin/auth/change-password', () => {
  async function changePassword(cookie: string, currentPassword: string, newPassword: string) {
    return app.inject({
      method: 'POST',
      url: '/api/admin/auth/change-password',
      headers: { cookie },
      payload: { currentPassword, newPassword },
    });
  }

  it('changes the password so only the new one logs in', async () => {
    const cookie = await loginCookie();
    expect((await changePassword(cookie, 'correct-password', 'brand-new')).statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'admin', password: 'correct-password' },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'admin', password: 'brand-new' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    const cookie = await loginCookie();
    const response = await changePassword(cookie, 'not-it', 'brand-new');
    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('wrong_current_password');
  });

  it('rejects a new password equal to the current one', async () => {
    const cookie = await loginCookie();
    const response = await changePassword(cookie, 'correct-password', 'correct-password');
    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('same_password');
  });

  it('rejects a new password shorter than 6 characters', async () => {
    const cookie = await loginCookie();
    expect((await changePassword(cookie, 'correct-password', '12345')).statusCode).toBe(400);
  });

  it('requires a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/change-password',
      payload: { currentPassword: 'a', newPassword: 'abcdef' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('user management', () => {
  function adminId(): number {
    return userRepo.findUserByUsername('admin')!.id;
  }

  it('lists users without password hashes', async () => {
    const cookie = await loginCookie();
    createUser('op', 'operator');

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const users: Array<Record<string, unknown>> = response.json();
    expect(users.map((u) => u.username).sort()).toEqual(['admin', 'op']);
    expect(users.every((u) => !('passwordHash' in u))).toBe(true);
  });

  it('creates a user who must change the admin-set password on first login', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie },
      payload: { username: 'maria.op', name: '  Maria  ', role: 'operator', password: 'initial1' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().user).toMatchObject({
      username: 'maria.op',
      name: 'Maria',
      role: 'operator',
      active: true,
      mustChangePassword: true,
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'maria.op', password: 'initial1' },
    });
    expect(login.json().mustChangePassword).toBe(true);
  });

  it('rejects a duplicate username with 409', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { cookie },
      payload: { username: 'admin', name: 'Other', role: 'operator', password: 'initial1' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toBe('username_taken');
  });

  it('rejects an invalid username, a blank name, a short password and an unknown profile with 400', async () => {
    const cookie = await loginCookie();
    for (const payload of [
      { username: 'a b', name: 'X', role: 'operator', password: 'initial1' },
      { username: 'ab', name: 'X', role: 'operator', password: 'initial1' },
      { username: 'valid', name: '   ', role: 'operator', password: 'initial1' },
      { username: 'valid', name: 'X', role: 'operator', password: '12345' },
      { username: 'valid', name: 'X', role: 'superuser', password: 'initial1' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/users',
        headers: { cookie },
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('edits name and profile of another user', async () => {
    const cookie = await loginCookie();
    const op = createUser('op', 'operator');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${op.id}`,
      headers: { cookie },
      payload: { name: 'Novo Nome', role: 'admin' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      name: 'Novo Nome',
      role: 'admin',
      username: 'op',
    });
  });

  it('lets an admin rename themselves but not change their own profile', async () => {
    const cookie = await loginCookie();

    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${adminId()}`,
      headers: { cookie },
      payload: { name: 'Administrador', role: 'admin' },
    });
    expect(rename.statusCode).toBe(200);

    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${adminId()}`,
      headers: { cookie },
      payload: { name: 'Administrador', role: 'operator' },
    });
    expect(demote.statusCode).toBe(400);
    expect(demote.body).toBe('cannot_change_own_role');
  });

  it('returns 404 for an unknown user', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/users/999999',
      headers: { cookie },
      payload: { name: 'X', role: 'admin' },
    });
    expect(response.statusCode).toBe(404);
  });

  it("resets another user's password and forces them to change it", async () => {
    const cookie = await loginCookie();
    const op = createUser('op', 'operator');

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${op.id}/reset-password`,
      headers: { cookie },
      payload: { password: 'reset-pass' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.mustChangePassword).toBe(true);

    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { username: 'op', password: 'reset-pass' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('rejects resetting your own password (use change-password instead)', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${adminId()}/reset-password`,
      headers: { cookie },
      payload: { password: 'reset-pass' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('cannot_reset_own_password');
  });

  it('deactivates and reactivates another user', async () => {
    const cookie = await loginCookie();
    const op = createUser('op', 'operator');

    const off = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${op.id}/deactivate`,
      headers: { cookie },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().user.active).toBe(false);

    const on = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${op.id}/activate`,
      headers: { cookie },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().user.active).toBe(true);
  });

  it('rejects deactivating yourself', async () => {
    const cookie = await loginCookie();
    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${adminId()}/deactivate`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('cannot_deactivate_self');
  });

  it('lets an admin deactivate another admin while at least one active admin remains', async () => {
    const cookie = await loginCookie();
    const other = createUser('other-admin', 'admin');

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${other.id}/deactivate`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(userRepo.countActiveAdmins()).toBe(1);
  });
});
