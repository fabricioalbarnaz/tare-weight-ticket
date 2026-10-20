import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('GET /health', () => {
  it('reports serial and relay state alongside ok status', async () => {
    const app = buildApp({
      getHealth: () => ({ serialOpen: true, relayConnections: 1 }),
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', serialOpen: true, relayConnections: 1 });
  });

  it('reflects a closed serial port', async () => {
    const app = buildApp({
      getHealth: () => ({ serialOpen: false, relayConnections: 0 }),
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.json()).toEqual({ status: 'ok', serialOpen: false, relayConnections: 0 });
  });
});
