import Fastify, { type FastifyInstance } from 'fastify';

export interface BridgeHealth {
  serialOpen: boolean;
  relayConnections: number;
}

export interface BuildAppOptions {
  getHealth(): BridgeHealth;
}

/**
 * Health-check HTTP surface only — the actual scale data path is the raw
 * TCP relay in relay-server.ts, not this app. Mirrors print-bridge's
 * `GET /health` shape for the Admin UI's hardware status panel.
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok', ...options.getHealth() }));

  return app;
}
