import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { Db } from './db/client.js';
import { createTicketRepository } from './tickets/repository.js';
import { createSessionService } from './tickets/session-service.js';
import { createTruckRepository } from './trucks/repository.js';
import type { ScaleClient } from './scale/types.js';
import type { DriverSignalAdapter } from './driver-signal/types.js';
import type { PrintClient } from './printing/print-client.js';
import { createPrintService } from './printing/print-service.js';
import { registerCameraRoutes } from './camera/routes.js';
import { registerPrintRoutes } from './printing/routes.js';
import { registerAdminRoutes } from './admin/routes.js';

export interface BuildAppOptions {
  db: Db;
  scaleClient: ScaleClient;
  driverSignalAdapter: DriverSignalAdapter;
  printClient: PrintClient;
  /** Signs the Admin UI's session cookie. Must be at least 32 characters. */
  adminSessionSecret: string;
  /**
   * Absolute path to the built Admin UI (`apps/admin-ui`'s `vite build`
   * output). When set, Core Service serves it directly and falls back to
   * `index.html` for unmatched GET routes (client-side routing). Omit to
   * run the API only (e.g. local dev, where the Admin UI runs on its own
   * Vite dev server).
   */
  adminUiDir?: string;
  /**
   * Shares one pino instance with the rest of the process (scale client,
   * frame parser) so every log line — HTTP access logs included — lands in
   * the same stream with the same JSON shape. Falls back to Fastify's own
   * default logger when omitted (e.g. in tests that don't care about log
   * output).
   */
  logger?: FastifyBaseLogger;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = options.logger ? Fastify({ loggerInstance: options.logger }) : Fastify({ logger: true });

  const repo = createTicketRepository(options.db);
  const truckRepo = createTruckRepository(options.db);
  const sessionService = createSessionService(repo, truckRepo);
  const printService = createPrintService(repo, options.printClient);

  // Generous fileSize limit: the camera's ANPR push carries three JPEGs
  // alongside the anpr.xml part this system actually reads (see
  // docs/plans master plan §7 item 3) — they're drained and discarded,
  // but the limit still needs to be big enough that draining a real JPEG
  // never errors.
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.get('/health', async () => ({ status: 'ok' }));

  registerCameraRoutes(app, {
    sessionService,
    scaleClient: options.scaleClient,
    driverSignalAdapter: options.driverSignalAdapter,
    printService,
  });

  registerPrintRoutes(app, { printService });

  registerAdminRoutes(app, {
    repo,
    truckRepo,
    printService,
    scaleClient: options.scaleClient,
    driverSignalAdapter: options.driverSignalAdapter,
    printClient: options.printClient,
    sessionSecret: options.adminSessionSecret,
  });

  if (options.adminUiDir) {
    const adminUiDir = options.adminUiDir;
    app.register(fastifyStatic, { root: adminUiDir });

    // Registered after every API route above, so it only ever catches
    // genuinely unmatched requests — client-side routes like `/tickets/42`
    // that the Admin UI's React Router handles, not `/api/*`, `/health`,
    // `/webhooks/*`, or print routes, which are already real routes by now.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        reply.sendFile('index.html');
        return;
      }
      reply.code(404).send({ error: 'not_found' });
    });
  }

  return app;
}
