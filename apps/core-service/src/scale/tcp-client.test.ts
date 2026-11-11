import { afterEach, describe, expect, it } from 'vitest';
import { createPlaceholderFrameParser } from './placeholder-frame-parser.js';
import { startMockScaleServer, type MockScaleServer } from './mock-scale-server.js';
import { createTcpScaleClient } from './tcp-client.js';
import type { ScaleClient, ScaleLogger } from './types.js';

let server: MockScaleServer | undefined;
let client: ScaleClient | undefined;

afterEach(async () => {
  client?.close();
  client = undefined;
  await server?.close();
  server = undefined;
});

interface CapturedLog {
  level: 'info' | 'warn' | 'debug';
  obj: Record<string, unknown>;
  msg?: string;
}

function createCapturingLogger(): { logger: ScaleLogger; calls: CapturedLog[] } {
  const calls: CapturedLog[] = [];
  return {
    calls,
    logger: {
      info: (obj, msg) => calls.push({ level: 'info', obj, msg }),
      warn: (obj, msg) => calls.push({ level: 'warn', obj, msg }),
      debug: (obj, msg) => calls.push({ level: 'debug', obj, msg }),
    },
  };
}

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

    await expect(readPromise).resolves.toMatchObject({ weightKg: 20000, weightCaptureFailed: false, attemptsUsed: 1 });
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

    await expect(readPromise).resolves.toMatchObject({ weightKg: 20000, weightCaptureFailed: false });
  });

  it('resolves with weightCaptureFailed and a stability_timeout reason when the scale never stabilizes in time', async () => {
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

    await expect(readPromise).resolves.toMatchObject({
      weightKg: null,
      weightCaptureFailed: true,
      failureReason: 'stability_timeout',
    });
  });

  it('resolves with weightCaptureFailed and a connect_error reason when the scale is unreachable', async () => {
    client = createTcpScaleClient({
      host: '127.0.0.1',
      port: 1,
      stabilityTimeoutMs: 1000,
      connectTimeoutMs: 200,
      createParser: createPlaceholderFrameParser,
    });

    await expect(client.readStableWeight()).resolves.toMatchObject({
      weightKg: null,
      weightCaptureFailed: true,
      failureReason: 'connect_error',
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
    await expect(firstRead).resolves.toMatchObject({ weightKg: 20000, weightCaptureFailed: false });

    const secondRead = client.readStableWeight();
    server.send('ST,8000');
    await expect(secondRead).resolves.toMatchObject({ weightKg: 8000, weightCaptureFailed: false });
  });

  it('serializes concurrent reads so each gets its own stable frame', async () => {
    server = await startMockScaleServer();
    client = createTcpScaleClient({
      host: '127.0.0.1',
      port: server.port,
      stabilityTimeoutMs: 1000,
      createParser: createPlaceholderFrameParser,
    });

    const firstRead = client.readStableWeight();
    const secondRead = client.readStableWeight();

    await server.waitForConnection();
    server.send('ST,20000');
    await expect(firstRead).resolves.toMatchObject({ weightKg: 20000, weightCaptureFailed: false });

    server.send('ST,8000');
    await expect(secondRead).resolves.toMatchObject({ weightKg: 8000, weightCaptureFailed: false });
  });

  it('reconnects after a stability timeout instead of reusing the stale connection', async () => {
    server = await startMockScaleServer();
    client = createTcpScaleClient({
      host: '127.0.0.1',
      port: server.port,
      stabilityTimeoutMs: 300,
      createParser: createPlaceholderFrameParser,
    });

    const firstRead = client.readStableWeight();
    await server.waitForConnection();
    await expect(firstRead).resolves.toMatchObject({ weightKg: null, weightCaptureFailed: true });

    const secondRead = client.readStableWeight();
    await server.waitForConnection(2);
    server.send('ST,12345');

    await expect(secondRead).resolves.toMatchObject({ weightKg: 12345, weightCaptureFailed: false });
    expect(server.connectionCount).toBe(2);
  });

  describe('stabilityRetryCount', () => {
    it('retries after a stability timeout and succeeds on a later attempt', async () => {
      server = await startMockScaleServer();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 300,
        stabilityRetryCount: 3,
        createParser: createPlaceholderFrameParser,
      });

      const readPromise = client.readStableWeight();
      await server.waitForConnection();
      // First attempt times out with no frame at all.

      await server.waitForConnection(2);
      server.send('ST,20000');

      await expect(readPromise).resolves.toMatchObject({ weightKg: 20000, weightCaptureFailed: false, attemptsUsed: 2 });
      expect(server.connectionCount).toBe(2);
    });

    it('succeeds only on the 3rd attempt and reports attemptsUsed accordingly', async () => {
      server = await startMockScaleServer();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 300,
        stabilityRetryCount: 3,
        createParser: createPlaceholderFrameParser,
      });

      const readPromise = client.readStableWeight();
      // First two attempts time out with no frame at all.
      await server.waitForConnection(3);
      server.send('ST,20000');

      await expect(readPromise).resolves.toMatchObject({ weightKg: 20000, weightCaptureFailed: false, attemptsUsed: 3 });
      expect(server.connectionCount).toBe(3);
    });

    it('gives up only after exhausting every attempt, and reports the cumulative waited time and attemptsUsed', async () => {
      server = await startMockScaleServer();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 200,
        stabilityRetryCount: 3,
        createParser: createPlaceholderFrameParser,
      });

      const result = await client.readStableWeight();

      expect(result).toMatchObject({
        weightKg: null,
        weightCaptureFailed: true,
        failureReason: 'stability_timeout',
        attemptsUsed: 3,
      });
      expect(result.waitedMs).toBeGreaterThanOrEqual(600);
      expect(server.connectionCount).toBe(3);
    });

    it('does not retry by default (stabilityRetryCount defaults to 1)', async () => {
      server = await startMockScaleServer();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 200,
        createParser: createPlaceholderFrameParser,
      });

      await client.readStableWeight();

      expect(server.connectionCount).toBe(1);
    });

    it('logs one warning per failed attempt, each tagged with its attempt number', async () => {
      server = await startMockScaleServer();
      const { logger, calls } = createCapturingLogger();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 200,
        stabilityRetryCount: 3,
        createParser: createPlaceholderFrameParser,
        logger,
      });

      await client.readStableWeight();

      const warnLogs = calls.filter((c) => c.level === 'warn');
      expect(warnLogs).toHaveLength(3);
      expect(warnLogs.map((c) => c.obj.attempt)).toEqual([1, 2, 3]);
      expect(warnLogs.every((c) => c.obj.stabilityRetryCount === 3)).toBe(true);
    });
  });

  // See docs/plans/2026-11-10-preempt-scale-read-on-new-plate-plan.md.
  describe('preemption by a newer plate', () => {
    async function startClient(overrides: { stabilityTimeoutMs?: number; stabilityRetryCount?: number; logger?: ScaleLogger } = {}) {
      server = await startMockScaleServer();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: overrides.stabilityTimeoutMs ?? 5000,
        stabilityRetryCount: overrides.stabilityRetryCount,
        createParser: createPlaceholderFrameParser,
        logger: overrides.logger,
      });
      return { server, client };
    }

    it('resolves the active read as preempted right away, without reconnecting, and gives the next stable frame to the new plate', async () => {
      const { server, client } = await startClient();

      const readA = client.readStableWeight({ plateKey: 'AAA1111' });
      await server.waitForConnection();
      server.send('US,19500');

      const startedAt = Date.now();
      const readB = client.readStableWeight({ plateKey: 'BBB2222' });
      await expect(readA).resolves.toMatchObject({
        weightKg: null,
        weightCaptureFailed: true,
        failureReason: 'preempted',
        attemptsUsed: 1,
      });
      expect(Date.now() - startedAt).toBeLessThan(1000);

      server.send('ST,53300');
      await expect(readB).resolves.toMatchObject({ weightKg: 53300, weightCaptureFailed: false, attemptsUsed: 1 });
      expect(server.connectionCount).toBe(1);
    });

    it('stops a retrying read immediately instead of running its remaining attempts', async () => {
      const { server, client } = await startClient({ stabilityTimeoutMs: 300, stabilityRetryCount: 3 });

      const readA = client.readStableWeight({ plateKey: 'AAA1111' });
      // Attempt 1 times out with no frame; attempt 2 reconnects.
      await server.waitForConnection(2);

      const readB = client.readStableWeight({ plateKey: 'BBB2222' });
      await expect(readA).resolves.toMatchObject({ failureReason: 'preempted', attemptsUsed: 2 });

      server.send('ST,40000');
      await expect(readB).resolves.toMatchObject({ weightKg: 40000, weightCaptureFailed: false });
      expect(server.connectionCount).toBe(2);
    });

    it('also preempts older reads still waiting in the queue, including unreadable ones', async () => {
      const { server, client } = await startClient();

      const readA = client.readStableWeight({ plateKey: 'AAA1111' });
      await server.waitForConnection();
      const readUnreadable = client.readStableWeight({ plateKey: '' });
      const readB = client.readStableWeight({ plateKey: 'BBB2222' });

      await expect(readA).resolves.toMatchObject({ failureReason: 'preempted' });
      await expect(readUnreadable).resolves.toMatchObject({ failureReason: 'preempted' });

      server.send('ST,30000');
      await expect(readB).resolves.toMatchObject({ weightKg: 30000, weightCaptureFailed: false });
    });

    it('preempts an active read for an unreadable plate', async () => {
      const { server, client } = await startClient();

      const readUnreadable = client.readStableWeight({ plateKey: '' });
      await server.waitForConnection();
      const readB = client.readStableWeight({ plateKey: 'BBB2222' });

      await expect(readUnreadable).resolves.toMatchObject({ failureReason: 'preempted' });
      server.send('ST,30000');
      await expect(readB).resolves.toMatchObject({ weightKg: 30000, weightCaptureFailed: false });
    });

    it('does not preempt when the new reading is for the same plate — both are served in order', async () => {
      const { server, client } = await startClient();

      const first = client.readStableWeight({ plateKey: 'AAA1111' });
      await server.waitForConnection();
      const second = client.readStableWeight({ plateKey: 'AAA1111' });

      server.send('ST,20000');
      await expect(first).resolves.toMatchObject({ weightKg: 20000, weightCaptureFailed: false });
      server.send('ST,20010');
      await expect(second).resolves.toMatchObject({ weightKg: 20010, weightCaptureFailed: false });
    });

    it('does not preempt when the new reading has an unreadable plate', async () => {
      const { server, client } = await startClient();

      const readA = client.readStableWeight({ plateKey: 'AAA1111' });
      await server.waitForConnection();
      const readUnreadable = client.readStableWeight({ plateKey: '' });

      server.send('ST,20000');
      await expect(readA).resolves.toMatchObject({ weightKg: 20000, weightCaptureFailed: false });
      server.send('ST,15000');
      await expect(readUnreadable).resolves.toMatchObject({ weightKg: 15000, weightCaptureFailed: false });
    });

    it('logs the preemption at info level with the preempting plate', async () => {
      const { logger, calls } = createCapturingLogger();
      const { server, client } = await startClient({ logger });

      const readA = client.readStableWeight({ plateKey: 'AAA1111', plate: 'AAA1111', direction: 'exit' });
      await server.waitForConnection();
      void client.readStableWeight({ plateKey: 'BBB2222' });
      await readA;

      const preemptLog = calls.find((c) => c.obj.failureReason === 'preempted');
      expect(preemptLog).toMatchObject({
        level: 'info',
        obj: { plate: 'AAA1111', direction: 'exit', preemptedByPlate: 'BBB2222' },
      });
      expect(calls.some((c) => c.level === 'warn')).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('reports disconnected with no lastSeenAt before any read', () => {
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: 1,
        stabilityTimeoutMs: 1000,
        createParser: createPlaceholderFrameParser,
      });

      expect(client.getStatus()).toEqual({ connected: false, lastSeenAt: null });
    });

    it('reports connected with a lastSeenAt timestamp after a stable read', async () => {
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
      await readPromise;

      const status = client.getStatus();
      expect(status.connected).toBe(true);
      expect(status.lastSeenAt).toBeInstanceOf(Date);
    });

    it('reports disconnected again after a stability timeout forces a reconnect', async () => {
      server = await startMockScaleServer();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 300,
        createParser: createPlaceholderFrameParser,
      });

      await client.readStableWeight();
      await server.waitForConnection();

      expect(client.getStatus().connected).toBe(false);
    });
  });

  describe('logging', () => {
    it('logs an info line with weightKg and a numeric waitedMs on a successful read', async () => {
      server = await startMockScaleServer();
      const { logger, calls } = createCapturingLogger();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 1000,
        createParser: createPlaceholderFrameParser,
        logger,
      });

      const readPromise = client.readStableWeight();
      await server.waitForConnection();
      server.send('ST,20000');
      await readPromise;

      const infoLogs = calls.filter((c) => c.level === 'info');
      expect(infoLogs).toHaveLength(1);
      expect(infoLogs[0]?.obj.weightKg).toBe(20000);
      expect(typeof infoLogs[0]?.obj.waitedMs).toBe('number');
    });

    it('logs a warning with failureReason stability_timeout when the scale never stabilizes', async () => {
      server = await startMockScaleServer();
      const { logger, calls } = createCapturingLogger();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 200,
        createParser: createPlaceholderFrameParser,
        logger,
      });

      await client.readStableWeight();

      const warnLogs = calls.filter((c) => c.level === 'warn');
      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0]?.obj.failureReason).toBe('stability_timeout');
    });

    it('logs a warning with failureReason connect_error when the scale is unreachable', async () => {
      const { logger, calls } = createCapturingLogger();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: 1,
        stabilityTimeoutMs: 1000,
        connectTimeoutMs: 200,
        createParser: createPlaceholderFrameParser,
        logger,
      });

      await client.readStableWeight();

      const warnLogs = calls.filter((c) => c.level === 'warn');
      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0]?.obj.failureReason).toBe('connect_error');
    });

    it('logs a debug line for every raw frame seen while waiting, stable or not, tagged with direction/plate/attempt', async () => {
      server = await startMockScaleServer();
      const { logger, calls } = createCapturingLogger();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 1000,
        createParser: createPlaceholderFrameParser,
        logger,
      });

      const readPromise = client.readStableWeight({ direction: 'entrance', plate: 'ABC1234' });
      await server.waitForConnection();
      server.send('US,19980');
      server.send('US,19995');
      server.send('ST,20000');
      await readPromise;

      const sampleLogs = calls.filter((c) => c.level === 'debug' && c.msg === 'scale: weight sample captured');
      expect(sampleLogs.map((c) => c.obj.weightKg)).toEqual([19980, 19995, 20000]);
      expect(sampleLogs.map((c) => c.obj.stable)).toEqual([false, false, true]);
      expect(sampleLogs.every((c) => c.obj.direction === 'entrance' && c.obj.plate === 'ABC1234' && c.obj.attempt === 1)).toBe(
        true,
      );
    });

    it('does not log sample frames received before a read is pending or after it has settled', async () => {
      server = await startMockScaleServer();
      const { logger, calls } = createCapturingLogger();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 1000,
        createParser: createPlaceholderFrameParser,
        logger,
      });

      const readPromise = client.readStableWeight();
      await server.waitForConnection();
      server.send('ST,20000');
      await readPromise;

      // Sent after the read already resolved — must not produce a sample log.
      server.send('US,1');

      const sampleLogs = calls.filter((c) => c.level === 'debug' && c.msg === 'scale: weight sample captured');
      expect(sampleLogs).toHaveLength(1);
    });

    it('tags each retry attempt\'s sample logs with its own attempt number', async () => {
      server = await startMockScaleServer();
      const { logger, calls } = createCapturingLogger();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 300,
        stabilityRetryCount: 3,
        createParser: createPlaceholderFrameParser,
        logger,
      });

      const readPromise = client.readStableWeight();
      await server.waitForConnection();
      server.send('US,100');
      // First attempt times out without ever stabilizing.

      await server.waitForConnection(2);
      server.send('US,200');
      server.send('ST,300');

      await expect(readPromise).resolves.toMatchObject({ weightKg: 300, attemptsUsed: 2 });

      const sampleLogs = calls.filter((c) => c.level === 'debug' && c.msg === 'scale: weight sample captured');
      expect(sampleLogs.map((c) => [c.obj.attempt, c.obj.weightKg])).toEqual([
        [1, 100],
        [2, 200],
        [2, 300],
      ]);
    });

    it('prefers the per-call context logger over the client logger, and includes direction/plate', async () => {
      server = await startMockScaleServer();
      const clientLogger = createCapturingLogger();
      const contextLogger = createCapturingLogger();
      client = createTcpScaleClient({
        host: '127.0.0.1',
        port: server.port,
        stabilityTimeoutMs: 1000,
        createParser: createPlaceholderFrameParser,
        logger: clientLogger.logger,
      });

      const readPromise = client.readStableWeight({
        logger: contextLogger.logger,
        direction: 'entrance',
        plate: 'ABC1234',
      });
      await server.waitForConnection();
      server.send('ST,20000');
      await readPromise;

      expect(clientLogger.calls.filter((c) => c.level === 'info')).toHaveLength(0);
      const infoLogs = contextLogger.calls.filter((c) => c.level === 'info');
      expect(infoLogs).toHaveLength(1);
      expect(infoLogs[0]?.obj.direction).toBe('entrance');
      expect(infoLogs[0]?.obj.plate).toBe('ABC1234');
    });
  });
});
