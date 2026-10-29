import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { ticketAuditLog, rawEvents } from '../db/schema.js';
import { createTruckRepository, type TruckRepository } from '../trucks/repository.js';
import { createTicketRepository, type TicketRepository } from './repository.js';
import { createSessionService, type SessionService } from './session-service.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;
let truckRepo: TruckRepository;
let service: SessionService;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-session-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createTicketRepository(db);
  truckRepo = createTruckRepository(db);
  service = createSessionService(repo, truckRepo);
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

function auditActionsFor(ticketId: number): string[] {
  return db
    .select()
    .from(ticketAuditLog)
    .where(eq(ticketAuditLog.ticketId, ticketId))
    .all()
    .map((row) => row.action);
}

function rawEventCount(): number {
  return db.select().from(rawEvents).all().length;
}

function scaleRawEventsFor(ticketId: number): Array<Record<string, unknown>> {
  return db
    .select()
    .from(rawEvents)
    .where(eq(rawEvents.linkedTicketId, ticketId))
    .all()
    .filter((row) => row.source === 'scale')
    .map((row) => JSON.parse(row.rawPayload) as Record<string, unknown>);
}

describe('SessionService — entrance', () => {
  it('opens a new ticket on the first entrance reading for a plate', () => {
    const result = service.handleEntranceReading({
      rawPlate: 'abc-1234',
      cameraId: 'cam-entrance-1',
      timestamp: new Date('2026-01-01T08:00:00Z'),
      receivedAt: new Date('2026-01-01T08:00:01Z'),
      weightKg: 20000,
      weightCaptureFailed: false,
    });

    expect(result.kind).toBe('ticket_opened');
    if (result.kind !== 'ticket_opened') throw new Error('unreachable');
    expect(result.ticket.plate).toBe('ABC1234');
    expect(result.ticket.status).toBe('OPEN');
    expect(result.ticket.entryWeightKg).toBe(20000);
    expect(auditActionsFor(result.ticket.id)).toEqual(['entry_captured']);
  });

  it('uses the server-received time, not the camera-reported time, for entryAt', () => {
    const result = service.handleEntranceReading({
      rawPlate: 'SRVTIME1',
      cameraId: 'cam-entrance-1',
      timestamp: new Date('2020-01-01T00:00:00Z'),
      receivedAt: new Date('2026-01-01T08:00:01Z'),
      weightKg: 20000,
      weightCaptureFailed: false,
    });

    if (result.kind !== 'ticket_opened') throw new Error('unreachable');
    expect(result.ticket.entryAt).toEqual(new Date('2026-01-01T08:00:01Z'));
  });

  it('overwrites entry data on a retrigger without creating a second ticket', () => {
    const first = service.handleEntranceReading({
      rawPlate: 'RET1234',
      cameraId: 'cam-entrance-1',
      timestamp: new Date('2026-01-01T08:00:00Z'),
      receivedAt: new Date('2026-01-01T08:00:00Z'),
      weightKg: 19000,
      weightCaptureFailed: false,
    });
    if (first.kind !== 'ticket_opened') throw new Error('unreachable');

    const second = service.handleEntranceReading({
      rawPlate: 'RET1234',
      cameraId: 'cam-entrance-1',
      timestamp: new Date('2026-01-01T08:00:05Z'),
      receivedAt: new Date('2026-01-01T08:00:05Z'),
      weightKg: 19500,
      weightCaptureFailed: false,
    });

    expect(second.kind).toBe('ticket_retriggered');
    if (second.kind !== 'ticket_retriggered') throw new Error('unreachable');
    expect(second.ticket.id).toBe(first.ticket.id);
    expect(second.ticket.entryWeightKg).toBe(19500);
    expect(repo.findOpenByPlate('RET1234')?.id).toBe(first.ticket.id);
    expect(auditActionsFor(first.ticket.id)).toEqual(['entry_captured', 'entry_overwritten']);
  });

  it('flags entry_capture_failed and stores a null weight on a scale timeout', () => {
    const result = service.handleEntranceReading({
      rawPlate: 'TIME0001',
      cameraId: 'cam-entrance-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: null,
      weightCaptureFailed: true,
    });

    if (result.kind !== 'ticket_opened') throw new Error('unreachable');
    expect(result.ticket.entryWeightKg).toBeNull();
    expect(result.ticket.entryCaptureFailed).toBe(true);
    expect(auditActionsFor(result.ticket.id)).toEqual(['entry_capture_failed']);
  });

  it('creates no ticket and logs a raw event when the plate is unreadable', () => {
    const result = service.handleEntranceReading({
      rawPlate: '   ',
      cameraId: 'cam-entrance-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: 18000,
      weightCaptureFailed: false,
    });

    expect(result).toEqual({ kind: 'plate_unreadable' });
    expect(rawEventCount()).toBe(1);
  });

  it('records a scale raw event linked to the ticket on a successful entrance capture', () => {
    const result = service.handleEntranceReading({
      rawPlate: 'SCALE001',
      cameraId: 'cam-entrance-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: 20000,
      weightCaptureFailed: false,
      waitedMs: 1234,
    });
    if (result.kind !== 'ticket_opened') throw new Error('unreachable');

    const scaleEvents = scaleRawEventsFor(result.ticket.id);
    expect(scaleEvents).toEqual([
      { direction: 'entrance', weightKg: 20000, weightCaptureFailed: false, waitedMs: 1234 },
    ]);
  });

  it('records the failure reason in the scale raw event on an entrance scale timeout', () => {
    const result = service.handleEntranceReading({
      rawPlate: 'SCALE002',
      cameraId: 'cam-entrance-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: null,
      weightCaptureFailed: true,
      failureReason: 'stability_timeout',
      waitedMs: 15000,
    });
    if (result.kind !== 'ticket_opened') throw new Error('unreachable');

    const scaleEvents = scaleRawEventsFor(result.ticket.id);
    expect(scaleEvents).toEqual([
      {
        direction: 'entrance',
        weightKg: null,
        weightCaptureFailed: true,
        failureReason: 'stability_timeout',
        waitedMs: 15000,
      },
    ]);
  });
});

