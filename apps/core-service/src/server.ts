import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { createPlaceholderFrameParser } from './scale/placeholder-frame-parser.js';
import { createTcpScaleClient } from './scale/tcp-client.js';
import { loadScaleConfig } from './scale/config.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? './data/tare.sqlite';

const { db } = createDb(dbPath);

const scaleConfig = loadScaleConfig();
const scaleClient = createTcpScaleClient({
  host: scaleConfig.host,
  port: scaleConfig.port,
  stabilityTimeoutMs: scaleConfig.stabilityTimeoutMs,
  connectTimeoutMs: scaleConfig.connectTimeoutMs,
  createParser: createPlaceholderFrameParser,
});

const app = buildApp({ db, scaleClient });

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
