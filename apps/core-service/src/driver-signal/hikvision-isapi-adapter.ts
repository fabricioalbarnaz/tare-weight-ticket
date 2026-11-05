import type { DriverSignalAdapter, DriverSignalDirection } from './types.js';
import { digestAuthFetch } from './isapi-digest-auth.js';

export type BarrierGateCtrlMode = 'open' | 'close' | 'lock' | 'unlock';

export interface HikvisionIsapiCameraOptions {
  /** Base URL of the camera's ISAPI HTTP server, e.g. "http://192.168.1.10". */
  baseUrl: string;
  /** Channel targeted by PUT /ISAPI/Parking/channels/<channelId>/barrierGate. Almost always "1" on a single-lane camera. */
  channelId: string;
  /** Which relay this fires: "open" drives relay 1, "close" drives relay 2 (per entranceParam.relayList) — on-site wiring-dependent, see docs/runbooks/hikvision-tcg406-relay-findings.md. */
  ctrlMode: BarrierGateCtrlMode;
  username: string;
  password: string;
}

export interface HikvisionIsapiDriverSignalOptions {
  /** Entrance-lane camera config. Omit to disable (no-op) that direction. */
  entrance?: HikvisionIsapiCameraOptions;
  /** Exit-lane camera config. Omit to disable (no-op) that direction. */
  exit?: HikvisionIsapiCameraOptions;
  timeoutMs?: number;
  onError?: (err: Error, direction: DriverSignalDirection) => void;
}

/**
 * Driver-signal adapter that fires the camera's dedicated
 * PUT /ISAPI/Parking/channels/<channelId>/barrierGate endpoint, confirmed
 * live against the real cameras (2026-11-04) to be the one that actually
 * operates the relay — unlike the generic PUT /ISAPI/System/IO/outputs
 * trigger this adapter used before that session, which turned out to
 * target an unrelated supplemental-light output on this camera/firmware.
 * See docs/runbooks/hikvision-tcg406-relay-findings.md and
 * docs/plans/2026-11-04-hikvision-barriergate-endpoint-fix-plan.md.
 *
 * Which `ctrlMode` ("open" = relay 1, "close" = relay 2) actually drives
 * the siren is still unconfirmed on-site (all 4 combinations returned
 * HTTP 200 without an audible result in the one test session so far) —
 * `ctrlMode` is configurable per direction for that reason, defaulting to
 * "open".
 */
export function createHikvisionIsapiDriverSignalAdapter(
  options: HikvisionIsapiDriverSignalOptions,
): DriverSignalAdapter {
  const timeoutMs = options.timeoutMs ?? 3000;

  let lastSuccessAt: Date | null = null;
  let lastFailureAt: Date | null = null;

  async function fireBarrierGate(camera: HikvisionIsapiCameraOptions): Promise<void> {
    const url = `${camera.baseUrl.replace(/\/$/, '')}/ISAPI/Parking/channels/${camera.channelId}/barrierGate`;
    const body = `<?xml version="1.0" encoding="UTF-8"?><BarrierGate version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><ctrlMode>${camera.ctrlMode}</ctrlMode></BarrierGate>`;

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
        throw new Error(`Camera responded with HTTP ${response.status} setting ctrlMode=${camera.ctrlMode}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function signal(camera: HikvisionIsapiCameraOptions | undefined, direction: DriverSignalDirection): Promise<void> {
    if (!camera) return;

    try {
      await fireBarrierGate(camera);
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
