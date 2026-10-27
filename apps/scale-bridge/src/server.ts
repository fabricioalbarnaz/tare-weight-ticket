import pino from 'pino';
import { buildApp } from './app.js';
import { loadBridgeConfig } from './config.js';
import { createSerialPortTransport } from './serial-transport.js';
import { startRelayServer, type RelayServer } from './relay-server.js';

// Created up front (not by Fastify) and shared with the serial
// transport/relay server via loggerInstance, so the health-check HTTP log
// and the serial/relay events (which have no HTTP request at all) all land
// in one JSON stream — this is what NSSM redirects into service.log.
const logger = pino();

const config = loadBridgeConfig();
const transport = createSerialPortTransport({
  path: config.comPort,
  baudRate: config.baudRate,
  logger: logger.child({ component: 'serial-transport' }),
});

let relay: RelayServer | undefined;

startRelayServer({ port: config.relayPort, transport, logger: logger.child({ component: 'relay-server' }) })
  .then((server) => {
    relay = server;
    logger.info(
      { comPort: config.comPort, relayPort: server.port },
      'scale-bridge: relaying serial port on TCP',
    );
  })
  .catch((err) => {
    logger.error({ err: (err as Error).message }, 'scale-bridge: failed to start relay server');
    process.exit(1);
  });

const app = buildApp({
  getHealth: () => ({
    serialOpen: transport.isOpen(),
    relayConnections: relay?.connectionCount ?? 0,
  }),
  logger,
});

app.listen({ port: config.healthPort, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
