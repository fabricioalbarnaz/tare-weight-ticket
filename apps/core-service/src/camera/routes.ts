import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ScaleClient } from '../scale/types.js';
import type { DriverSignalAdapter } from '../driver-signal/types.js';
import type { PrintService } from '../printing/print-service.js';
import type { EntranceResult, ExitResult, SessionService } from '../tickets/session-service.js';
import type { RawEventSource } from '../db/schema.js';
import { parseAnprXml, type AnprXmlEvent } from './anpr-xml.js';
import { normalizeCameraPayload, type NormalizedCameraEvent } from './normalize.js';
import type { WeighingEvents } from './weighing-events.js';

export interface CameraRoutesOptions {
  sessionService: SessionService;
  scaleClient: ScaleClient;
  driverSignalAdapter: DriverSignalAdapter;
  printService: PrintService;
  /**
   * `exitAt` of the most recently closed ticket (any plate), or null if
   * none has ever closed — see docs/plans/2026-11-03-camera-post-release-debounce-plan.md.
   */
  getMostRecentExitAt: () => Date | null;
  /** How long after that to discard any camera webhook outright, regardless of which plate it reports. */
  postReleaseDebounceMs: number;
  recordRawEvent: (source: RawEventSource, rawPayload: unknown) => void;
  /** Narrates each reading for the Admin UI's live weighing panel — see docs/plans/2026-11-05-operator-live-weighing-panel.md. */
  weighingEvents: WeighingEvents;
}

const ANPR_XML_FIELD_NAME = 'anpr.xml';

/** How much of an unusable `anpr.xml` part to put in the log line. */
const IGNORED_XML_LOG_CHARS = 500;

/**
 * The real camera push is `multipart/form-data`: one `anpr.xml` part (the
 * event metadata this system cares about) plus three JPEG parts
 * (`detectionPicture`/`featurePicture`/`licensePlatePicture`), per the
 * real capture in the master plan §7 item 3. The JPEGs are drained (so the
 * request body is fully consumed) and discarded — nothing in this system
 * stores images today. `xml` is `null` if there was no `anpr.xml` part;
 * `fieldNames` lists every part received (for logging an unusable push).
 */
async function readAnprXmlPart(request: FastifyRequest): Promise<{ xml: string | null; fieldNames: string[] }> {
  let xml: string | null = null;
  const fieldNames: string[] = [];

  for await (const part of request.parts()) {
    fieldNames.push(part.fieldname);
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.fieldname === ANPR_XML_FIELD_NAME) {
        xml = buffer.toString('utf8');
      }
    }
  }

  return { xml, fieldNames };
}

/**
 * Acknowledges (200) a camera push this system can't use — no `anpr.xml`
 * part, or one that isn't an ANPR event (no `deviceID`/`dateTime`) —
 * instead of rejecting it with 400. The camera has `checkResponseEnabled`
 * on, so a non-2xx makes it retry the same push indefinitely (observed
 * 2026-11-10: a 400 every ~10 s for hours on the entrance camera, with real
 * plate reads apparently stuck behind it) — see
 * docs/plans/2026-11-10-camera-ack-non-anpr-events-plan.md. Nothing else
 * happens for an ignored push: no ticket, scale read, signal or print.
 */
function ignoreUnusablePush(
  request: FastifyRequest,
  reply: FastifyReply,
  direction: 'entrance' | 'exit',
  reason: string,
  fieldNames: string[],
  xml: string | null,
): void {
  request.log.warn(
    { direction, reason, fieldNames, xmlSample: xml?.slice(0, IGNORED_XML_LOG_CHARS) ?? null },
    `camera: ${direction} push ignored (acknowledged with 200 so the camera does not retry it) — ${reason}`,
  );
  reply.send({ kind: 'ignored', reason });
}

/**
 * Reads and parses the push's `anpr.xml`. Returns `null` (and has already
 * replied via `ignoreUnusablePush`) when the push isn't a usable ANPR event.
 */
