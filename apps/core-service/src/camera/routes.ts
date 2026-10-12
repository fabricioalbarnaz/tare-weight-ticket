import type { FastifyInstance } from 'fastify';
import type { ScaleClient } from '../scale/types.js';
import type { DriverSignalAdapter } from '../driver-signal/types.js';
import type { PrintService } from '../printing/print-service.js';
import type { EntranceResult, ExitResult, SessionService } from '../tickets/session-service.js';
import { cameraWebhookPayloadSchema, type CameraWebhookPayload } from './payload-schema.js';
import { normalizeCameraPayload } from './normalize.js';

export interface CameraRoutesOptions {
  sessionService: SessionService;
  scaleClient: ScaleClient;
  driverSignalAdapter: DriverSignalAdapter;
  printService: PrintService;
}

export function registerCameraRoutes(app: FastifyInstance, options: CameraRoutesOptions): void {
  app.post<{ Body: CameraWebhookPayload }>(
    '/webhooks/camera/entrance',
    { schema: { body: cameraWebhookPayloadSchema } },
    async (request, reply) => {
      const event = normalizeCameraPayload(request.body);
      const { weightKg, weightCaptureFailed } = await options.scaleClient.readStableWeight();
      // The truck is on the scale regardless of the outcome below (missing
      // ticket, failed capture, etc.) — it must never be left stuck there.
      await options.driverSignalAdapter.signalDriver('in');

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
      await options.driverSignalAdapter.signalDriver('out');

      const result = options.sessionService.handleExitReading({
        rawPlate: event.rawPlate,
        cameraId: event.cameraId,
        timestamp: event.timestamp,
        weightKg,
        weightCaptureFailed,
      });

      if (result.kind === 'ticket_closed') {
        await options.printService.printIfNeeded(result.ticket);
      }

      reply.send(toResponseBody(result));
    },
  );
}

function toResponseBody(result: EntranceResult | ExitResult): { kind: string; ticketId?: number } {
  return 'ticket' in result ? { kind: result.kind, ticketId: result.ticket.id } : { kind: result.kind };
}
