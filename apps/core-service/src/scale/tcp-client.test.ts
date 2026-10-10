import { afterEach, describe, expect, it } from 'vitest';
import { createPlaceholderFrameParser } from './placeholder-frame-parser.js';
import { startMockScaleServer, type MockScaleServer } from './mock-scale-server.js';
import { createTcpScaleClient } from './tcp-client.js';
import type { ScaleClient } from './types.js';

let server: MockScaleServer | undefined;
let client: ScaleClient | undefined;

afterEach(async () => {
  client?.close();
  client = undefined;
  await server?.close();
  server = undefined;
});

describe('createTcpScaleClient', () => {
  it('resolves with the stable weight once the scale reports it', async () => {
    server = await startMockScaleServer();
    client = createTcpScaleClient({
      host: '127.0.0.1',
      port: server.port,
      stabilityTimeoutMs: 1000,
      createParser: createPlaceholderFrameParser,
    });

    const readPromise = client.readStableWeight();
    await server.waitForConnection();
    server.send('ST,20000');

    await expect(readPromise).resolves.toEqual({ weightKg: 20000, weightCaptureFailed: false });
  });

  it('resolves with the stable weight after several unstable frames', async () => {
    server = await startMockScaleServer();
    client = createTcpScaleClient({
      host: '127.0.0.1',
      port: server.port,
      stabilityTimeoutMs: 1000,
      createParser: createPlaceholderFrameParser,
    });

    const readPromise = client.readStableWeight();
    await server.waitForConnection();
    server.send('US,19980');
    server.send('US,19995');
    server.send('ST,20000');

    await expect(readPromise).resolves.toEqual({ weightKg: 20000, weightCaptureFailed: false });
  });

  it('resolves with weightCaptureFailed when the scale never stabilizes in time', async () => {
    server = await startMockScaleServer();
    client = createTcpScaleClient({
      host: '127.0.0.1',
      port: server.port,
      stabilityTimeoutMs: 300,
      createParser: createPlaceholderFrameParser,
    });

    const readPromise = client.readStableWeight();
    await server.waitForConnection();
    server.send('US,19980');

    await expect(readPromise).resolves.toEqual({ weightKg: null, weightCaptureFailed: true });
  });

  it('resolves with weightCaptureFailed when the scale is unreachable', async () => {
    client = createTcpScaleClient({
      host: '127.0.0.1',
      port: 1,
      stabilityTimeoutMs: 1000,
      connectTimeoutMs: 200,
      createParser: createPlaceholderFrameParser,
    });

    await expect(client.readStableWeight()).resolves.toEqual({
      weightKg: null,
      weightCaptureFailed: true,
    });
  });

  it('supports sequential reads over the same connection', async () => {
    server = await startMockScaleServer();
    client = createTcpScaleClient({
      host: '127.0.0.1',
      port: server.port,
      stabilityTimeoutMs: 1000,
      createParser: createPlaceholderFrameParser,
    });

    const firstRead = client.readStableWeight();
    await server.waitForConnection();
    server.send('ST,20000');
    await expect(firstRead).resolves.toEqual({ weightKg: 20000, weightCaptureFailed: false });

    const secondRead = client.readStableWeight();
    server.send('ST,8000');
    await expect(secondRead).resolves.toEqual({ weightKg: 8000, weightCaptureFailed: false });
  });
});
