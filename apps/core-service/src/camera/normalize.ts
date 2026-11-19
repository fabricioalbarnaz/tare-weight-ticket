import { normalizePlate } from '../domain/plate.js';
import type { AnprXmlEvent } from './anpr-xml.js';

/**
 * What the camera reported about its own plate read, kept verbatim in every
 * camera `raw_events` row for later analysis (misreads, calibrating
 * `MIN_CONFIDENCE_LEVEL`) — see docs/plans/2026-11-10-store-anpr-confidence-plan.md.
 * Never used for business decisions beyond `isReliablePlateRead`.
 */
export interface CameraReadQuality {
  /** The plate the camera read (normalized), before the reliability filter — unlike `rawPlate`, kept even when the read is judged unreadable. */
  readPlate: string;
  /** Overall ANPR confidence, 0–100. */
  confidenceLevel: number;
  /** Per-character ANPR confidence, in plate order. */
  plateCharBelieve: number[];
}

export interface NormalizedCameraEvent {
  rawPlate: string;
  cameraId: string;
  timestamp: Date;
  readQuality: CameraReadQuality;
}

/**
 * Minimum ANPR confidence for a read to be acted on. Starting value, not
 * confirmed against real field data yet — tune once there is some.
 *
 * **2026-11-18:** this used to also require the normalized plate be
 * exactly 7 characters (both Brazilian plate formats), rejecting anything
 * else as unreadable regardless of confidence — removed at the user's
 * explicit request. See master plan §7/§11 for the original rationale
 * (a truncated read can carry high per-character confidence despite being
 * wrong) and the reversal.
 */
const MIN_CONFIDENCE_LEVEL = 80;

export function isReliablePlateRead(_plate: string, confidenceLevel: number): boolean {
  return confidenceLevel >= MIN_CONFIDENCE_LEVEL;
}

/**
 * Isolates the real Hikvision ANPR XML shape from the rest of the system:
 * swapping camera vendors later only means changing this function (and
 * `anpr-xml.ts`), not the routes or session service, which only ever see
 * this normalized shape.
 */
export function normalizeCameraPayload(event: AnprXmlEvent): NormalizedCameraEvent {
  const plate = normalizePlate(event.licensePlate);
  const timestamp = new Date(event.dateTime);

  return {
    rawPlate: isReliablePlateRead(plate, event.confidenceLevel) ? plate : '',
    cameraId: event.deviceId,
    timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    readQuality: {
      readPlate: plate,
      confidenceLevel: event.confidenceLevel,
      plateCharBelieve: event.plateCharBelieve,
    },
  };
}
