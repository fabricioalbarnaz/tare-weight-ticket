import { and, asc, count, eq } from 'drizzle-orm';
import { adminUsers, type UserRole } from '../db/schema.js';
import type { Db } from '../db/client.js';

export type AdminUser = typeof adminUsers.$inferSelect;

export interface CreateUserInput {
  username: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  mustChangePassword: boolean;
}

/**
 * Admin UI users (admins and operators). See
 * docs/plans/2026-11-09-user-management-plan.md / master plan §11.
 */
export interface UserRepository {
  listUsers(): AdminUser[];
  findUserById(userId: number): AdminUser | undefined;
  findUserByUsername(username: string): AdminUser | undefined;
  createUser(input: CreateUserInput): AdminUser;
  updateUser(userId: number, changes: { name: string; role: UserRole }): AdminUser;
  setPassword(userId: number, passwordHash: string, mustChangePassword: boolean): AdminUser;
  setActive(userId: number, active: boolean): AdminUser;
  countActiveAdmins(): number;
  /** Same semantics as `TicketRepository.transaction` — one synchronous better-sqlite3 transaction. */
  transaction<T>(fn: () => T): T;
}

export function createUserRepository(db: Db): UserRepository {
  function update(userId: number, changes: Partial<typeof adminUsers.$inferInsert>): AdminUser {
    const row = db
      .update(adminUsers)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(adminUsers.id, userId))
      .returning()
      .get();
    if (!row) {
      throw new Error(`User ${userId} not found`);
    }
    return row;
  }

  return {
    listUsers() {
      return db.select().from(adminUsers).orderBy(asc(adminUsers.name)).all();
    },

    findUserById(userId) {
      return db.select().from(adminUsers).where(eq(adminUsers.id, userId)).get();
    },

    findUserByUsername(username) {
      return db.select().from(adminUsers).where(eq(adminUsers.username, username)).get();
    },

    createUser(input) {
      const now = new Date();
      return db
        .insert(adminUsers)
        .values({ ...input, active: true, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },

    updateUser(userId, changes) {
      return update(userId, changes);
    },

    setPassword(userId, passwordHash, mustChangePassword) {
      return update(userId, { passwordHash, mustChangePassword });
    },

    setActive(userId, active) {
      return update(userId, { active });
    },

    countActiveAdmins() {
      const row = db
        .select({ value: count() })
        .from(adminUsers)
        .where(and(eq(adminUsers.role, 'admin'), eq(adminUsers.active, true)))
        .get();
      return row?.value ?? 0;
    },

    transaction(fn) {
      return db.transaction(() => fn());
    },
  };
}
