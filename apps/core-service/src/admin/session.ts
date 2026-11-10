import type { AdminUser } from '../users/repository.js';

declare module 'fastify' {
  interface Session {
    /** Only the id is kept in the session — the user row is re-read on every request (see `requireAuth`). */
    adminUserId?: number;
  }

  interface FastifyRequest {
    /** The fresh, active user behind this request's session; set by `requireAuth`/`requireAdmin`. */
    adminUser: AdminUser | null;
  }
}

export {};
