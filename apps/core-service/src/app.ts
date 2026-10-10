import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db/client.js';
import { createTicketRepository } from './tickets/repository.js';
import { createSessionService } from './tickets/session-service.js';
import type { ScaleClient } from './scale/types.js';
import { registerCameraRoutes } from './camera/routes.js';

export interface BuildAppOptions {
  db: Db;
  scaleClient: ScaleClient;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  const repo = createTicketRepository(options.db);
  const sessionService = createSessionService(repo);

  app.get('/health', async () => ({ status: 'ok' }));

  registerCameraRoutes(app, { sessionService, scaleClient: options.scaleClient });

  return app;
}
