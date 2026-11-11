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

/** The read currently waiting on the connection's data handler, so every raw frame it sees while waiting can be logged tagged with that read's own context (direction/plate/attempt) — see the `sock.on('data', ...)` handler below. */
interface ActiveRead {
  log: ScaleLogger;
  meta: Record<string, unknown>;
}

/** One `readStableWeight` call, from the moment it's queued until it resolves — tracked so a newer plate can preempt it (see ScaleReadContext.plateKey). */
interface ReadJob {
  plateKey: string;
  preemptedBy: string | null;
  /** Set only while this job's readOne() is waiting on a frame: resolves that wait immediately as preempted. */
  abort: (() => void) | null;
}

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
  // Set only while a readOne() is actually waiting on a frame, so the data
  // handler never logs the continuous idle stream between reads — just the
  // samples captured during an entrance/exit attempt (master plan §5/§11).
  let activeRead: ActiveRead | null = null;
  // The scale is one physical resource: serialize reads so two concurrent
  // webhooks (entrance/exit) can never both be resolved by the same frame.
  let readQueue: Promise<ScaleReadResult> = Promise.resolve({
    weightKg: null,
    weightCaptureFailed: true,
  });
  // Every job queued or running, so a newer plate can preempt them.
  const pendingJobs = new Set<ReadJob>();

  function preempt(job: ReadJob, byPlateKey: string): void {
    if (job.preemptedBy !== null) return;
    job.preemptedBy = byPlateKey;
    job.abort?.();
  }

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
            if (activeRead) {
              activeRead.log.debug(
                { ...activeRead.meta, weightKg: frame.weightKg, stable: frame.stable },
                'scale: weight sample captured',
              );
            }
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

  function preemptedResult(
    job: ReadJob,
    log: ScaleLogger,
    meta: Record<string, unknown>,
    waitedMs: number,
  ): ScaleReadResult {
    log.info(
      { ...meta, waitedMs, failureReason: 'preempted', preemptedByPlate: job.preemptedBy },
      'scale read preempted: a newer reading for a different plate took over the scale',
    );
    return { weightKg: null, weightCaptureFailed: true, failureReason: 'preempted', waitedMs };
  }

  async function readOne(
    context: ScaleReadContext | undefined,
    attempt: number,
    job: ReadJob,
  ): Promise<ScaleReadResult> {
    const log = context?.logger ?? logger;
    const meta = {
      ...endpoint,
      direction: context?.direction,
      plate: context?.plate,
      attempt,
      stabilityRetryCount,
    };
    const startedAt = Date.now();

    if (job.preemptedBy !== null) return preemptedResult(job, log, meta, 0);

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

    // Preempted while the connection was being established.
    if (job.preemptedBy !== null) return preemptedResult(job, log, meta, Date.now() - startedAt);

    activeRead = { log, meta };
    try {
      return await new Promise<ScaleReadResult>((resolve) => {
        const waiter: Waiter = (frame) => {
          clearTimeout(timer);
          job.abort = null;
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
          job.abort = null;
          waiters = waiters.filter((pending) => pending !== waiter);
          // Force a reconnect on the next read: otherwise a frame that settles
          // just after this timeout could answer a later, unrelated read.
          teardown();
          const waitedMs = Date.now() - startedAt;
          log.warn({ ...meta, waitedMs, failureReason: 'stability_timeout' }, 'scale read failed: no stable weight within timeout');
          resolve({ weightKg: null, weightCaptureFailed: true, failureReason: 'stability_timeout', waitedMs });
        }, options.stabilityTimeoutMs);

        // No teardown here, unlike the stability-timeout path: the read that
        // preempted this one is for the truck physically on the platform
        // now, so the next stable frame legitimately belongs to it.
        job.abort = () => {
          job.abort = null;
          clearTimeout(timer);
          waiters = waiters.filter((pending) => pending !== waiter);
          resolve(preemptedResult(job, log, meta, Date.now() - startedAt));
        };

        waiters.push(waiter);
      });
    } finally {
      job.abort = null;
      activeRead = null;
    }
  }

  async function readWithRetries(context: ScaleReadContext | undefined, job: ReadJob): Promise<ScaleReadResult> {
    let result: ScaleReadResult = { weightKg: null, weightCaptureFailed: true };
    let totalWaitedMs = 0;
    let attemptsUsed = 0;

    for (let attempt = 1; attempt <= stabilityRetryCount; attempt += 1) {
      result = await readOne(context, attempt, job);
      totalWaitedMs += result.waitedMs ?? 0;
      attemptsUsed = attempt;

      if (!result.weightCaptureFailed || result.failureReason === 'preempted') break;
    }

    return { ...result, waitedMs: totalWaitedMs, attemptsUsed };
  }

  return {
    readStableWeight(context?: ScaleReadContext): Promise<ScaleReadResult> {
      const job: ReadJob = { plateKey: context?.plateKey ?? '', preemptedBy: null, abort: null };

      // A readable plate takes over the scale from every older read for a
      // different plate, whether it's the one running now or still queued.
      if (job.plateKey !== '') {
        for (const other of pendingJobs) {
          if (other.plateKey !== job.plateKey) preempt(other, job.plateKey);
        }
      }
      pendingJobs.add(job);

      const run = (): Promise<ScaleReadResult> => readWithRetries(context, job);
      const result = readQueue.then(run, run).finally(() => pendingJobs.delete(job));
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
