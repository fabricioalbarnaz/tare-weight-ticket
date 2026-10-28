import net from 'node:net';
import type {
  ParsedWeightFrame,
  ScaleClient,
  ScaleFrameParser,
  ScaleLogger,
  ScaleReadContext,
  ScaleReadFailureReason,
  ScaleReadResult,
} from './types.js';

export interface ScaleClientOptions {
  host: string;
  port: number;
  /** Bounded wait for a stable frame before treating the read as failed (master plan §5). */
  stabilityTimeoutMs: number;
  /** Separate, usually shorter, bound for establishing the TCP connection itself. */
  connectTimeoutMs?: number;
  /**
   * Attempts (each bounded by stabilityTimeoutMs, reconnecting in between)
   * before giving up and returning a failed ScaleReadResult. Defaults to 1
   * (no retry) so existing single-attempt callers/tests are unaffected;
   * production wiring passes ScaleConfig's own stabilityRetryCount.
   */
  stabilityRetryCount?: number;
  createParser: () => ScaleFrameParser;
  /** Defaults to a no-op logger (used by tests that don't care about log output). */
  logger?: ScaleLogger;
}

type Waiter = (frame: ParsedWeightFrame | null) => void;

const KEEP_ALIVE_DELAY_MS = 10_000;

const noopLogger: ScaleLogger = {
  info() {},
  warn() {},
  debug() {},
};

class ScaleConnectFailure extends Error {
  constructor(
    public readonly reason: 'connect_error' | 'connect_timeout',
    message: string,
  ) {
    super(message);
  }
}

export function createTcpScaleClient(options: ScaleClientOptions): ScaleClient {
  const connectTimeoutMs = options.connectTimeoutMs ?? 5000;
  const stabilityRetryCount = options.stabilityRetryCount ?? 1;
  const logger = options.logger ?? noopLogger;
  const endpoint = { host: options.host, port: options.port };

  let socket: net.Socket | null = null;
  let parser: ScaleFrameParser | null = null;
  let connectPromise: Promise<net.Socket> | null = null;
  let waiters: Waiter[] = [];
  let lastSeenAt: Date | null = null;
  // The scale is one physical resource: serialize reads so two concurrent
  // webhooks (entrance/exit) can never both be resolved by the same frame.
  let readQueue: Promise<ScaleReadResult> = Promise.resolve({
    weightKg: null,
    weightCaptureFailed: true,
  });

  function failAllWaiters(): void {
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) waiter(null);
  }

  function teardown(): void {
    if (socket) {
      logger.debug({ ...endpoint }, 'scale: connection torn down');
      socket.removeAllListeners();
      // Swallow any error emitted while/after destroying; an 'error' event
      // with zero listeners crashes the process.
      socket.on('error', () => {});
      socket.destroy();
    }
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

      const onConnectFailure = (reason: 'connect_error' | 'connect_timeout', err: Error) => {
        sock.destroy();
        connectPromise = null;
        reject(new ScaleConnectFailure(reason, err.message));
      };

      sock.setTimeout(connectTimeoutMs);
      sock.once('timeout', () => onConnectFailure('connect_timeout', new Error('scale connection timed out')));
      sock.once('error', (err) => onConnectFailure('connect_error', err));

      sock.connect(options.port, options.host, () => {
        sock.setTimeout(0);
        sock.removeListener('error', onConnectFailure);
        sock.setKeepAlive(true, KEEP_ALIVE_DELAY_MS);
        logger.debug({ ...endpoint }, 'scale: connection established');

        parser = options.createParser();
        socket = sock;

        sock.on('data', (chunk: Buffer) => {
          if (!parser) return;
          for (const frame of parser.push(chunk)) {
            if (!frame.stable) continue;
            lastSeenAt = new Date();
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

  async function readOne(context: ScaleReadContext | undefined, attempt: number): Promise<ScaleReadResult> {
    const log = context?.logger ?? logger;
    const meta = {
      ...endpoint,
      direction: context?.direction,
      plate: context?.plate,
      attempt,
      stabilityRetryCount,
    };
    const startedAt = Date.now();

    try {
      await connect();
    } catch (err) {
      const waitedMs = Date.now() - startedAt;
      const failureReason: ScaleReadFailureReason =
        err instanceof ScaleConnectFailure ? err.reason : 'connect_error';
      log.warn(
        { ...meta, waitedMs, failureReason, err: (err as Error).message },
        'scale read failed: could not connect',
      );
      return { weightKg: null, weightCaptureFailed: true, failureReason, waitedMs };
    }

    return new Promise<ScaleReadResult>((resolve) => {
      const waiter: Waiter = (frame) => {
        clearTimeout(timer);
        const waitedMs = Date.now() - startedAt;

        if (frame === null) {
          // Only reached when the connection itself failed/closed while this
          // waiter was still pending (the stability-timeout path below
          // removes itself from `waiters` before ever tearing down).
          log.warn({ ...meta, waitedMs, failureReason: 'socket_error' }, 'scale read failed: connection lost while waiting for a stable reading');
          resolve({ weightKg: null, weightCaptureFailed: true, failureReason: 'socket_error', waitedMs });
          return;
        }

        log.info({ ...meta, waitedMs, weightKg: frame.weightKg }, 'scale read succeeded');
        resolve({ weightKg: frame.weightKg, weightCaptureFailed: false, waitedMs });
      };

      const timer = setTimeout(() => {
        waiters = waiters.filter((pending) => pending !== waiter);
        // Force a reconnect on the next read: otherwise a frame that settles
        // just after this timeout could answer a later, unrelated read.
        teardown();
        const waitedMs = Date.now() - startedAt;
        log.warn({ ...meta, waitedMs, failureReason: 'stability_timeout' }, 'scale read failed: no stable weight within timeout');
        resolve({ weightKg: null, weightCaptureFailed: true, failureReason: 'stability_timeout', waitedMs });
      }, options.stabilityTimeoutMs);

      waiters.push(waiter);
    });
  }

  async function readWithRetries(context?: ScaleReadContext): Promise<ScaleReadResult> {
    let result: ScaleReadResult = { weightKg: null, weightCaptureFailed: true };
    let totalWaitedMs = 0;

    for (let attempt = 1; attempt <= stabilityRetryCount; attempt += 1) {
      result = await readOne(context, attempt);
      totalWaitedMs += result.waitedMs ?? 0;

      if (!result.weightCaptureFailed) break;
    }

    return { ...result, waitedMs: totalWaitedMs };
  }

  return {
    readStableWeight(context?: ScaleReadContext): Promise<ScaleReadResult> {
      const run = (): Promise<ScaleReadResult> => readWithRetries(context);
      const result = readQueue.then(run, run);
      readQueue = result;
      return result;
    },

    getStatus() {
      return { connected: socket !== null, lastSeenAt };
    },

    close() {
      teardown();
    },
  };
}
