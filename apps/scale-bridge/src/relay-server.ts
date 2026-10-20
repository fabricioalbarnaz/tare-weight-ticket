import net from 'node:net';
import type { SerialTransport } from './serial-transport.js';

export interface RelayServer {
  readonly port: number;
  readonly connectionCount: number;
  close(): Promise<void>;
}

export interface StartRelayServerOptions {
  port: number;
  host?: string;
  transport: SerialTransport;
}

/**
 * Raw TCP relay: every byte the serial transport emits is forwarded
 * verbatim to every connected client. core-service's existing
 * `ScaleClient`/`tcp-client.ts` connects here exactly as it would to the
 * mock scale server in tests — this relay is the only thing that changes,
 * nothing in core-service's TCP client or DGN parsing needs to know the
 * data actually originated from a physical COM port.
 */
export function startRelayServer(options: StartRelayServerOptions): Promise<RelayServer> {
  return new Promise((resolve, reject) => {
    const clients = new Set<net.Socket>();
    let connectionCount = 0;

    options.transport.onData((chunk) => {
      for (const client of clients) client.write(chunk);
    });

    const server = net.createServer((socket) => {
      clients.add(socket);
      connectionCount += 1;
      socket.on('close', () => clients.delete(socket));
      // A client disconnecting mid-write must not crash the process.
      socket.on('error', () => clients.delete(socket));
    });

    server.once('error', reject);

    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('failed to resolve relay server port'));
        return;
      }

      resolve({
        port: address.port,
        get connectionCount() {
          return connectionCount;
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
