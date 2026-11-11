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
 * Minimum ANPR confidence, and the exact character count expected from a
 * genuine read (both Brazilian plate formats — legacy `AAA9999` and
 * Mercosul `AAA9A99` — are 7 characters). Below either, the read is
 * treated as unreadable rather than acted on: per the truck-load-queue
 * findings (docs/plans master plan §7 item 3), a short plate can still
 * carry a high per-character confidence despite being a truncated read, so
 * character count needs its own check independent of `confidenceLevel`.
 * Starting values, not confirmed against real field data yet — tune once
 * there is some.
 */
const MIN_CONFIDENCE_LEVEL = 80;
const EXPECTED_PLATE_LENGTH = 7;

export function isReliablePlateRead(plate: string, confidenceLevel: number): boolean {
  return confidenceLevel >= MIN_CONFIDENCE_LEVEL && plate.length === EXPECTED_PLATE_LENGTH;
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
