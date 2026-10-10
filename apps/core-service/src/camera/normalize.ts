import type { CameraWebhookPayload } from './payload-schema.js';

export interface NormalizedCameraEvent {
  rawPlate: string;
  cameraId: string;
  timestamp: Date;
}

/**
 * Isolates the generic webhook shape from the rest of the system: swapping
 * in the real camera vendor's payload later only means changing this
 * function (and the schema it reads), not the routes or session service.
 */
export function normalizeCameraPayload(payload: CameraWebhookPayload): NormalizedCameraEvent {
  return {
    rawPlate: payload.plate ?? '',
    cameraId: payload.cameraId,
    timestamp: payload.timestamp ? new Date(payload.timestamp) : new Date(),
  };
}
