import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { createDgnFrameParser } from './scale/dgn-frame-parser.js';
import { createTcpScaleClient } from './scale/tcp-client.js';
import { loadScaleConfig } from './scale/config.js';
import { createHttpRelayDriverSignalAdapter } from './driver-signal/http-relay-adapter.js';
import { loadDriverSignalConfig } from './driver-signal/config.js';
import { createHttpPrintClient } from './printing/print-client.js';
import { loadAdminConfig } from './admin/config.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? './data/tare.sqlite';
const printBridgeUrl = process.env.PRINT_BRIDGE_URL ?? 'http://127.0.0.1:4000';

// Default mirrors the monorepo's own workspace layout (apps/core-service
// and apps/admin-ui are siblings) so the same relative path works in local
// dev and in the Docker image, which copies the admin-ui build into that
// same relative location — see docker/Dockerfile.core-service.
const defaultAdminUiDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../admin-ui/dist',
);
const configuredAdminUiDir = process.env.ADMIN_UI_DIR
  ? path.resolve(process.env.ADMIN_UI_DIR)
  : defaultAdminUiDir;
// Not present in plain `npm run dev` (the Admin UI runs on its own Vite dev
// server there) — only serve it when an actual build exists.
const adminUiDir = fs.existsSync(path.join(configuredAdminUiDir, 'index.html'))
  ? configuredAdminUiDir
  : undefined;

// Created up front (not by Fastify) and shared with the scale client/parser
// via loggerInstance, so a scale read and the webhook that triggered it (and
// the scale-level connect/parse events that have no HTTP request at all)
// all land in one JSON stream with one shape.
const logger = pino();

const { db } = createDb(dbPath);

const scaleConfig = loadScaleConfig();
const scaleClient = createTcpScaleClient({
  host: scaleConfig.host,
  port: scaleConfig.port,
  stabilityTimeoutMs: scaleConfig.stabilityTimeoutMs,
  connectTimeoutMs: scaleConfig.connectTimeoutMs,
  stabilityRetryCount: scaleConfig.stabilityRetryCount,
  logger: logger.child({ component: 'scale-client' }),
  createParser: () =>
    createDgnFrameParser({
      requiredMatches: scaleConfig.stabilityReadingCount,
      sampleIntervalMs: scaleConfig.stabilitySampleIntervalMs,
      minValidWeightKg: scaleConfig.minValidWeightKg,
      logger: logger.child({ component: 'dgn-frame-parser' }),
    }),
});

const driverSignalConfig = loadDriverSignalConfig();
const driverSignalAdapter = createHttpRelayDriverSignalAdapter({
  entranceUrl: driverSignalConfig.entranceUrl,
  exitUrl: driverSignalConfig.exitUrl,
  timeoutMs: driverSignalConfig.timeoutMs,
  onError: (err, direction) => console.error(`driver signal (${direction}) failed:`, err),
});

const printClient = createHttpPrintClient({ baseUrl: printBridgeUrl });

const adminConfig = loadAdminConfig();

const app = buildApp({
  db,
  scaleClient,
  driverSignalAdapter,
  printClient,
  adminSessionSecret: adminConfig.sessionSecret,
  adminUiDir,
  logger,
});

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