describe('SessionService — exit', () => {
  it('closes an open ticket and computes net weight (arrive loaded, leave empty)', () => {
    const entrance = service.handleEntranceReading({
      rawPlate: 'LOAD0001',
      cameraId: 'cam-entrance-1',
      timestamp: new Date('2026-01-01T08:00:00Z'),
      receivedAt: new Date('2026-01-01T08:00:01Z'),
      weightKg: 20000,
      weightCaptureFailed: false,
    });
    if (entrance.kind !== 'ticket_opened') throw new Error('unreachable');

    const exit = service.handleExitReading({
      rawPlate: 'LOAD0001',
      cameraId: 'cam-exit-1',
      timestamp: new Date('2026-01-01T09:00:00Z'),
      receivedAt: new Date('2026-01-01T09:00:01Z'),
      weightKg: 8000,
      weightCaptureFailed: false,
    });

    expect(exit.kind).toBe('ticket_closed');
    if (exit.kind !== 'ticket_closed') throw new Error('unreachable');
    expect(exit.ticket.id).toBe(entrance.ticket.id);
    expect(exit.ticket.status).toBe('CLOSED');
    expect(exit.ticket.netWeightKg).toBe(12000);
    expect(exit.ticket.exitAt).toEqual(new Date('2026-01-01T09:00:01Z'));
    expect(repo.findOpenByPlate('LOAD0001')).toBeUndefined();
    expect(auditActionsFor(exit.ticket.id)).toEqual(['entry_captured', 'exit_captured']);
  });

  it('closes an open ticket and computes net weight (arrive empty, leave loaded)', () => {
    const entrance = service.handleEntranceReading({
      rawPlate: 'LOAD0002',
      cameraId: 'cam-entrance-1',
      timestamp: new Date('2026-01-01T08:00:00Z'),
      receivedAt: new Date('2026-01-01T08:00:00Z'),
      weightKg: 8000,
      weightCaptureFailed: false,
    });
    if (entrance.kind !== 'ticket_opened') throw new Error('unreachable');

    const exit = service.handleExitReading({
      rawPlate: 'LOAD0002',
      cameraId: 'cam-exit-1',
      timestamp: new Date('2026-01-01T09:00:00Z'),
      receivedAt: new Date('2026-01-01T09:00:00Z'),
      weightKg: 20000,
      weightCaptureFailed: false,
    });

    if (exit.kind !== 'ticket_closed') throw new Error('unreachable');
    expect(exit.ticket.netWeightKg).toBe(12000);
  });

  it('flags an anomaly when the exit plate has no matching open ticket', () => {
    const result = service.handleExitReading({
      rawPlate: 'NOENTRY1',
      cameraId: 'cam-exit-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: 9000,
      weightCaptureFailed: false,
    });

    expect(result.kind).toBe('anomaly_flagged');
    if (result.kind !== 'anomaly_flagged') throw new Error('unreachable');
    expect(result.ticket.status).toBe('ANOMALY');
    expect(result.ticket.entryAt).toBeNull();
    expect(auditActionsFor(result.ticket.id)).toEqual(['anomaly_flagged']);
  });

  it('closes with a null net weight and exit_capture_failed on a scale timeout', () => {
    const entrance = service.handleEntranceReading({
      rawPlate: 'EXITFAIL',
      cameraId: 'cam-entrance-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: 15000,
      weightCaptureFailed: false,
    });
    if (entrance.kind !== 'ticket_opened') throw new Error('unreachable');

    const exit = service.handleExitReading({
      rawPlate: 'EXITFAIL',
      cameraId: 'cam-exit-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: null,
      weightCaptureFailed: true,
    });

    if (exit.kind !== 'ticket_closed') throw new Error('unreachable');
    expect(exit.ticket.status).toBe('CLOSED');
    expect(exit.ticket.exitCaptureFailed).toBe(true);
    expect(exit.ticket.netWeightKg).toBeNull();
    expect(auditActionsFor(exit.ticket.id)).toEqual(['entry_captured', 'exit_capture_failed']);
  });

  it('creates no ticket and logs a raw event when the exit plate is unreadable', () => {
    const result = service.handleExitReading({
      rawPlate: '',
      cameraId: 'cam-exit-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: 9000,
      weightCaptureFailed: false,
    });

    expect(result).toEqual({ kind: 'plate_unreadable' });
    expect(rawEventCount()).toBe(1);
  });

  it('records a scale raw event linked to the ticket when closing', () => {
    const entrance = service.handleEntranceReading({
      rawPlate: 'SCALE003',
      cameraId: 'cam-entrance-1',
      timestamp: new Date('2026-01-01T08:00:00Z'),
      receivedAt: new Date('2026-01-01T08:00:00Z'),
      weightKg: 20000,
      weightCaptureFailed: false,
    });
    if (entrance.kind !== 'ticket_opened') throw new Error('unreachable');

    const exit = service.handleExitReading({
      rawPlate: 'SCALE003',
      cameraId: 'cam-exit-1',
      timestamp: new Date('2026-01-01T09:00:00Z'),
      receivedAt: new Date('2026-01-01T09:00:00Z'),
      weightKg: 8000,
      weightCaptureFailed: false,
      waitedMs: 2000,
    });
    if (exit.kind !== 'ticket_closed') throw new Error('unreachable');

    const scaleEvents = scaleRawEventsFor(exit.ticket.id);
    expect(scaleEvents).toEqual([
      { direction: 'entrance', weightKg: 20000, weightCaptureFailed: false },
      { direction: 'exit', weightKg: 8000, weightCaptureFailed: false, waitedMs: 2000 },
    ]);
  });

  it('records the failure reason in the scale raw event on an exit scale timeout', () => {
    const entrance = service.handleEntranceReading({
      rawPlate: 'SCALE004',
      cameraId: 'cam-entrance-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: 15000,
      weightCaptureFailed: false,
    });
    if (entrance.kind !== 'ticket_opened') throw new Error('unreachable');

    const exit = service.handleExitReading({
      rawPlate: 'SCALE004',
      cameraId: 'cam-exit-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: null,
      weightCaptureFailed: true,
      failureReason: 'socket_error',
      waitedMs: 500,
    });
    if (exit.kind !== 'ticket_closed') throw new Error('unreachable');

    const scaleEvents = scaleRawEventsFor(exit.ticket.id).filter((e) => e.direction === 'exit');
    expect(scaleEvents).toEqual([
      {
        direction: 'exit',
        weightKg: null,
        weightCaptureFailed: true,
        failureReason: 'socket_error',
        waitedMs: 500,
      },
    ]);
  });

  it('records a scale raw event when flagging an anomaly', () => {
    const result = service.handleExitReading({
      rawPlate: 'SCALE005',
      cameraId: 'cam-exit-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: 9000,
      weightCaptureFailed: false,
    });
    if (result.kind !== 'anomaly_flagged') throw new Error('unreachable');

    const scaleEvents = scaleRawEventsFor(result.ticket.id);
    expect(scaleEvents).toEqual([{ direction: 'exit', weightKg: 9000, weightCaptureFailed: false }]);
  });
});

