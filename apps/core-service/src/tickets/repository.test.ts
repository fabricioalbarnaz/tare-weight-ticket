import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { adminUsers } from '../db/schema.js';
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

  it('marks a CLOSED ticket as printed', () => {
    const created = repo.create({
      plate: 'PRINT001',
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

    const printedAt = new Date('2026-01-01T10:00:00Z');
    const updated = repo.markPrinted(created.id, printedAt);

    expect(updated.printedAt).toEqual(printedAt);
  });

  it('refuses to mark a ticket as printed when it is not CLOSED', () => {
    const created = repo.create({
      plate: 'PRINT002',
      entryAt: new Date(),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    expect(() => repo.markPrinted(created.id, new Date())).toThrow(/not found or not CLOSED/);
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

  it('commits all writes made inside a successful transaction', () => {
    const ticket = repo.transaction(() => {
      const created = repo.create({
        plate: 'TXOK0001',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.appendAuditLog(created.id, 'system', 'entry_captured', { weightKg: 1000 });
      return created;
    });

    expect(repo.findById(ticket.id)?.plate).toBe('TXOK0001');
  });

  it('rolls back all writes made inside a failed transaction', () => {
    expect(() =>
      repo.transaction(() => {
        repo.create({
          plate: 'TXFAIL01',
          entryAt: new Date(),
          entryWeightKg: 1000,
          entryCameraId: 'cam-1',
          entryCaptureFailed: false,
        });
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(repo.findOpenByPlate('TXFAIL01')).toBeUndefined();
  });

  it('defaults createdByAdmin to false, and sets it true when requested (manual admin create)', () => {
    const auto = repo.create({
      plate: 'AUTO0001',
      entryAt: new Date(),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });
    const manual = repo.create({
      plate: 'MANUAL01',
      entryAt: new Date(),
      entryWeightKg: 1000,
      entryCameraId: null,
      entryCaptureFailed: false,
      createdByAdmin: true,
    });

    expect(auto.createdByAdmin).toBe(false);
    expect(manual.createdByAdmin).toBe(true);
  });

  describe('correctExit', () => {
    it('updates exit data and recomputes net weight on a CLOSED ticket, keeping it CLOSED', () => {
      const created = repo.create({
        plate: 'CORR0001',
        entryAt: new Date('2026-01-01T08:00:00Z'),
        entryWeightKg: 20000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.close(created.id, {
        exitAt: new Date('2026-01-01T09:00:00Z'),
        exitWeightKg: 8000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      const corrected = repo.correctExit(created.id, {
        exitAt: new Date('2026-01-01T09:05:00Z'),
        exitWeightKg: 7500,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      expect(corrected.status).toBe('CLOSED');
      expect(corrected.exitWeightKg).toBe(7500);
      expect(corrected.netWeightKg).toBe(12500);
    });

    it('refuses to correct exit on a ticket that is not CLOSED', () => {
      const created = repo.create({
        plate: 'CORR0002',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });

      expect(() =>
        repo.correctExit(created.id, {
          exitAt: new Date(),
          exitWeightKg: 500,
          exitCameraId: 'cam-2',
          exitCaptureFailed: false,
        }),
      ).toThrow(/not found or not CLOSED/);
    });
  });

  describe('listTickets', () => {
    it('paginates and orders results most-recent-first', () => {
      for (const plate of ['LIST0001', 'LIST0002', 'LIST0003']) {
        repo.create({
          plate,
          entryAt: new Date(),
          entryWeightKg: 1000,
          entryCameraId: 'cam-1',
          entryCaptureFailed: false,
        });
      }

      const page1 = repo.listTickets({ page: 1, pageSize: 2 });
      expect(page1.total).toBe(3);
      expect(page1.items.map((t) => t.plate)).toEqual(['LIST0003', 'LIST0002']);

      const page2 = repo.listTickets({ page: 2, pageSize: 2 });
      expect(page2.items.map((t) => t.plate)).toEqual(['LIST0001']);
    });

    it('filters by status', () => {
      const open = repo.create({
        plate: 'FILT0001',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.flagAnomaly({
        plate: 'FILT0002',
        exitAt: new Date(),
        exitWeightKg: 500,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      const result = repo.listTickets({ status: 'OPEN' });

      expect(result.items.map((t) => t.id)).toEqual([open.id]);
    });

    it('filters by plate substring, case-insensitively', () => {
      repo.create({
        plate: 'SEARCH99',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.create({
        plate: 'OTHER001',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });

      const result = repo.listTickets({ search: 'search' });

      expect(result.items.map((t) => t.plate)).toEqual(['SEARCH99']);
    });
  });

  describe('listUnresolvedEvents', () => {
    it('returns only raw events with no linked ticket', () => {
      repo.recordRawEvent('camera_entrance', { plate: '', raw: 'unreadable' });
      const ticket = repo.create({
        plate: 'LINKED01',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.recordRawEvent('camera_entrance', { plate: 'LINKED01' }, ticket.id);

      const result = repo.listUnresolvedEvents({});

      expect(result.total).toBe(1);
      expect(result.items[0]?.linkedTicketId).toBeNull();
    });

    it('filters by source', () => {
      repo.recordRawEvent('camera_entrance', { raw: 'a' });
      repo.recordRawEvent('scale', { raw: 'b' });

      const result = repo.listUnresolvedEvents({ source: 'scale' });

      expect(result.total).toBe(1);
      expect(result.items[0]?.source).toBe('scale');
    });
  });

  describe('findAuditLogByTicketId', () => {
    it('returns audit entries for a ticket, most-recent-first', () => {
      const ticket = repo.create({
        plate: 'AUD0002',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.appendAuditLog(ticket.id, 'system', 'entry_captured', { weightKg: 1000 });
      repo.appendAuditLog(ticket.id, 'admin', 'entry_edited', { reason: 'misread' });

      const entries = repo.findAuditLogByTicketId(ticket.id);

      expect(entries.map((e) => e.action)).toEqual(['entry_edited', 'entry_captured']);
    });

    it('returns an empty array for a ticket with no audit entries', () => {
      const ticket = repo.create({
        plate: 'AUD0003',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });

      expect(repo.findAuditLogByTicketId(ticket.id)).toEqual([]);
    });
  });

  describe('findLastEventTimestamp', () => {
    it('returns null when no event from that source has ever arrived', () => {
      expect(repo.findLastEventTimestamp('camera_entrance')).toBeNull();
    });

    it('returns the timestamp of the most recent event from that source', () => {
      repo.recordRawEvent('camera_entrance', { raw: 'first' });
      repo.recordRawEvent('scale', { raw: 'other-source' });
      repo.recordRawEvent('camera_entrance', { raw: 'second' });

      expect(repo.findLastEventTimestamp('camera_entrance')).toBeInstanceOf(Date);
    });
  });

  describe('findAdminUserByUsername', () => {
    it('finds a seeded admin user by username', () => {
      db.insert(adminUsers)
        .values({ username: 'admin', passwordHash: 'hashed', createdAt: new Date() })
        .run();

      expect(repo.findAdminUserByUsername('admin')?.username).toBe('admin');
    });

    it('returns undefined for an unknown username', () => {
      expect(repo.findAdminUserByUsername('nobody')).toBeUndefined();
    });
  });
});
