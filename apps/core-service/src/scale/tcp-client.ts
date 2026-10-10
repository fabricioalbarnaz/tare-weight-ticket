import net from 'node:net';
import type { ParsedWeightFrame, ScaleClient, ScaleFrameParser, ScaleReadResult } from './types.js';

export interface ScaleClientOptions {
  host: string;
  port: number;
  /** Bounded wait for a stable frame before treating the read as failed (master plan §5). */
  stabilityTimeoutMs: number;
  /** Separate, usually shorter, bound for establishing the TCP connection itself. */
  connectTimeoutMs?: number;
  createParser: () => ScaleFrameParser;
}

type Waiter = (frame: ParsedWeightFrame | null) => void;

export function createTcpScaleClient(options: ScaleClientOptions): ScaleClient {
  const connectTimeoutMs = options.connectTimeoutMs ?? 5000;

  let socket: net.Socket | null = null;
  let parser: ScaleFrameParser | null = null;
  let connectPromise: Promise<net.Socket> | null = null;
  let waiters: Waiter[] = [];

  function failAllWaiters(): void {
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) waiter(null);
  }

  function teardown(): void {
    socket?.removeAllListeners();
    socket?.destroy();
    socket = null;
    parser = null;
    connectPromise = null;
    failAllWaiters();
  }

  function connect(): Promise<net.Socket> {
    if (socket) return Promise.resolve(socket);
    if (connectPromise) return connectPromise;

    connectPromise = new Promise((resolve, reject) => {
      const sock = new net.Socket();

      const onConnectFailure = (err: Error) => {
        sock.destroy();
        connectPromise = null;
        reject(err);
      };

      sock.setTimeout(connectTimeoutMs);
      sock.once('timeout', () => onConnectFailure(new Error('scale connection timed out')));
      sock.once('error', onConnectFailure);

      sock.connect(options.port, options.host, () => {
        sock.setTimeout(0);
        sock.removeListener('error', onConnectFailure);

        parser = options.createParser();
        socket = sock;

        sock.on('data', (chunk: Buffer) => {
          if (!parser) return;
          for (const frame of parser.push(chunk)) {
            if (!frame.stable) continue;
            const pending = waiters;
            waiters = [];
            for (const waiter of pending) waiter(frame);
          }
        });

        sock.on('error', teardown);
        sock.on('close', teardown);

        resolve(sock);
      });
    });

    return connectPromise;
  }

  return {
    async readStableWeight(): Promise<ScaleReadResult> {
      try {
        await connect();
      } catch {
        return { weightKg: null, weightCaptureFailed: true };
      }

      return new Promise<ScaleReadResult>((resolve) => {
        const waiter: Waiter = (frame) => {
          clearTimeout(timer);
          resolve(
            frame === null
              ? { weightKg: null, weightCaptureFailed: true }
              : { weightKg: frame.weightKg, weightCaptureFailed: false },
          );
        };

        const timer = setTimeout(() => {
          waiters = waiters.filter((pending) => pending !== waiter);
          resolve({ weightKg: null, weightCaptureFailed: true });
        }, options.stabilityTimeoutMs);

        waiters.push(waiter);
      });
    },

    close() {
      teardown();
    },
  };
}
