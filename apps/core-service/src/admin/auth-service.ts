import bcrypt from 'bcryptjs';
import type { AdminUser, UserRepository } from '../users/repository.js';

const BCRYPT_ROUNDS = 10;

/** Shown as helper text under every password field in the Admin UI — keep the two in sync. */
export const MIN_PASSWORD_LENGTH = 6;

export interface AdminAuthService {
  /**
   * Returns the matched user on success, or null on an unknown username, a
   * wrong password, or an inactive user — all three look the same to the
   * caller so a login response never reveals which usernames exist.
   */
  verifyCredentials(username: string, password: string): AdminUser | null;
  verifyPassword(user: AdminUser, password: string): boolean;
  hashPassword(password: string): string;
}

export function createAdminAuthService(userRepo: UserRepository): AdminAuthService {
  return {
    verifyCredentials(username, password) {
      const user = userRepo.findUserByUsername(username);
      if (!user || !user.active) return null;
      if (!bcrypt.compareSync(password, user.passwordHash)) return null;
      return user;
    },

    verifyPassword(user, password) {
      return bcrypt.compareSync(password, user.passwordHash);
    },

    hashPassword(password) {
      return bcrypt.hashSync(password, BCRYPT_ROUNDS);
    },
  };
}