describe('SessionService — internal trucks (pre-registered tare)', () => {
  function registerTruckWithActiveTare(plate: string, tareWeightKg: number): void {
    const truck = truckRepo.createTruck({ plate, label: 'Test truck' });
    const conjunto = truckRepo.createConjunto({ name: `Conjunto ${plate}` });
    const assignment = truckRepo.assignConjuntoToTruck({ truckId: truck.id, conjuntoId: conjunto.id, tareWeightKg });
    truckRepo.activateTruckConjunto(assignment.id);
  }

  it('closes the ticket immediately on an entrance reading, using the active tare as the exit weight', () => {
    registerTruckWithActiveTare('INT0001', 9000);

    const result = service.handleEntranceReading({
      rawPlate: 'int0001',
      cameraId: 'cam-entrance-1',
      timestamp: new Date('2026-01-01T08:00:00Z'),
      receivedAt: new Date('2026-01-01T08:00:01Z'),
      weightKg: 21000,
      weightCaptureFailed: false,
    });

    expect(result.kind).toBe('ticket_closed_via_tare');
    if (result.kind !== 'ticket_closed_via_tare') throw new Error('unreachable');
    expect(result.ticket.status).toBe('CLOSED');
    expect(result.ticket.entryWeightKg).toBe(21000);
    expect(result.ticket.entryCameraId).toBe('cam-entrance-1');
    expect(result.ticket.exitWeightKg).toBe(9000);
    expect(result.ticket.exitCameraId).toBeNull();
    expect(result.ticket.netWeightKg).toBe(12000);
    expect(auditActionsFor(result.ticket.id)).toEqual([
      'entry_captured',
      'internal_truck_exit_via_tare',
    ]);
  });

  it('closes the ticket immediately on an exit reading, using the active tare as the entry weight', () => {
    registerTruckWithActiveTare('INT0002', 9000);

    const result = service.handleExitReading({
      rawPlate: 'int0002',
      cameraId: 'cam-exit-1',
      timestamp: new Date('2026-01-01T08:00:00Z'),
      receivedAt: new Date('2026-01-01T08:00:01Z'),
      weightKg: 23000,
      weightCaptureFailed: false,
    });

    expect(result.kind).toBe('ticket_closed');
    if (result.kind !== 'ticket_closed') throw new Error('unreachable');
    expect(result.ticket.status).toBe('CLOSED');
    expect(result.ticket.entryWeightKg).toBe(9000);
    expect(result.ticket.entryCameraId).toBeNull();
    expect(result.ticket.exitWeightKg).toBe(23000);
    expect(result.ticket.exitCameraId).toBe('cam-exit-1');
    expect(result.ticket.netWeightKg).toBe(14000);
    expect(auditActionsFor(result.ticket.id)).toEqual([
      'internal_truck_entry_via_tare',
      'exit_captured',
    ]);
  });

  it('still closes via tare when the real leg scale capture fails, leaving net weight null', () => {
    registerTruckWithActiveTare('INT0003', 9000);

    const result = service.handleEntranceReading({
      rawPlate: 'INT0003',
      cameraId: 'cam-entrance-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: null,
      weightCaptureFailed: true,
    });

    expect(result.kind).toBe('ticket_closed_via_tare');
    if (result.kind !== 'ticket_closed_via_tare') throw new Error('unreachable');
    expect(result.ticket.entryWeightKg).toBeNull();
    expect(result.ticket.entryCaptureFailed).toBe(true);
    expect(result.ticket.exitWeightKg).toBe(9000);
    expect(result.ticket.netWeightKg).toBeNull();
    expect(auditActionsFor(result.ticket.id)).toEqual([
      'entry_capture_failed',
      'internal_truck_exit_via_tare',
    ]);
  });

  it('falls through to the normal external-truck flow when the internal truck has no active conjunto', () => {
    truckRepo.createTruck({ plate: 'INT0004', label: 'No conjunto yet' });

    const result = service.handleEntranceReading({
      rawPlate: 'INT0004',
      cameraId: 'cam-entrance-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: 18000,
      weightCaptureFailed: false,
    });

    expect(result.kind).toBe('ticket_opened');
    if (result.kind !== 'ticket_opened') throw new Error('unreachable');
    expect(result.ticket.status).toBe('OPEN');
    expect(auditActionsFor(result.ticket.id)).toEqual(['entry_captured']);
  });

  it('only ever creates one ticket per internal-truck event, never leaving one OPEN', () => {
    registerTruckWithActiveTare('INT0005', 9000);

    service.handleExitReading({
      rawPlate: 'INT0005',
      cameraId: 'cam-exit-1',
      timestamp: new Date(),
      receivedAt: new Date(),
      weightKg: 20000,
      weightCaptureFailed: false,
    });

    expect(repo.findOpenByPlate('INT0005')).toBeUndefined();
  });
});
