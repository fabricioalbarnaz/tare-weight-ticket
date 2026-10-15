import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client.js';
import { adminUsers } from './schema.js';
import { parseArgs, seedAdminUser } from './seed-admin.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-seed-admin-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('parseArgs', () => {
  it('parses --username and --password flags', () => {
    expect(parseArgs(['--username=admin', '--password=secret'])).toEqual({
      username: 'admin',
      password: 'secret',
    });
  });

  it('throws when username or password is missing and no env fallback exists', () => {
    const originalUsername = process.env.ADMIN_SEED_USERNAME;
    const originalPassword = process.env.ADMIN_SEED_PASSWORD;
    delete process.env.ADMIN_SEED_USERNAME;
    delete process.env.ADMIN_SEED_PASSWORD;

    expect(() => parseArgs([])).toThrow(/Usage:/);

    if (originalUsername !== undefined) process.env.ADMIN_SEED_USERNAME = originalUsername;
    if (originalPassword !== undefined) process.env.ADMIN_SEED_PASSWORD = originalPassword;
  });
});

describe('seedAdminUser', () => {
  it('creates a new admin user with a bcrypt-hashed password', () => {
    const result = seedAdminUser(db, 'admin', 'secret123');

    expect(result.created).toBe(true);
    const row = db.select().from(adminUsers).where(eq(adminUsers.username, 'admin')).get();
    expect(row).toBeDefined();
    expect(row!.passwordHash).not.toBe('secret123');
    expect(bcrypt.compareSync('secret123', row!.passwordHash)).toBe(true);
  });

  it('resets the password for an existing username instead of duplicating it', () => {
    seedAdminUser(db, 'admin', 'first-password');
    const result = seedAdminUser(db, 'admin', 'second-password');

    expect(result.created).toBe(false);
    const rows = db.select().from(adminUsers).where(eq(adminUsers.username, 'admin')).all();
    expect(rows).toHaveLength(1);
    expect(bcrypt.compareSync('second-password', rows[0]!.passwordHash)).toBe(true);
  });
});
