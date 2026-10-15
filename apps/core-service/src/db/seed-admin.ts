import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { adminUsers } from './schema.js';

const BCRYPT_ROUNDS = 10;

export function parseArgs(argv: string[]): { username: string; password: string } {
  const args = new Map<string, string>();
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key && value) {
      args.set(key, value);
    }
  }

  const username = args.get('username') ?? process.env.ADMIN_SEED_USERNAME;
  const password = args.get('password') ?? process.env.ADMIN_SEED_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'Usage: npm run db:seed-admin --workspace=@tare/core-service -- --username=<u> --password=<p>\n' +
        '(or set ADMIN_SEED_USERNAME / ADMIN_SEED_PASSWORD)',
    );
  }

  return { username, password };
}

/** Creates the admin user, or resets its password if the username already exists. */
export function seedAdminUser(db: Db, username: string, password: string): { created: boolean } {
  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const existing = db.select().from(adminUsers).where(eq(adminUsers.username, username)).get();

  if (existing) {
    db.update(adminUsers).set({ passwordHash }).where(eq(adminUsers.id, existing.id)).run();
    return { created: false };
  }

  db.insert(adminUsers).values({ username, passwordHash, createdAt: new Date() }).run();
  return { created: true };
}
