import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeLogger } from './logger.js';
import { startRelayServer, type RelayServer } from './relay-server.js';
import type { SerialTransport } from './serial-transport.js';

interface CapturedLog {
  level: 'info' | 'warn' | 'error';
  obj: Record<string, unknown>;
  msg?: string;
}

function createCapturingLogger(): { logger: BridgeLogger; calls: CapturedLog[] } {
  const calls: CapturedLog[] = [];
  return {
    calls,
    logger: {
      info: (obj, msg) => calls.push({ level: 'info', obj, msg }),
      warn: (obj, msg) => calls.push({ level: 'warn', obj, msg }),
      error: (obj, msg) => calls.push({ level: 'error', obj, msg }),
    },
  };
}

interface FakeSerialTransport extends SerialTransport {
  emit(chunk: Buffer): void;
}

function createFakeSerialTransport(): FakeSerialTransport {
  const listeners: Array<(chunk: Buffer) => void> = [];
  let open = true;

  return {
    onData(listener) {
      listeners.push(listener);
    },
    isOpen() {
      return open;
    },
    async close() {
      open = false;
    },
    emit(chunk) {
      for (const listener of listeners) listener(chunk);
    },
  };
}

function connectClient(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForData(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve) => {
    socket.once('data', (chunk) => resolve(chunk));
  });
}

let server: RelayServer | undefined;
const clients: net.Socket[] = [];

afterEach(async () => {
  for (const client of clients) client.destroy();
  clients.length = 0;
  await server?.close();
  server = undefined;
});

describe('startRelayServer', () => {
  it('relays bytes from the serial transport to a connected TCP client', async () => {
    const transport = createFakeSerialTransport();
    server = await startRelayServer({ port: 0, transport });

    const client = await connectClient(server.port);
    clients.push(client);

    const received = waitForData(client);
    transport.emit(Buffer.from('D059080.\r'));

    expect((await received).toString('latin1')).toBe('D059080.\r');
  });

  it('relays the same bytes to multiple connected clients', async () => {
    const transport = createFakeSerialTransport();
    server = await startRelayServer({ port: 0, transport });

    const clientA = await connectClient(server.port);
    const clientB = await connectClient(server.port);
    clients.push(clientA, clientB);

    const receivedA = waitForData(clientA);
    const receivedB = waitForData(clientB);
    transport.emit(Buffer.from('F000000.\r'));

    expect((await receivedA).toString('latin1')).toBe('F000000.\r');
    expect((await receivedB).toString('latin1')).toBe('F000000.\r');
  });

  it('keeps relaying to the remaining client after another one disconnects', async () => {
    const transport = createFakeSerialTransport();
    server = await startRelayServer({ port: 0, transport });

    const clientA = await connectClient(server.port);
    const clientB = await connectClient(server.port);
    clients.push(clientB);

    clientA.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const received = waitForData(clientB);
    expect(() => transport.emit(Buffer.from('D021920.\r'))).not.toThrow();

    expect((await received).toString('latin1')).toBe('D021920.\r');
  });

  it('tracks how many connections have been accepted', async () => {
    const transport = createFakeSerialTransport();
    server = await startRelayServer({ port: 0, transport });

    const client = await connectClient(server.port);
    clients.push(client);

    expect(server.connectionCount).toBe(1);
  });

  it('logs when a relay client connects and disconnects', async () => {
    const transport = createFakeSerialTransport();
    const { logger, calls } = createCapturingLogger();
    server = await startRelayServer({ port: 0, transport, logger });

    const client = await connectClient(server.port);
    clients.push(client);
    client.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls.filter((c) => c.level === 'info' && c.msg === 'scale-bridge: relay client connected')).toHaveLength(1);
    expect(calls.filter((c) => c.level === 'info' && c.msg === 'scale-bridge: relay client disconnected')).toHaveLength(1);
  });
});
