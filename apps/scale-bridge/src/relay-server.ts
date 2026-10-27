import net from 'node:net';
import { noopLogger, type BridgeLogger } from './logger.js';
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
  /** Defaults to a no-op logger (used by tests that don't care about log output). */
  logger?: BridgeLogger;
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
  const logger = options.logger ?? noopLogger;

  return new Promise((resolve, reject) => {
    const clients = new Set<net.Socket>();
    let connectionCount = 0;

    options.transport.onData((chunk) => {
      for (const client of clients) {
        try {
          client.write(chunk);
        } catch (err) {
          logger.warn(
            { remoteAddress: client.remoteAddress, err: (err as Error).message },
            'scale-bridge: failed to forward bytes to a relay client',
          );
        }
      }
    });

    const server = net.createServer((socket) => {
      clients.add(socket);
      connectionCount += 1;
      logger.info({ remoteAddress: socket.remoteAddress, connectionCount }, 'scale-bridge: relay client connected');

      socket.on('close', () => {
        clients.delete(socket);
        logger.info({ remoteAddress: socket.remoteAddress }, 'scale-bridge: relay client disconnected');
      });
      // A client disconnecting mid-write must not crash the process.
      socket.on('error', (err) => {
        clients.delete(socket);
        logger.warn(
          { remoteAddress: socket.remoteAddress, err: err.message },
          'scale-bridge: relay client socket error',
        );
      });
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
