/**
 * Generic ANPR webhook payload schema, used until the real camera model is
 * confirmed (see docs/plans master plan §7.3). Kept deliberately loose —
 * `plate` is nullable/optional to represent a misread, and `timestamp` is
 * optional because some vendors omit it and expect the receiver to
 * stamp arrival time. Swapping to the real vendor shape only requires
 * changing this schema and `normalize.ts`, not the routes or session logic.
 */
export const cameraWebhookPayloadSchema = {
  type: 'object',
  properties: {
    plate: { type: ['string', 'null'] },
    cameraId: { type: 'string', minLength: 1 },
    timestamp: { type: 'string', format: 'date-time' },
    confidence: { type: 'number' },
  },
  required: ['cameraId'],
  additionalProperties: true,
} as const;

export interface CameraWebhookPayload {
  plate?: string | null;
  cameraId: string;
  timestamp?: string;
  confidence?: number;
}
