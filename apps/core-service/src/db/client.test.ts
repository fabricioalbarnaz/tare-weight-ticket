import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client.js';

let dbPath: string | undefined;
let openSqlite: ReturnType<typeof createDb>['sqlite'] | undefined;

afterEach(() => {
  openSqlite?.close();
  openSqlite = undefined;
  if (dbPath) {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
    dbPath = undefined;
  }
});

function openTempDb(): Db {
  dbPath = path.join(os.tmpdir(), `tare-test-${randomUUID()}.sqlite`);
  const { db, sqlite } = createDb(dbPath);
  openSqlite = sqlite;
  return db;
}

describe('createDb', () => {
  it('creates the parent directory and applies migrations', () => {
    const db = openTempDb();

    const tableNames = db
      .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((row) => row.name);

    expect(tableNames).toEqual(
      expect.arrayContaining(['admin_users', 'raw_events', 'ticket_audit_log', 'tickets']),
    );
  });

  it('enables WAL mode and foreign key enforcement', () => {
    const db = openTempDb();

    const [{ journal_mode: journalMode }] = db.all<{ journal_mode: string }>(
      sql`PRAGMA journal_mode`,
    );
    const [{ foreign_keys: foreignKeys }] = db.all<{ foreign_keys: number }>(
      sql`PRAGMA foreign_keys`,
    );

    expect(journalMode).toBe('wal');
    expect(foreignKeys).toBe(1);
  });

  it('is safe to run migrations twice against the same file (idempotent)', () => {
    dbPath = path.join(os.tmpdir(), `tare-test-${randomUUID()}.sqlite`);
    const first = createDb(dbPath);
    first.sqlite.close();

    const second = createDb(dbPath);
    openSqlite = second.sqlite;

    const tableNames = second.db
      .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((row) => row.name);

    expect(tableNames).toContain('tickets');
  });
});
