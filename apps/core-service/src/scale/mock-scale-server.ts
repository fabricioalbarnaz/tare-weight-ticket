import net from 'node:net';

export interface MockScaleServer {
  readonly port: number;
  /** Writes a raw line (newline appended) to every currently connected client. */
  send(line: string): void;
  /** Resolves once the first client has connected, so tests don't rely on a timing guess. */
  waitForConnection(): Promise<void>;
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
    let resolveConnected: (() => void) | undefined;
    const connectedPromise = new Promise<void>((res) => {
      resolveConnected = res;
    });

    const server = net.createServer((socket) => {
      clients.add(socket);
      resolveConnected?.();
      socket.on('close', () => clients.delete(socket));
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
        send(line) {
          for (const client of clients) client.write(`${line}\n`);
        },
        waitForConnection() {
          return connectedPromise;
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
