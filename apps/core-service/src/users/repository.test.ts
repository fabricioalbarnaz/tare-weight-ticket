import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { createUserRepository, type CreateUserInput, type UserRepository } from './repository.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: UserRepository;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-users-repo-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createUserRepository(db);
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

function input(overrides: Partial<CreateUserInput> = {}): CreateUserInput {
  return {
    username: 'joao',
    name: 'João Silva',
    role: 'operator',
    passwordHash: 'hashed',
    mustChangePassword: true,
    ...overrides,
  };
}

describe('UserRepository', () => {
  it('creates an active user and finds it by id and username', () => {
    const created = repo.createUser(input());

    expect(created.active).toBe(true);
    expect(created.role).toBe('operator');
    expect(created.mustChangePassword).toBe(true);
    expect(repo.findUserById(created.id)?.username).toBe('joao');
    expect(repo.findUserByUsername('joao')?.id).toBe(created.id);
  });

  it('returns undefined for an unknown user', () => {
    expect(repo.findUserById(999)).toBeUndefined();
    expect(repo.findUserByUsername('nobody')).toBeUndefined();
  });

  it('lists users ordered by name', () => {
    repo.createUser(input({ username: 'zeca', name: 'Zeca' }));
    repo.createUser(input({ username: 'ana', name: 'Ana' }));

    expect(repo.listUsers().map((u) => u.name)).toEqual(['Ana', 'Zeca']);
  });

  it('updates name and role', () => {
    const created = repo.createUser(input());
    const updated = repo.updateUser(created.id, { name: 'João S.', role: 'admin' });

    expect(updated.name).toBe('João S.');
    expect(updated.role).toBe('admin');
  });

  it('sets the password hash and the must-change flag together', () => {
    const created = repo.createUser(input());
    const updated = repo.setPassword(created.id, 'new-hash', false);

    expect(updated.passwordHash).toBe('new-hash');
    expect(updated.mustChangePassword).toBe(false);
  });

  it('counts only active admins', () => {
    const first = repo.createUser(input({ username: 'a1', role: 'admin' }));
    repo.createUser(input({ username: 'a2', role: 'admin' }));
    repo.createUser(input({ username: 'op', role: 'operator' }));
    expect(repo.countActiveAdmins()).toBe(2);

    repo.setActive(first.id, false);
    expect(repo.countActiveAdmins()).toBe(1);
  });

  it('throws when updating an unknown user', () => {
    expect(() => repo.setActive(999, false)).toThrow(/not found/);
  });
});
