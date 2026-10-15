import bcrypt from 'bcryptjs';
import type { TicketRepository } from '../tickets/repository.js';

export interface AdminAuthService {
  /** Returns the matched username on success, or null on an unknown username or wrong password. */
  verifyCredentials(username: string, password: string): string | null;
}

export function createAdminAuthService(repo: TicketRepository): AdminAuthService {
  return {
    verifyCredentials(username, password) {
      const user = repo.findAdminUserByUsername(username);
      if (!user) return null;
      if (!bcrypt.compareSync(password, user.passwordHash)) return null;
      return user.username;
    },
  };
}
