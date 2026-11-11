export interface ParsedWeightFrame {
  weightKg: number;
  stable: boolean;
}

export interface ScaleFrameParser {
  /**
   * Feeds newly received bytes and returns any complete frames parsed so
   * far. Implementations buffer partial frames internally across calls.
   */
  push(chunk: Buffer): ParsedWeightFrame[];
}

/** Where in the read path a failed read broke down — see tcp-client.ts. */
export type ScaleReadFailureReason =
  | 'connect_error'
  | 'connect_timeout'
  | 'socket_error'
  | 'stability_timeout'
  /** A newer reading for a different plate took over the scale — see ScaleReadContext.plateKey. */
  | 'preempted';

export interface ScaleReadResult {
  weightKg: number | null;
  weightCaptureFailed: boolean;
  /** Only set when weightCaptureFailed is true. */
  failureReason?: ScaleReadFailureReason;
  /** Wall-clock duration of this read attempt, in ms. Present on success and failure. */
  waitedMs?: number;
  /** Which attempt (1-based) this resolved on, or stabilityRetryCount if every attempt failed. Present on success and failure. */
  attemptsUsed?: number;
}

export interface ScaleStatus {
  connected: boolean;
  lastSeenAt: Date | null;
}

/**
 * Minimal logging shape the scale module needs, structurally compatible
 * with a pino/Fastify logger instance (or child logger) — the module
 * never imports pino/fastify itself so it stays usable from both
 * core-service and scale-bridge.
 */
export interface ScaleLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
}

export interface ScaleReadContext {
  /** Per-call logger (e.g. the triggering webhook request's own logger), so this read's log line carries the same correlation id. Falls back to the client's own logger when omitted. */
  logger?: ScaleLogger;
  direction?: 'entrance' | 'exit';
  /** Raw (pre-normalization) plate read by the camera, for correlating a scale failure back to a specific truck. */
  plate?: string;
  /**
   * Normalized plate identifying which truck this read is for. A non-empty
   * key **preempts** every older read still active or queued whose key
   * differs (they resolve with `failureReason: 'preempted'`, no retries):
   * the scale is one physical platform, so a new truck's plate means the
   * previous truck is no longer the one being weighed — see
   * docs/plans/2026-11-10-preempt-scale-read-on-new-plate-plan.md. An
   * empty/omitted key (unreadable plate) never preempts anything, but can
   * itself be preempted.
   */
  plateKey?: string;
}

export interface ScaleClient {
  /** Waits for the indicator's next stable weight, bounded by a timeout. */
  readStableWeight(context?: ScaleReadContext): Promise<ScaleReadResult>;
  /** Current TCP connection state, for the Admin UI's hardware status panel. */
  getStatus(): ScaleStatus;
  close(): void;
}
