import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrintTicketRequest } from '@tare/shared';
import { createHttpPrintClient } from './print-client.js';

let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

function startTestServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

const ticket: PrintTicketRequest = {
  ticketId: 1,
  ticketNumber: 42,
  plate: 'ABC1234',
  entryAt: '2026-01-01T08:00:00.000Z',
  exitAt: '2026-01-01T09:00:00.000Z',
  entryWeightKg: 20000,
  exitWeightKg: 8000,
  netWeightKg: 12000,
};

describe('createHttpPrintClient', () => {
  it('posts the ticket to /print and returns the response body on success', async () => {
    const requests: Array<{ method?: string; url?: string; body: string }> = [];
    const baseUrl = await startTestServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, body });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: true }));
      });
    });

    const client = createHttpPrintClient({ baseUrl });
    const result = await client.printTicket(ticket);

    expect(result).toEqual({ success: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url).toBe('/print');
    expect(JSON.parse(requests[0]!.body)).toEqual(ticket);
  });

  it('returns success: false with the bridge error when the bridge responds with a failure', async () => {
    const baseUrl = await startTestServer((_req, res) => {
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ success: false, error: 'printer offline' }));
    });

    const client = createHttpPrintClient({ baseUrl });
    const result = await client.printTicket(ticket);

    expect(result).toEqual({ success: false, error: 'printer offline' });
  });

  it('resolves success: false instead of rejecting when the bridge is unreachable', async () => {
    const client = createHttpPrintClient({ baseUrl: 'http://127.0.0.1:1' });

    const result = await client.printTicket(ticket);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('resolves success: false when the bridge does not respond within the timeout', async () => {
    const baseUrl = await startTestServer(() => {
      // Never responds.
    });

    const client = createHttpPrintClient({ baseUrl, timeoutMs: 50 });
    const result = await client.printTicket(ticket);

    expect(result.success).toBe(false);
  });

  describe('checkHealth', () => {
    it('reports reachable: true when /health responds 200', async () => {
      const baseUrl = await startTestServer((req, res) => {
        if (req.url === '/health') res.writeHead(200).end();
      });

      const client = createHttpPrintClient({ baseUrl });

      expect(await client.checkHealth()).toEqual({ reachable: true });
    });

    it('reports reachable: false when the bridge is unreachable', async () => {
      const client = createHttpPrintClient({ baseUrl: 'http://127.0.0.1:1' });

      expect(await client.checkHealth()).toEqual({ reachable: false });
    });

    it('reports reachable: false when /health does not respond within the timeout', async () => {
      const baseUrl = await startTestServer(() => {
        // Never responds.
      });

      const client = createHttpPrintClient({ baseUrl, timeoutMs: 50 });

      expect(await client.checkHealth()).toEqual({ reachable: false });
    });
  });
});
