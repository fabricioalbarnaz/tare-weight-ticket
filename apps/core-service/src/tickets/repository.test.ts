import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { createTicketRepository, type Ticket, type TicketRepository } from './repository.js';
import { createTicketEvents } from './ticket-events.js';

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

  it('overwrites entry data on updateEntry (admin manual-edit path)', () => {
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
    expect(repo.findOpenByPlate('RET1234')?.id).toBe(created.id);
  });

  it('findOpenByPlate returns the most recently opened ticket when more than one is OPEN for a plate', () => {
    const older = repo.create({
      plate: 'STACK002',
      entryAt: new Date('2026-01-01T08:00:00Z'),
      entryWeightKg: 1000,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });
    const newer = repo.create({
      plate: 'STACK002',
      entryAt: new Date('2026-01-01T08:05:00Z'),
      entryWeightKg: 1100,
      entryCameraId: 'cam-1',
      entryCaptureFailed: false,
    });

    expect(older.status).toBe('OPEN');
    expect(repo.findOpenByPlate('STACK002')?.id).toBe(newer.id);
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

    it('sorts by last update, not by creation order', () => {
      const first = repo.create({
        plate: 'UPD0001',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.create({
        plate: 'UPD0002',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });

      repo.updateEntry(first.id, {
        entryAt: new Date(),
        entryWeightKg: 1200,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });

      const result = repo.listTickets({});
      expect(result.items.map((t) => t.plate)).toEqual(['UPD0001', 'UPD0002']);
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

    it('flags suspectWeight when an audit log entry recorded attemptsUsed > 1', () => {
      const suspect = repo.create({
        plate: 'SUSP0001',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.appendAuditLog(suspect.id, 'system', 'entry_captured', {
        weightKg: 1000,
        cameraId: 'cam-1',
        attemptsUsed: 3,
      });

      const normal = repo.create({
        plate: 'SUSP0002',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.appendAuditLog(normal.id, 'system', 'entry_captured', {
        weightKg: 1000,
        cameraId: 'cam-1',
        attemptsUsed: 1,
      });

      const noAttemptsField = repo.create({
        plate: 'SUSP0003',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.appendAuditLog(noAttemptsField.id, 'system', 'entry_captured', {
        weightKg: 1000,
        cameraId: 'cam-1',
      });

      const result = repo.listTickets({});

      const byId = new Map(result.items.map((t) => [t.id, t.suspectWeight]));
      expect(byId.get(suspect.id)).toBe(true);
      expect(byId.get(normal.id)).toBe(false);
      expect(byId.get(noAttemptsField.id)).toBe(false);
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

  describe('findMostRecentExitAt', () => {
    it('returns null when no ticket has ever closed', () => {
      repo.create({
        plate: 'OPEN0001',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });

      expect(repo.findMostRecentExitAt()).toBeNull();
    });

    it('returns the exitAt of the most recently closed ticket, across different plates', () => {
      const first = repo.create({
        plate: 'EXIT0001',
        entryAt: new Date('2026-01-01T08:00:00Z'),
        entryWeightKg: 20000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.close(first.id, {
        exitAt: new Date('2026-01-01T09:00:00Z'),
        exitWeightKg: 8000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      const second = repo.create({
        plate: 'EXIT0002',
        entryAt: new Date('2026-01-01T10:00:00Z'),
        entryWeightKg: 21000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.close(second.id, {
        exitAt: new Date('2026-01-01T11:00:00Z'),
        exitWeightKg: 9000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      expect(repo.findMostRecentExitAt()).toEqual(new Date('2026-01-01T11:00:00Z'));
    });
  });

  describe('findMostRecentEntryAtByPlate / findMostRecentExitAtByPlate', () => {
    it('returns null on an empty DB', () => {
      expect(repo.findMostRecentEntryAtByPlate('DUP0001')).toBeNull();
      expect(repo.findMostRecentExitAtByPlate('DUP0001')).toBeNull();
    });

    it('returns null when the plate has no ticket', () => {
      repo.create({
        plate: 'DUP0002',
        entryAt: new Date('2026-01-01T08:00:00Z'),
        entryWeightKg: 20000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });

      expect(repo.findMostRecentEntryAtByPlate('DUP0999')).toBeNull();
      expect(repo.findMostRecentExitAtByPlate('DUP0999')).toBeNull();
    });

    it('returns the latest entryAt/exitAt for that plate across multiple tickets, unaffected by other plates', () => {
      const first = repo.create({
        plate: 'DUP0003',
        entryAt: new Date('2026-01-01T08:00:00Z'),
        entryWeightKg: 20000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.close(first.id, {
        exitAt: new Date('2026-01-01T09:00:00Z'),
        exitWeightKg: 8000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      // Same plate re-enters later (closed-then-reopened history).
      const second = repo.create({
        plate: 'DUP0003',
        entryAt: new Date('2026-01-02T08:00:00Z'),
        entryWeightKg: 21000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.close(second.id, {
        exitAt: new Date('2026-01-02T09:00:00Z'),
        exitWeightKg: 9000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      // A different plate, with later timestamps, must not leak in.
      const other = repo.create({
        plate: 'DUP0004',
        entryAt: new Date('2026-01-03T08:00:00Z'),
        entryWeightKg: 22000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.close(other.id, {
        exitAt: new Date('2026-01-03T09:00:00Z'),
        exitWeightKg: 10000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      expect(repo.findMostRecentEntryAtByPlate('DUP0003')).toEqual(new Date('2026-01-02T08:00:00Z'));
      expect(repo.findMostRecentExitAtByPlate('DUP0003')).toEqual(new Date('2026-01-02T09:00:00Z'));
    });
  });

  describe('findMostRecentClosedTicketByPlate', () => {
    it('returns undefined when the plate has no CLOSED ticket', () => {
      repo.create({
        plate: 'RWG0001',
        entryAt: new Date(),
        entryWeightKg: 1000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });

      expect(repo.findMostRecentClosedTicketByPlate('RWG0001')).toBeUndefined();
    });

    it('ignores an ANOMALY ticket for the plate (never CLOSED, so never a re-weigh base)', () => {
      repo.flagAnomaly({
        plate: 'RWG0002',
        exitAt: new Date(),
        exitWeightKg: 5000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      expect(repo.findMostRecentClosedTicketByPlate('RWG0002')).toBeUndefined();
    });

    it('returns the most recently closed ticket for that plate, by exitAt, ignoring other plates', () => {
      const first = repo.create({
        plate: 'RWG0003',
        entryAt: new Date('2026-01-01T08:00:00Z'),
        entryWeightKg: 20000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.close(first.id, {
        exitAt: new Date('2026-01-01T09:00:00Z'),
        exitWeightKg: 8000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      const second = repo.create({
        plate: 'RWG0003',
        entryAt: new Date('2026-01-02T08:00:00Z'),
        entryWeightKg: 21000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      const secondClosed = repo.close(second.id, {
        exitAt: new Date('2026-01-02T09:00:00Z'),
        exitWeightKg: 9000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      const other = repo.create({
        plate: 'RWG0004',
        entryAt: new Date('2026-01-03T08:00:00Z'),
        entryWeightKg: 22000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      repo.close(other.id, {
        exitAt: new Date('2026-01-03T09:00:00Z'),
        exitWeightKg: 10000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      expect(repo.findMostRecentClosedTicketByPlate('RWG0003')).toEqual(secondClosed);
    });
  });

  describe('linkReweigh / create with reweighOfTicketId', () => {
    it('sets reweighOfTicketId on the new ticket and reweighedByTicketId on the original', () => {
      const original = repo.create({
        plate: 'RWG0005',
        entryAt: new Date('2026-01-01T08:00:00Z'),
        entryWeightKg: 20000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      const closedOriginal = repo.close(original.id, {
        exitAt: new Date('2026-01-01T09:00:00Z'),
        exitWeightKg: 8000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });

      const reweigh = repo.create({
        plate: 'RWG0005',
        entryAt: closedOriginal.entryAt!,
        entryWeightKg: closedOriginal.entryWeightKg,
        entryCameraId: closedOriginal.entryCameraId,
        entryCaptureFailed: false,
        reweighOfTicketId: closedOriginal.id,
      });

      expect(reweigh.reweighOfTicketId).toBe(closedOriginal.id);
      expect(reweigh.reweighedByTicketId).toBeNull();

      repo.linkReweigh(closedOriginal.id, reweigh.id);

      expect(repo.findById(closedOriginal.id)?.reweighedByTicketId).toBe(reweigh.id);
    });

    it('throws when linking a re-weigh to a ticket id that does not exist', () => {
      expect(() => repo.linkReweigh(999999, 1)).toThrow(/999999/);
    });
  });

  describe('ticket change events', () => {
    it('emits a change event for every mutating method', () => {
      const changes: Ticket[] = [];
      const events = createTicketEvents();
      events.onChanged((ticket) => changes.push(ticket));
      const trackedRepo = createTicketRepository(db, events);

      const created = trackedRepo.create({
        plate: 'EVT0001',
        entryAt: new Date('2026-01-01T08:00:00Z'),
        entryWeightKg: 20000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      expect(changes).toHaveLength(1);

      trackedRepo.updateEntry(created.id, {
        entryAt: new Date('2026-01-01T08:05:00Z'),
        entryWeightKg: 21000,
        entryCameraId: 'cam-1',
        entryCaptureFailed: false,
      });
      expect(changes).toHaveLength(2);

      const closed = trackedRepo.close(created.id, {
        exitAt: new Date('2026-01-01T09:00:00Z'),
        exitWeightKg: 8000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });
      expect(changes).toHaveLength(3);

      trackedRepo.correctExit(closed.id, {
        exitAt: new Date('2026-01-01T09:05:00Z'),
        exitWeightKg: 8500,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });
      expect(changes).toHaveLength(4);

      trackedRepo.markPrinted(closed.id, new Date());
      expect(changes).toHaveLength(5);

      trackedRepo.flagAnomaly({
        plate: 'EVT0002',
        exitAt: new Date('2026-01-01T10:00:00Z'),
        exitWeightKg: 5000,
        exitCameraId: 'cam-2',
        exitCaptureFailed: false,
      });
      expect(changes).toHaveLength(6);
    });
  });
});
