/**
 * Minimal logging shape this app needs, structurally compatible with a
 * pino/Fastify logger instance (or child logger) — kept separate from
 * `fastify`/`pino` imports so `serial-transport.ts`/`relay-server.ts` don't
 * need to depend on either directly.
 */
export interface BridgeLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export const noopLogger: BridgeLogger = {
  info() {},
  warn() {},
  error() {},
};
