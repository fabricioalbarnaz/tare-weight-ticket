import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpRelayDriverSignalAdapter } from './http-relay-adapter.js';

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

describe('createHttpRelayDriverSignalAdapter', () => {
  it('calls the entrance URL for direction "in"', async () => {
    const requests: Array<{ method?: string; url?: string }> = [];
    const baseUrl = await startTestServer((req, res) => {
      requests.push({ method: req.method, url: req.url });
      res.writeHead(200).end();
    });

    const adapter = createHttpRelayDriverSignalAdapter({ entranceUrl: `${baseUrl}/entrance` });
    await adapter.signalDriver('in');

    expect(requests).toEqual([{ method: 'GET', url: '/entrance' }]);
  });

  it('calls the exit URL for direction "out"', async () => {
    const requests: Array<{ url?: string }> = [];
    const baseUrl = await startTestServer((req, res) => {
      requests.push({ url: req.url });
      res.writeHead(200).end();
    });

    const adapter = createHttpRelayDriverSignalAdapter({ exitUrl: `${baseUrl}/exit` });
    await adapter.signalDriver('out');

    expect(requests).toEqual([{ url: '/exit' }]);
  });

  it('does nothing when the URL for that direction is not configured', async () => {
    let called = false;
    const baseUrl = await startTestServer((_req, res) => {
      called = true;
      res.writeHead(200).end();
    });

    const adapter = createHttpRelayDriverSignalAdapter({ exitUrl: `${baseUrl}/exit` });
    await adapter.signalDriver('in');

    expect(called).toBe(false);
  });

  it('resolves and reports via onError when the relay responds with a non-2xx status', async () => {
    const baseUrl = await startTestServer((_req, res) => {
      res.writeHead(500).end();
    });

    const errors: Array<{ message: string; direction: string }> = [];
    const adapter = createHttpRelayDriverSignalAdapter({
      entranceUrl: baseUrl,
      onError: (err, direction) => errors.push({ message: err.message, direction }),
    });

    await expect(adapter.signalDriver('in')).resolves.toBeUndefined();
    expect(errors).toEqual([{ message: 'Relay responded with HTTP 500', direction: 'in' }]);
  });

  it('resolves and reports via onError when the relay is unreachable', async () => {
    const errors: Error[] = [];
    const adapter = createHttpRelayDriverSignalAdapter({
      entranceUrl: 'http://127.0.0.1:1/unreachable',
      onError: (err) => errors.push(err),
    });

    await expect(adapter.signalDriver('in')).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it('aborts and reports via onError when the relay does not respond within the timeout', async () => {
    const baseUrl = await startTestServer(() => {
      // Never responds.
    });

    const errors: Error[] = [];
    const adapter = createHttpRelayDriverSignalAdapter({
      entranceUrl: baseUrl,
      timeoutMs: 50,
      onError: (err) => errors.push(err),
    });

    await expect(adapter.signalDriver('in')).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  describe('getStatus', () => {
    it('reports no attempts yet before any signal', () => {
      const adapter = createHttpRelayDriverSignalAdapter({});
      expect(adapter.getStatus()).toEqual({ lastSuccessAt: null, lastFailureAt: null });
    });

    it('records lastSuccessAt after a successful relay call', async () => {
      const baseUrl = await startTestServer((_req, res) => res.writeHead(200).end());
      const adapter = createHttpRelayDriverSignalAdapter({ entranceUrl: baseUrl });

      await adapter.signalDriver('in');

      const status = adapter.getStatus();
      expect(status.lastSuccessAt).toBeInstanceOf(Date);
      expect(status.lastFailureAt).toBeNull();
    });

    it('records lastFailureAt after a failed relay call', async () => {
      const adapter = createHttpRelayDriverSignalAdapter({
        entranceUrl: 'http://127.0.0.1:1/unreachable',
      });

      await adapter.signalDriver('in');

      const status = adapter.getStatus();
      expect(status.lastFailureAt).toBeInstanceOf(Date);
      expect(status.lastSuccessAt).toBeNull();
    });

    it('does not record an attempt when the direction has no configured URL', async () => {
      const adapter = createHttpRelayDriverSignalAdapter({});

      await adapter.signalDriver('in');

      expect(adapter.getStatus()).toEqual({ lastSuccessAt: null, lastFailureAt: null });
    });
  });
});
