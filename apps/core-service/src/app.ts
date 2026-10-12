import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db/client.js';
import { createTicketRepository } from './tickets/repository.js';
import { createSessionService } from './tickets/session-service.js';
import type { ScaleClient } from './scale/types.js';
import type { DriverSignalAdapter } from './driver-signal/types.js';
import type { PrintClient } from './printing/print-client.js';
import { createPrintService } from './printing/print-service.js';
import { registerCameraRoutes } from './camera/routes.js';
import { registerPrintRoutes } from './printing/routes.js';

export interface BuildAppOptions {
  db: Db;
  scaleClient: ScaleClient;
  driverSignalAdapter: DriverSignalAdapter;
  printClient: PrintClient;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  const repo = createTicketRepository(options.db);
  const sessionService = createSessionService(repo);
  const printService = createPrintService(repo, options.printClient);

  app.get('/health', async () => ({ status: 'ok' }));

  registerCameraRoutes(app, {
    sessionService,
    scaleClient: options.scaleClient,
    driverSignalAdapter: options.driverSignalAdapter,
    printService,
  });

  registerPrintRoutes(app, { printService });

  return app;
}
