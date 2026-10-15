import type { DriverSignalAdapter, DriverSignalDirection } from './types.js';

export interface HttpRelayDriverSignalOptions {
  /** URL to call to signal an entrance-lane relay. Omit to disable (no-op) that direction. */
  entranceUrl?: string;
  /** URL to call to signal an exit-lane relay. Omit to disable (no-op) that direction. */
  exitUrl?: string;
  timeoutMs?: number;
  /** HTTP method used for the relay call. Defaults to GET (matches common Shelly/Tasmota-style relay APIs). */
  method?: string;
  onError?: (err: Error, direction: DriverSignalDirection) => void;
}

/**
 * Default driver-signal adapter: a plain HTTP call to a network relay. The
 * real relay hardware isn't chosen yet (master plan §7 risk #4), so this is
 * deliberately generic — one HTTP request per direction — and documented as
 * a placeholder. Swapping it for different hardware (serial/GPIO relay
 * board, etc.) means implementing `DriverSignalAdapter`, not touching the
 * camera routes.
 */
export function createHttpRelayDriverSignalAdapter(
  options: HttpRelayDriverSignalOptions,
): DriverSignalAdapter {
  const timeoutMs = options.timeoutMs ?? 3000;
  const method = options.method ?? 'GET';

  let lastSuccessAt: Date | null = null;
  let lastFailureAt: Date | null = null;

  async function callRelay(url: string | undefined, direction: DriverSignalDirection): Promise<void> {
    if (!url) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { method, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Relay responded with HTTP ${response.status}`);
      }
      lastSuccessAt = new Date();
    } catch (err) {
      lastFailureAt = new Date();
      options.onError?.(err instanceof Error ? err : new Error(String(err)), direction);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async signalDriver(direction) {
      await callRelay(direction === 'in' ? options.entranceUrl : options.exitUrl, direction);
    },

    getStatus() {
      return { lastSuccessAt, lastFailureAt };
    },
  };
}