async function readAnprEvent(
  request: FastifyRequest,
  reply: FastifyReply,
  direction: 'entrance' | 'exit',
): Promise<AnprXmlEvent | null> {
  const { xml, fieldNames } = await readAnprXmlPart(request);
  if (xml === null) {
    ignoreUnusablePush(request, reply, direction, `missing "${ANPR_XML_FIELD_NAME}" part`, fieldNames, null);
    return null;
  }

  try {
    return parseAnprXml(xml);
  } catch (err) {
    ignoreUnusablePush(request, reply, direction, (err as Error).message, fieldNames, xml);
    return null;
  }
}

/**
 * Discards a camera reading that arrives too soon after the last ticket
 * closed, regardless of which plate it reports — see
 * docs/plans/2026-11-03-camera-post-release-debounce-plan.md. A released
 * truck rolling back slightly can re-trigger either camera, which then
 * reads the *other* plate of the same articulated rig (tractor vs.
 * trailer), so matching on "same plate" can't catch this; only recency of
 * the last release can. Returns true (and has already replied) when the
 * reading was discarded.
 */
function checkPostReleaseDebounce(
  options: CameraRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
  direction: 'entrance' | 'exit',
  event: NormalizedCameraEvent,
  triggeredAt: Date,
): boolean {
  const lastExitAt = options.getMostRecentExitAt();
  if (lastExitAt === null) return false;

  const msSinceLastExit = triggeredAt.getTime() - lastExitAt.getTime();
  if (msSinceLastExit < 0 || msSinceLastExit >= options.postReleaseDebounceMs) return false;

  request.log.warn(
    { plate: event.rawPlate, cameraId: event.cameraId, direction, msSinceLastExit },
    `camera: ${direction} reading discarded — received ${msSinceLastExit}ms after the last ticket closed, inside the post-release debounce window (likely a truck rollback bounce; see docs/plans/2026-11-03-camera-post-release-debounce-plan.md)`,
  );
  options.recordRawEvent(direction === 'entrance' ? 'camera_entrance' : 'camera_exit', {
    rawPlate: event.rawPlate,
    cameraId: event.cameraId,
    triggeredAt,
    discarded: 'post_release_debounce',
    msSinceLastExit,
  });
  reply.send({ kind: 'reading_debounced' });
  return true;
}

