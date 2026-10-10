import type { FastifyInstance } from 'fastify';
import type { ScaleClient } from '../scale/types.js';
import type { EntranceResult, ExitResult, SessionService } from '../tickets/session-service.js';
import { cameraWebhookPayloadSchema, type CameraWebhookPayload } from './payload-schema.js';
import { normalizeCameraPayload } from './normalize.js';

export interface CameraRoutesOptions {
  sessionService: SessionService;
  scaleClient: ScaleClient;
}

export function registerCameraRoutes(app: FastifyInstance, options: CameraRoutesOptions): void {
  app.post<{ Body: CameraWebhookPayload }>(
    '/webhooks/camera/entrance',
    { schema: { body: cameraWebhookPayloadSchema } },
    async (request, reply) => {
      const event = normalizeCameraPayload(request.body);
      const { weightKg, weightCaptureFailed } = await options.scaleClient.readStableWeight();

      const result = options.sessionService.handleEntranceReading({
        rawPlate: event.rawPlate,
        cameraId: event.cameraId,
        timestamp: event.timestamp,
        weightKg,
        weightCaptureFailed,
      });

      reply.send(toResponseBody(result));
    },
  );

  app.post<{ Body: CameraWebhookPayload }>(
    '/webhooks/camera/exit',
    { schema: { body: cameraWebhookPayloadSchema } },
    async (request, reply) => {
      const event = normalizeCameraPayload(request.body);
      const { weightKg, weightCaptureFailed } = await options.scaleClient.readStableWeight();

      const result = options.sessionService.handleExitReading({
        rawPlate: event.rawPlate,
        cameraId: event.cameraId,
        timestamp: event.timestamp,
        weightKg,
        weightCaptureFailed,
      });

      reply.send(toResponseBody(result));
    },
  );
}

function toResponseBody(result: EntranceResult | ExitResult): { kind: string; ticketId?: number } {
  return 'ticket' in result ? { kind: result.kind, ticketId: result.ticket.id } : { kind: result.kind };
}
