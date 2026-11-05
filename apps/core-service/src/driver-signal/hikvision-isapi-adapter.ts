import type { DriverSignalAdapter, DriverSignalDirection } from './types.js';
import { digestAuthFetch } from './isapi-digest-auth.js';

export interface HikvisionIsapiCameraOptions {
  /** Base URL of the camera's ISAPI HTTP server, e.g. "http://192.168.1.10". */
  baseUrl: string;
  /** Relay/output channel ID targeted by PUT /ISAPI/System/IO/outputs/<ID>/trigger. On-site wiring-dependent — see docs/runbooks/hikvision-tcg406-relay-findings.md. */
  outputId: string;
  username: string;
  password: string;
}

export interface HikvisionIsapiDriverSignalOptions {
  /** Entrance-lane camera config. Omit to disable (no-op) that direction. */
  entrance?: HikvisionIsapiCameraOptions;
  /** Exit-lane camera config. Omit to disable (no-op) that direction. */
  exit?: HikvisionIsapiCameraOptions;
  timeoutMs?: number;
  /** How long to hold the relay "high" before pulsing it back to "low". Defaults to 1000ms. */
  pulseMs?: number;
  onError?: (err: Error, direction: DriverSignalDirection) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Driver-signal adapter that fires the camera's own ISAPI generic I/O
 * output trigger (PUT /ISAPI/System/IO/outputs/<ID>/trigger), used on
 * installs where the camera's relay drives an audible siren rather than a
 * barrier gate. See docs/runbooks/hikvision-tcg406-relay-findings.md and
 * docs/plans/2026-10-31-hikvision-isapi-driver-signal-plan.md for why this
 * endpoint was chosen over the camera's dedicated (gate-specific)
 * barrierGate/barrierGateCtrl endpoints. Not tested against a real unit —
 * the output `<ID>`-to-relay-channel mapping and the relay's
 * `relayFunction: 4` ("alarm signal") assignment are on-site configuration,
 * done once, out of scope for this adapter.
 */
export function createHikvisionIsapiDriverSignalAdapter(
  options: HikvisionIsapiDriverSignalOptions,
): DriverSignalAdapter {
  const timeoutMs = options.timeoutMs ?? 3000;
  const pulseMs = options.pulseMs ?? 1000;

  let lastSuccessAt: Date | null = null;
  let lastFailureAt: Date | null = null;

  async function setOutputState(camera: HikvisionIsapiCameraOptions, outputState: 'high' | 'low'): Promise<void> {
    const url = `${camera.baseUrl.replace(/\/$/, '')}/ISAPI/System/IO/outputs/${camera.outputId}/trigger`;
    const body = `<?xml version="1.0" encoding="UTF-8"?><IOPortData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><outputState>${outputState}</outputState></IOPortData>`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await digestAuthFetch(
        url,
        {
          method: 'PUT',
          body,
          headers: { 'Content-Type': 'application/xml' },
          signal: controller.signal,
        },
        { username: camera.username, password: camera.password },
      );
      if (!response.ok) {
        throw new Error(`Camera responded with HTTP ${response.status} setting outputState=${outputState}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function signal(camera: HikvisionIsapiCameraOptions | undefined, direction: DriverSignalDirection): Promise<void> {
    if (!camera) return;

    try {
      await setOutputState(camera, 'high');
      await delay(pulseMs);
      await setOutputState(camera, 'low');
      lastSuccessAt = new Date();
    } catch (err) {
      lastFailureAt = new Date();
      options.onError?.(err instanceof Error ? err : new Error(String(err)), direction);
    }
  }

  return {
    async signalDriver(direction) {
      await signal(direction === 'in' ? options.entrance : options.exit, direction);
    },

    getStatus() {
      return { lastSuccessAt, lastFailureAt };
    },
  };
}
