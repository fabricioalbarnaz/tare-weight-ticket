import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '../../drizzle');

export function createDb(dbPath: string): { db: Db; sqlite: Database.Database } {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);
  // Not WAL: this install's production deployment (docker/docker-compose.yml)
  // bind-mounts a Windows host folder into the Linux container for this file.
  // WAL needs shared-memory (mmap) coordination between connections, which
  // isn't reliable across that bind-mount boundary on Docker Desktop for
  // Windows — writes can silently stop reaching disk after a container
  // restart (incident 2026-10-31, ~35h/52 tickets recovered from the live
  // process's in-memory state). DELETE's plain file-lock based journal has
  // no such requirement. A future install using a real Linux host (or a
  // Docker named volume instead of a Windows bind mount) wouldn't hit this
  // and could safely reintroduce WAL for its better write concurrency.
  sqlite.pragma('journal_mode = DELETE');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return { db, sqlite };
}
