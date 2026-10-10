import net from 'node:net';

export interface MockScaleServer {
  readonly port: number;
  readonly connectionCount: number;
  /** Writes a raw line (newline appended) to every currently connected client. */
  send(line: string): void;
  /** Resolves once at least `atLeast` clients have connected (default 1), without relying on a timing guess. */
  waitForConnection(atLeast?: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * In-process TCP server standing in for the Digi-Tron Isis New indicator
 * in tests, since the real hardware/protocol isn't available yet (master
 * plan §7.2). Tests script exactly what frames it sends and when.
 */
export function startMockScaleServer(): Promise<MockScaleServer> {
  return new Promise((resolve, reject) => {
    const clients = new Set<net.Socket>();
    let connectionCount = 0;
    const pendingWaiters: Array<{ atLeast: number; resolve: () => void }> = [];

    function notifyWaiters(): void {
      for (const waiter of pendingWaiters.slice()) {
        if (connectionCount < waiter.atLeast) continue;
        const index = pendingWaiters.indexOf(waiter);
        if (index !== -1) pendingWaiters.splice(index, 1);
        waiter.resolve();
      }
    }

    const server = net.createServer((socket) => {
      clients.add(socket);
      connectionCount += 1;
      notifyWaiters();
      socket.on('close', () => clients.delete(socket));
      // A client can disconnect mid-write (e.g. a test forcing a reconnect);
      // an 'error' event with zero listeners would crash the process.
      socket.on('error', () => clients.delete(socket));
    });

    server.once('error', reject);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('failed to resolve mock scale server port'));
        return;
      }

      resolve({
        port: address.port,
        get connectionCount() {
          return connectionCount;
        },
        send(line) {
          for (const client of clients) client.write(`${line}\n`);
        },
        waitForConnection(atLeast = 1) {
          if (connectionCount >= atLeast) return Promise.resolve();
          return new Promise((res) => {
            pendingWaiters.push({ atLeast, resolve: res });
          });
        },
        close() {
          return new Promise<void>((res) => {
            for (const client of clients) client.destroy();
            server.close(() => res());
          });
        },
      });
    });
  });
}
