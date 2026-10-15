import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { createPlaceholderFrameParser } from './scale/placeholder-frame-parser.js';
import { createTcpScaleClient } from './scale/tcp-client.js';
import { loadScaleConfig } from './scale/config.js';
import { createHttpRelayDriverSignalAdapter } from './driver-signal/http-relay-adapter.js';
import { loadDriverSignalConfig } from './driver-signal/config.js';
import { createHttpPrintClient } from './printing/print-client.js';
import { loadAdminConfig } from './admin/config.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? './data/tare.sqlite';
const printBridgeUrl = process.env.PRINT_BRIDGE_URL ?? 'http://127.0.0.1:4000';

const { db } = createDb(dbPath);

const scaleConfig = loadScaleConfig();
const scaleClient = createTcpScaleClient({
  host: scaleConfig.host,
  port: scaleConfig.port,
  stabilityTimeoutMs: scaleConfig.stabilityTimeoutMs,
  connectTimeoutMs: scaleConfig.connectTimeoutMs,
  createParser: createPlaceholderFrameParser,
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
});

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
