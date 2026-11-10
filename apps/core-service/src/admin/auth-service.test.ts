import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { seedAdminUser } from '../db/seed-admin.js';
import { createUserRepository, type UserRepository } from '../users/repository.js';
import { createAdminAuthService, type AdminAuthService } from './auth-service.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let userRepo: UserRepository;
let authService: AdminAuthService;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-auth-service-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  userRepo = createUserRepository(db);
  authService = createAdminAuthService(userRepo);
  seedAdminUser(db, 'admin', 'correct-password');
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('verifyCredentials', () => {
  it('returns the user when the password matches', () => {
    expect(authService.verifyCredentials('admin', 'correct-password')?.username).toBe('admin');
  });

  it('returns null for a wrong password', () => {
    expect(authService.verifyCredentials('admin', 'wrong-password')).toBeNull();
  });

  it('returns null for an unknown username', () => {
    expect(authService.verifyCredentials('nobody', 'correct-password')).toBeNull();
  });

  it('returns null for an inactive user even with the right password', () => {
    const admin = userRepo.findUserByUsername('admin')!;
    userRepo.setActive(admin.id, false);

    expect(authService.verifyCredentials('admin', 'correct-password')).toBeNull();
  });
});

describe('hashPassword / verifyPassword', () => {
  it('round-trips a password through its bcrypt hash', () => {
    const hash = authService.hashPassword('new-secret');
    const user = userRepo.setPassword(userRepo.findUserByUsername('admin')!.id, hash, false);

    expect(hash).not.toBe('new-secret');
    expect(authService.verifyPassword(user, 'new-secret')).toBe(true);
    expect(authService.verifyPassword(user, 'correct-password')).toBe(false);
  });
});
