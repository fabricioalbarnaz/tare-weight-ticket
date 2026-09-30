import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { createTicketRepository, type TicketRepository } from './repository.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-repo-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createTicketRepository(db);
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('TicketRepository', () => {
  it('returns undefined when no open ticket exists for a plate', () => {
    expect(repo.findOpenByPlate('ABC1234')).toBeUndefined();
  });

  it('creates an open ticket with an assigned sequential ticket number', () => {
    const ticket = repo.create({
      plate: 'ABC1234',
      entryAt: new Date('2026-01-01T10:00:00Z'),
      entryWeightKg: 20000,
      entryCameraId: 'cam-entrance-1',
      entryCaptureFailed: false,
    });

    expect(ticket.status).toBe('OPEN');
    expect(ticket.ticketNumber).toBe(1);
    expect(ticket.plate).toBe('ABC1234');
    expect(ticket.entryWeightKg).toBe(20000);
    expect(ticket.exitWeightKg).toBeNull();
  });

  it('assigns increasing ticket numbers across creates and anomalies', () => {
    const first = repo.create({
      plate: 'AAA1111',
      entryAt: new Date(),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });
    const anomaly = repo.flagAnomaly({
      plate: 'BBB2222',
      exitAt: new Date(),
      exitWeightKg: 500,
      exitCameraId: 'cam-2',
      exitCaptureFailed: false,
    });
    const second = repo.create({
      plate: 'CCC3333',
      entryAt: new Date(),
      entryWeightKg: 2000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    expect([first.ticketNumber, anomaly.ticketNumber, second.ticketNumber]).toEqual([1, 2, 3]);
  });

  it('finds an open ticket by plate', () => {
    const created = repo.create({
      plate: 'XYZ9999',
      entryAt: new Date(),
      entryWeightKg: 5000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    const found = repo.findOpenByPlate('XYZ9999');

    expect(found?.id).toBe(created.id);
  });

  it('overwrites entry data on updateEntry (retrigger case)', () => {
    const created = repo.create({
      plate: 'RET1234',
      entryAt: new Date('2026-01-01T10:00:00Z'),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    const updated = repo.updateEntry(created.id, {
      entryAt: new Date('2026-01-01T10:05:00Z'),
      entryWeightKg: 1100,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.entryWeightKg).toBe(1100);
    expect(updated.status).toBe('OPEN');
    // Still findable as the single open ticket for the plate — not duplicated.
    expect(repo.findOpenByPlate('RET1234')?.id).toBe(created.id);
  });

  it('refuses to updateEntry on a ticket that is no longer OPEN', () => {
    const created = repo.create({
      plate: 'DONE0001',
      entryAt: new Date(),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });
    repo.close(created.id, {
      exitAt: new Date(),
      exitWeightKg: 500,
      exitCameraId: 'cam-2',
      exitCaptureFailed: false,
    });

    expect(() =>
      repo.updateEntry(created.id, {
        entryAt: new Date(),
        entryWeightKg: 999,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      }),
    ).toThrow(/not found or not OPEN/);
  });

  it('refuses to close a ticket a second time', () => {
    const created = repo.create({
      plate: 'DONE0002',
      entryAt: new Date(),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });
    repo.close(created.id, {
      exitAt: new Date(),
      exitWeightKg: 500,
      exitCameraId: 'cam-2',
      exitCaptureFailed: false,
    });

    expect(() =>
      repo.close(created.id, {
        exitAt: new Date(),
        exitWeightKg: 999,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      }),
    ).toThrow(/not found or not OPEN/);
  });

  it('closes a ticket and computes the net weight (arrive loaded, leave empty)', () => {
    const created = repo.create({
      plate: 'LOAD001',
      entryAt: new Date('2026-01-01T08:00:00Z'),
      entryWeightKg: 20000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    const closed = repo.close(created.id, {
      exitAt: new Date('2026-01-01T09:00:00Z'),
      exitWeightKg: 8000,
      exitCameraId: 'cam-2',
      exitCaptureFailed: false,
    });

    expect(closed.status).toBe('CLOSED');
    expect(closed.netWeightKg).toBe(12000);
    expect(repo.findOpenByPlate('LOAD001')).toBeUndefined();
  });

  it('closes a ticket and computes the net weight (arrive empty, leave loaded)', () => {
    const created = repo.create({
      plate: 'LOAD002',
      entryAt: new Date('2026-01-01T08:00:00Z'),
      entryWeightKg: 8000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    const closed = repo.close(created.id, {
      exitAt: new Date('2026-01-01T09:00:00Z'),
      exitWeightKg: 20000,
      exitCameraId: 'cam-2',
      exitCaptureFailed: false,
    });

    expect(closed.netWeightKg).toBe(12000);
  });

  it('leaves net weight null when the entry weight capture had failed', () => {
    const created = repo.create({
      plate: 'FAIL001',
      entryAt: new Date(),
      entryWeightKg: null,
      entryCameraId: 'cam-1',
      entryCaptureFailed: true,
    });

    const closed = repo.close(created.id, {
      exitAt: new Date(),
      exitWeightKg: 8000,
      exitCameraId: 'cam-2',
      exitCaptureFailed: false,
    });

    expect(closed.status).toBe('CLOSED');
    expect(closed.netWeightKg).toBeNull();
  });

  it('creates an ANOMALY ticket via flagAnomaly with no entry data', () => {
    const ticket = repo.flagAnomaly({
      plate: 'NOENTRY1',
      exitAt: new Date('2026-01-01T09:00:00Z'),
      exitWeightKg: 9000,
      exitCameraId: 'cam-2',
      exitCaptureFailed: false,
    });

    expect(ticket.status).toBe('ANOMALY');
    expect(ticket.entryAt).toBeNull();
    expect(ticket.entryWeightKg).toBeNull();
    expect(ticket.exitWeightKg).toBe(9000);
  });

  it('records an audit log entry linked to a ticket', () => {
    const created = repo.create({
      plate: 'AUD0001',
      entryAt: new Date(),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    expect(() =>
      repo.appendAuditLog(created.id, 'system', 'entry_captured', { weight: 1000 }),
    ).not.toThrow();
  });

  it('records a raw event not linked to any ticket (unreadable plate case)', () => {
    expect(() =>
      repo.recordRawEvent('camera_entrance', { plate: '', raw: 'unreadable' }),
    ).not.toThrow();
  });
});
