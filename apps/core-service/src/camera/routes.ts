import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ScaleClient } from '../scale/types.js';
import type { DriverSignalAdapter } from '../driver-signal/types.js';
import type { PrintService } from '../printing/print-service.js';
import type { EntranceResult, ExitResult, SessionService } from '../tickets/session-service.js';
import { parseAnprXml } from './anpr-xml.js';
import { normalizeCameraPayload } from './normalize.js';

export interface CameraRoutesOptions {
  sessionService: SessionService;
  scaleClient: ScaleClient;
  driverSignalAdapter: DriverSignalAdapter;
  printService: PrintService;
}

const ANPR_XML_FIELD_NAME = 'anpr.xml';

/**
 * The real camera push is `multipart/form-data`: one `anpr.xml` part (the
 * event metadata this system cares about) plus three JPEG parts
 * (`detectionPicture`/`featurePicture`/`licensePlatePicture`), per the
 * real capture in the master plan §7 item 3. The JPEGs are drained (so the
 * request body is fully consumed) and discarded — nothing in this system
 * stores images today. Returns `null` (and has already replied 400) if the
 * `anpr.xml` part is missing or malformed.
 */
async function readAnprXmlPart(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  let xml: string | null = null;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.fieldname === ANPR_XML_FIELD_NAME) {
        xml = buffer.toString('utf8');
      }
    }
  }

  if (xml === null) {
    reply.code(400).send({ error: `missing "${ANPR_XML_FIELD_NAME}" part` });
    return null;
  }

  return xml;
}

export function registerCameraRoutes(app: FastifyInstance, options: CameraRoutesOptions): void {
  app.post('/webhooks/camera/entrance', async (request, reply) => {
    // Captured before the scale wait so entryAt reflects when the truck
    // actually crossed the camera, not when the (possibly multi-second)
    // stable-weight read finished. The camera's own `dateTime` is not
    // trusted for this — its clock isn't kept in sync with the server.
    const receivedAt = new Date();

    const xml = await readAnprXmlPart(request, reply);
    if (xml === null) return;

    let anprEvent;
    try {
      anprEvent = parseAnprXml(xml);
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
      return;
    }

    const event = normalizeCameraPayload(anprEvent);
    const { weightKg, weightCaptureFailed, failureReason, waitedMs } = await options.scaleClient.readStableWeight({
      logger: request.log,
      direction: 'entrance',
      plate: event.rawPlate,
    });
    // Deliberate reversal of the earlier "always signal, truck never stuck"
    // design: once a weight is never recoverable after the truck leaves the
    // scale, releasing it without one is worse than holding it — the
    // operator's manual release button is the only way forward from here
    // until the record is corrected (see docs/plans/2026-10-27-...).
    if (weightCaptureFailed) {
      request.log.warn(
        { plate: event.rawPlate, failureReason },
        'camera: entrance weight capture failed, withholding driver signal — truck held pending manual correction',
      );
    } else {
      await options.driverSignalAdapter.signalDriver('in');
    }

    const result = options.sessionService.handleEntranceReading({
      rawPlate: event.rawPlate,
      cameraId: event.cameraId,
      timestamp: event.timestamp,
      receivedAt,
      weightKg,
      weightCaptureFailed,
      failureReason,
      waitedMs,
    });

    // Internal trucks (master plan §11) can close a ticket right on the
    // entrance leg — the exit leg comes from the registered tare, not a
    // later webhook — so printing has to be triggered here too, not just
    // in the exit handler below.
    if (result.kind === 'ticket_closed_via_tare') {
      await options.printService.printIfNeeded(result.ticket);
    }

    reply.send(toResponseBody(result));
  });

  app.post('/webhooks/camera/exit', async (request, reply) => {
    // See the matching comment in the entrance handler — captured before
    // the scale wait, not trusted from the camera's own `dateTime`.
    const receivedAt = new Date();

    const xml = await readAnprXmlPart(request, reply);
    if (xml === null) return;

    let anprEvent;
    try {
      anprEvent = parseAnprXml(xml);
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
      return;
    }

    const event = normalizeCameraPayload(anprEvent);
    const { weightKg, weightCaptureFailed, failureReason, waitedMs } = await options.scaleClient.readStableWeight({
      logger: request.log,
      direction: 'exit',
      plate: event.rawPlate,
    });
    // See the matching comment in the entrance handler.
    if (weightCaptureFailed) {
      request.log.warn(
        { plate: event.rawPlate, failureReason },
        'camera: exit weight capture failed, withholding driver signal — truck held pending manual correction',
      );
    } else {
      await options.driverSignalAdapter.signalDriver('out');
    }

    const result = options.sessionService.handleExitReading({
      rawPlate: event.rawPlate,
      cameraId: event.cameraId,
      timestamp: event.timestamp,
      receivedAt,
      weightKg,
      weightCaptureFailed,
      failureReason,
      waitedMs,
    });

    if (result.kind === 'ticket_closed') {
      await options.printService.printIfNeeded(result.ticket);
    }

    reply.send(toResponseBody(result));
  });
}

function toResponseBody(result: EntranceResult | ExitResult): { kind: string; ticketId?: number } {
  return 'ticket' in result ? { kind: result.kind, ticketId: result.ticket.id } : { kind: result.kind };
}