export function registerCameraRoutes(app: FastifyInstance, options: CameraRoutesOptions): void {
  app.post('/webhooks/camera/entrance', async (request, reply) => {
    // Captured before the scale wait — only used for the post-release
    // debounce check below, which is about when the truck physically
    // re-triggered the camera, not when its weighing finished. entryAt
    // itself comes from `weighingFinishedAt`, captured after the scale
    // read below. The camera's own `dateTime` is not trusted for either —
    // its clock isn't kept in sync with the server.
    const triggeredAt = new Date();

    const anprEvent = await readAnprEvent(request, reply, 'entrance');
    if (anprEvent === null) return;

    const event = normalizeCameraPayload(anprEvent);
    if (checkPostReleaseDebounce(options, request, reply, 'entrance', event, triggeredAt)) return;

    options.weighingEvents.emitPlateReceived({ direction: 'entrance', rawPlate: event.rawPlate });

    const { weightKg, weightCaptureFailed, failureReason, waitedMs, attemptsUsed } = await options.scaleClient.readStableWeight({
      logger: request.log,
      direction: 'entrance',
      plate: event.rawPlate,
    });
    // Captured right after the scale read settles (or gives up) — this is
    // entryAt: the moment the weighing itself finished, not when the truck
    // crossed the camera (see docs/plans/2026-11-04-ticket-timestamp-from-weighing-plan.md).
    const weighingFinishedAt = new Date();

    const result = options.sessionService.handleEntranceReading({
      rawPlate: event.rawPlate,
      cameraId: event.cameraId,
      timestamp: event.timestamp,
      weighingFinishedAt,
      weightKg,
      weightCaptureFailed,
      failureReason,
      waitedMs,
      attemptsUsed,
    });

    options.weighingEvents.emitWeighingResult({
      direction: 'entrance',
      rawPlate: event.rawPlate,
      weightKg,
      weightCaptureFailed,
      failureReason,
      outcome: result.kind,
      ticket: 'ticket' in result ? result.ticket : undefined,
    });

    // Signaled only after handleEntranceReading above has returned — i.e.
    // only once the reading is durably recorded — never before. Releasing
    // the truck is irreversible (it can't be re-weighed), so the record
    // must exist first; signaling first risked releasing a truck whose
    // weight/plate was never actually saved (e.g. a DB write failure, or a
    // plate that only normalizes to empty inside the session service),
    // which would make that load unbillable (2026-11-04).
    //
    // Deliberate reversal of the earlier "always signal, truck never
    // stuck" design: once a weight is never recoverable after the truck
    // leaves the scale, releasing it without one is worse than holding it
    // — the operator's manual release button is the only way forward from
    // here until the record is corrected (see docs/plans/2026-10-27-...).
    // An unreadable plate withholds the signal for the same reason (added
    // 2026-11-03): with no plate, a captured weight can never be attributed
    // to a truck afterward, which blocks payment downstream — see
    // docs/plans/2026-11-03-withhold-signal-on-unreadable-plate-plan.md.
    if (result.kind === 'plate_unreadable') {
      request.log.warn({}, 'camera: entrance plate unreadable, withholding driver signal — truck held pending manual intervention');
    } else if (weightCaptureFailed) {
      request.log.warn(
        { plate: event.rawPlate, failureReason },
        'camera: entrance weight capture failed, withholding driver signal — truck held pending manual correction',
      );
    } else {
      await options.driverSignalAdapter.signalDriver('in');
    }

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
    // See the matching comment in the entrance handler — triggeredAt is
    // debounce-only, exitAt comes from weighingFinishedAt below.
    const triggeredAt = new Date();

    const anprEvent = await readAnprEvent(request, reply, 'exit');
    if (anprEvent === null) return;

    const event = normalizeCameraPayload(anprEvent);
    if (checkPostReleaseDebounce(options, request, reply, 'exit', event, triggeredAt)) return;

    options.weighingEvents.emitPlateReceived({ direction: 'exit', rawPlate: event.rawPlate });

    const { weightKg, weightCaptureFailed, failureReason, waitedMs, attemptsUsed } = await options.scaleClient.readStableWeight({
      logger: request.log,
      direction: 'exit',
      plate: event.rawPlate,
    });
    // See the matching comment in the entrance handler.
    const weighingFinishedAt = new Date();

    const result = options.sessionService.handleExitReading({
      rawPlate: event.rawPlate,
      cameraId: event.cameraId,
      timestamp: event.timestamp,
      weighingFinishedAt,
      weightKg,
      weightCaptureFailed,
      failureReason,
      waitedMs,
      attemptsUsed,
    });

    options.weighingEvents.emitWeighingResult({
      direction: 'exit',
      rawPlate: event.rawPlate,
      weightKg,
      weightCaptureFailed,
      failureReason,
      outcome: result.kind,
      ticket: 'ticket' in result ? result.ticket : undefined,
    });

    // See the matching comment in the entrance handler — signaled only
    // after handleExitReading above has returned successfully.
    if (result.kind === 'plate_unreadable') {
      request.log.warn({}, 'camera: exit plate unreadable, withholding driver signal — truck held pending manual intervention');
    } else if (weightCaptureFailed) {
      request.log.warn(
        { plate: event.rawPlate, failureReason },
        'camera: exit weight capture failed, withholding driver signal — truck held pending manual correction',
      );
    } else {
      await options.driverSignalAdapter.signalDriver('out');
    }

    if (result.kind === 'ticket_closed') {
      await options.printService.printIfNeeded(result.ticket);
    }

    reply.send(toResponseBody(result));
  });
}

function toResponseBody(result: EntranceResult | ExitResult): { kind: string; ticketId?: number } {
  return 'ticket' in result ? { kind: result.kind, ticketId: result.ticket.id } : { kind: result.kind };
}
