import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { seedAdminUser } from '../db/seed-admin.js';
import { createTicketRepository, type TicketRepository } from '../tickets/repository.js';
import { createAdminAuthService, type AdminAuthService } from './auth-service.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;
let authService: AdminAuthService;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-auth-service-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createTicketRepository(db);
  authService = createAdminAuthService(repo);
  seedAdminUser(db, 'admin', 'correct-password');
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('verifyCredentials', () => {
  it('returns the username when the password matches', () => {
    expect(authService.verifyCredentials('admin', 'correct-password')).toBe('admin');
  });

  it('returns null for a wrong password', () => {
    expect(authService.verifyCredentials('admin', 'wrong-password')).toBeNull();
  });

  it('returns null for an unknown username', () => {
    expect(authService.verifyCredentials('nobody', 'correct-password')).toBeNull();
  });
});
