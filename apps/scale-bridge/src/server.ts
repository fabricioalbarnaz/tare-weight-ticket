import { buildApp } from './app.js';
import { loadBridgeConfig } from './config.js';
import { createSerialPortTransport } from './serial-transport.js';
import { startRelayServer, type RelayServer } from './relay-server.js';

const config = loadBridgeConfig();
const transport = createSerialPortTransport({ path: config.comPort, baudRate: config.baudRate });

let relay: RelayServer | undefined;

startRelayServer({ port: config.relayPort, transport })
  .then((server) => {
    relay = server;
    console.log(`scale-bridge: relaying ${config.comPort} on TCP port ${server.port}`);
  })
  .catch((err) => {
    console.error('failed to start relay server:', err);
    process.exit(1);
  });

const app = buildApp({
  getHealth: () => ({
    serialOpen: transport.isOpen(),
    relayConnections: relay?.connectionCount ?? 0,
  }),
});

app.listen({ port: config.healthPort, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
