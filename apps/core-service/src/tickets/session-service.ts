import { normalizePlate } from '../domain/plate.js';
import type { ScaleReadFailureReason } from '../scale/types.js';
import type { CameraReadQuality } from '../camera/normalize.js';
import type { TruckRepository } from '../trucks/repository.js';
import type { TicketConfig } from './config.js';
import type { Ticket, TicketRepository } from './repository.js';

export const TICKET_AUDIT_ACTIONS = {
  ENTRY_CAPTURED: 'entry_captured',
  ENTRY_CAPTURE_FAILED: 'entry_capture_failed',
  ENTRY_OVERWRITTEN: 'entry_overwritten',
  EXIT_CAPTURED: 'exit_captured',
  EXIT_CAPTURE_FAILED: 'exit_capture_failed',
  ANOMALY_FLAGGED: 'anomaly_flagged',
  /** The entry leg was filled from a registered internal truck's active conjunto tare, not a real camera/scale event — see master plan §11. */
  ENTRY_VIA_TARE: 'internal_truck_entry_via_tare',
  /** The exit leg was filled from a registered internal truck's active conjunto tare — see master plan §11. */
  EXIT_VIA_TARE: 'internal_truck_exit_via_tare',
  /** A new ticket created to correct a prior exit weight, reusing a CLOSED ticket's entry — see master plan §5/§11 "Exit re-weigh". */
  REWEIGH_CREATED: 'reweigh_ticket_created',
  /** The original ticket superseded by a REWEIGH_CREATED ticket — the inverse side of that action. */
  REWEIGHED: 'ticket_reweighed',
} as const;

export interface EntranceReadingInput {
  rawPlate: string;
  cameraId: string;
  /** Camera-reported event time — forensic only, see `weighingFinishedAt`. */
  timestamp: Date;
  /** Camera's own read confidence — stored in the camera raw event for analysis only. */
  readQuality?: CameraReadQuality;
  /**
   * Server clock time right after the scale read settled (or gave up) —
   * i.e. when the weighing itself finished, not when the truck crossed
   * the camera. This is the authoritative source for `entryAt` — the
   * camera's own `timestamp` is not trusted for it, since the camera's
   * clock can drift or be misconfigured independently of the server.
   */
  weighingFinishedAt: Date;
  /** The stable weight read from the scale, or null if the read timed out. */
  weightKg: number | null;
  /** True when the scale never reported a stable weight within the timeout. */
  weightCaptureFailed: boolean;
  /** Only set when weightCaptureFailed is true — see ScaleReadResult. */
  failureReason?: ScaleReadFailureReason;
  waitedMs?: number;
  /** Which scale-read attempt this resolved on (or exhausted on) — see ScaleReadResult. */
  attemptsUsed?: number;
}

export type EntranceResult =
  | { kind: 'ticket_opened'; ticket: Ticket }
  | { kind: 'ticket_retriggered'; ticket: Ticket }
  /** Internal truck (master plan §11): the entrance leg was the real weighing, the exit leg came from the active conjunto's tare — ticket closes immediately. */
  | { kind: 'ticket_closed_via_tare'; ticket: Ticket }
  | { kind: 'plate_unreadable' };

export interface ExitReadingInput {
  rawPlate: string;
  cameraId: string;
  /** Camera-reported event time — forensic only, see `weighingFinishedAt`. */
  timestamp: Date;
  /** Camera's own read confidence — stored in the camera raw event for analysis only. */
  readQuality?: CameraReadQuality;
  /**
   * Server clock time right after the scale read settled (or gave up) —
   * i.e. when the weighing itself finished, not when the truck crossed
   * the camera. This is the authoritative source for `exitAt` — see the
   * matching note on `EntranceReadingInput.weighingFinishedAt`.
   */
  weighingFinishedAt: Date;
  weightKg: number | null;
  weightCaptureFailed: boolean;
  /** Only set when weightCaptureFailed is true — see ScaleReadResult. */
  failureReason?: ScaleReadFailureReason;
  waitedMs?: number;
  /** Which scale-read attempt this resolved on (or exhausted on) — see ScaleReadResult. */
  attemptsUsed?: number;
}

export type ExitResult =
  | { kind: 'ticket_closed'; ticket: Ticket }
  | { kind: 'exit_capture_pending'; ticket: Ticket }
  | { kind: 'anomaly_flagged'; ticket: Ticket }
  /** Re-weigh correction (master plan §5/§11): no OPEN ticket for the plate, but a recently CLOSED one existed — a new ticket was created reusing its entry and closed with this new exit weight. */
  | { kind: 'ticket_reweighed'; ticket: Ticket; originalTicketId: number }
  | { kind: 'plate_unreadable' };

export interface SessionService {
  handleEntranceReading(input: EntranceReadingInput): EntranceResult;
  handleExitReading(input: ExitReadingInput): ExitResult;
}

/**
 * The `camera_entrance`/`camera_exit` raw-event payload for a reading:
 * the plate/camera/timestamp plus the camera's read-quality fields
 * (`readPlate`, `confidenceLevel`, `plateCharBelieve`), flat so they're
 * queryable with `json_extract` — see
 * docs/plans/2026-11-10-store-anpr-confidence-plan.md. `plate` is omitted
 * for an unreadable read.
 */
function cameraRawPayload(
  input: EntranceReadingInput | ExitReadingInput,
  plate?: string,
): Record<string, unknown> {
  return {
    rawPlate: input.rawPlate,
    ...(plate !== undefined ? { plate } : {}),
    cameraId: input.cameraId,
    timestamp: input.timestamp,
    ...input.readQuality,
  };
}

export function createSessionService(
  repo: TicketRepository,
  truckRepo: TruckRepository,
  ticketConfig: TicketConfig,
): SessionService {
  return {
    handleEntranceReading(input) {
      const plate = normalizePlate(input.rawPlate);

      if (plate === '') {
        repo.recordRawEvent('camera_entrance', cameraRawPayload(input));
        return { kind: 'plate_unreadable' };
      }

      const activeTare = truckRepo.findActiveTareByPlate(plate);
      if (activeTare) {
        return repo.transaction((): EntranceResult => {
          const opened = repo.create({
            plate,
            entryAt: input.weighingFinishedAt,
            entryWeightKg: input.weightKg,
            entryCameraId: input.cameraId,
            entryCaptureFailed: input.weightCaptureFailed,
          });
          const ticket = repo.close(opened.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: activeTare.tareWeightKg,
            exitCameraId: null,
            exitCaptureFailed: false,
          });

          repo.appendAuditLog(
            ticket.id,
            'system',
            input.weightCaptureFailed
              ? TICKET_AUDIT_ACTIONS.ENTRY_CAPTURE_FAILED
              : TICKET_AUDIT_ACTIONS.ENTRY_CAPTURED,
            { weightKg: input.weightKg, cameraId: input.cameraId, attemptsUsed: input.attemptsUsed },
          );
          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.EXIT_VIA_TARE, {
            truckConjuntoId: activeTare.truckConjuntoId,
            tareWeightKg: activeTare.tareWeightKg,
          });
          repo.recordRawEvent(
            'camera_entrance',
            cameraRawPayload(input, plate),
            ticket.id,
          );
          repo.recordRawEvent(
            'scale',
            {
              direction: 'entrance',
              weightKg: input.weightKg,
              weightCaptureFailed: input.weightCaptureFailed,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );

          return { kind: 'ticket_closed_via_tare', ticket };
        });
      }

      return repo.transaction((): EntranceResult => {
        const existing = repo.findOpenByPlate(plate);
        const action = input.weightCaptureFailed
          ? TICKET_AUDIT_ACTIONS.ENTRY_CAPTURE_FAILED
          : existing
            ? TICKET_AUDIT_ACTIONS.ENTRY_OVERWRITTEN
            : TICKET_AUDIT_ACTIONS.ENTRY_CAPTURED;

        const ticket = existing
          ? repo.updateEntry(existing.id, {
              entryAt: input.weighingFinishedAt,
              entryWeightKg: input.weightKg,
              entryCameraId: input.cameraId,
              entryCaptureFailed: input.weightCaptureFailed,
            })
          : repo.create({
              plate,
              entryAt: input.weighingFinishedAt,
              entryWeightKg: input.weightKg,
              entryCameraId: input.cameraId,
              entryCaptureFailed: input.weightCaptureFailed,
            });

        repo.appendAuditLog(ticket.id, 'system', action, {
          weightKg: input.weightKg,
          cameraId: input.cameraId,
          isRetrigger: Boolean(existing),
          attemptsUsed: input.attemptsUsed,
        });
        repo.recordRawEvent(
          'camera_entrance',
          cameraRawPayload(input, plate),
          ticket.id,
        );
        repo.recordRawEvent(
          'scale',
          {
            direction: 'entrance',
            weightKg: input.weightKg,
            weightCaptureFailed: input.weightCaptureFailed,
            failureReason: input.failureReason,
            waitedMs: input.waitedMs,
          },
          ticket.id,
        );

        return { kind: existing ? 'ticket_retriggered' : 'ticket_opened', ticket };
      });
    },

    handleExitReading(input) {
      const plate = normalizePlate(input.rawPlate);

      if (plate === '') {
        repo.recordRawEvent('camera_exit', cameraRawPayload(input));
        return { kind: 'plate_unreadable' };
      }

      const activeTare = truckRepo.findActiveTareByPlate(plate);
      if (activeTare) {
        return repo.transaction((): ExitResult => {
          const opened = repo.create({
            plate,
            entryAt: input.weighingFinishedAt,
            entryWeightKg: activeTare.tareWeightKg,
            entryCameraId: null,
            entryCaptureFailed: false,
          });
          const ticket = repo.close(opened.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: input.weightCaptureFailed,
          });

          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.ENTRY_VIA_TARE, {
            truckConjuntoId: activeTare.truckConjuntoId,
            tareWeightKg: activeTare.tareWeightKg,
          });
          repo.appendAuditLog(
            ticket.id,
            'system',
            input.weightCaptureFailed
              ? TICKET_AUDIT_ACTIONS.EXIT_CAPTURE_FAILED
              : TICKET_AUDIT_ACTIONS.EXIT_CAPTURED,
            { weightKg: input.weightKg, cameraId: input.cameraId, attemptsUsed: input.attemptsUsed },
          );
          repo.recordRawEvent(
            'camera_exit',
            cameraRawPayload(input, plate),
            ticket.id,
          );
          repo.recordRawEvent(
            'scale',
            {
              direction: 'exit',
              weightKg: input.weightKg,
              weightCaptureFailed: input.weightCaptureFailed,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );

          return { kind: 'ticket_closed', ticket };
        });
      }

      return repo.transaction((): ExitResult => {
        const existing = repo.findOpenByPlate(plate);

        if (existing) {
          // A failed capture never closes the ticket — there's no way to
          // re-weigh a truck once it has left the scale, so the ticket
          // stays OPEN, waiting for either a later successful exit read
          // (camera re-trigger) or a manual admin correction (which already
          // closes an OPEN ticket via PATCH /tickets/:id/exit, unchanged).
          if (input.weightCaptureFailed) {
            repo.appendAuditLog(existing.id, 'system', TICKET_AUDIT_ACTIONS.EXIT_CAPTURE_FAILED, {
              weightKg: input.weightKg,
              cameraId: input.cameraId,
              attemptsUsed: input.attemptsUsed,
            });
            repo.recordRawEvent(
              'camera_exit',
              cameraRawPayload(input, plate),
              existing.id,
            );
            repo.recordRawEvent(
              'scale',
              {
                direction: 'exit',
                weightKg: input.weightKg,
                weightCaptureFailed: input.weightCaptureFailed,
                failureReason: input.failureReason,
                waitedMs: input.waitedMs,
              },
              existing.id,
            );
            return { kind: 'exit_capture_pending', ticket: existing };
          }

          const ticket = repo.close(existing.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: false,
          });
          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.EXIT_CAPTURED, {
            weightKg: input.weightKg,
            cameraId: input.cameraId,
            attemptsUsed: input.attemptsUsed,
          });
          repo.recordRawEvent('camera_exit', cameraRawPayload(input, plate), ticket.id);
          repo.recordRawEvent(
            'scale',
            {
              direction: 'exit',
              weightKg: input.weightKg,
              weightCaptureFailed: false,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );
          return { kind: 'ticket_closed', ticket };
        }

        // Re-weigh correction (master plan §5/§11): the truck re-entered
        // through another gate (no new entrance weighing, so no OPEN
        // ticket exists) and only needs its exit corrected. A failed
        // capture never qualifies — there's no new weight to reuse, so it
        // falls through to the ANOMALY path below like any other
        // unmatched exit.
        const reweighCandidate = input.weightCaptureFailed
          ? undefined
          : repo.findMostRecentClosedTicketByPlate(plate);
        const withinReweighWindow =
          reweighCandidate?.exitAt != null &&
          input.weighingFinishedAt.getTime() - reweighCandidate.exitAt.getTime() <= ticketConfig.reweighWindowMs;

        if (reweighCandidate && withinReweighWindow) {
          const opened = repo.create({
            plate,
            entryAt: reweighCandidate.entryAt ?? input.weighingFinishedAt,
            entryWeightKg: reweighCandidate.entryWeightKg,
            entryCameraId: reweighCandidate.entryCameraId,
            entryCaptureFailed: reweighCandidate.entryCaptureFailed,
            reweighOfTicketId: reweighCandidate.id,
          });
          const ticket = repo.close(opened.id, {
            exitAt: input.weighingFinishedAt,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: false,
          });
          repo.linkReweigh(reweighCandidate.id, ticket.id);

          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.REWEIGH_CREATED, {
            originalTicketId: reweighCandidate.id,
            weightKg: input.weightKg,
            cameraId: input.cameraId,
            attemptsUsed: input.attemptsUsed,
          });
          repo.appendAuditLog(reweighCandidate.id, 'system', TICKET_AUDIT_ACTIONS.REWEIGHED, {
            newTicketId: ticket.id,
          });
          repo.recordRawEvent('camera_exit', cameraRawPayload(input, plate), ticket.id);
          repo.recordRawEvent(
            'scale',
            {
              direction: 'exit',
              weightKg: input.weightKg,
              weightCaptureFailed: false,
              failureReason: input.failureReason,
              waitedMs: input.waitedMs,
            },
            ticket.id,
          );

          return { kind: 'ticket_reweighed', ticket, originalTicketId: reweighCandidate.id };
        }

        const ticket = repo.flagAnomaly({
          plate,
          exitAt: input.weighingFinishedAt,
          exitWeightKg: input.weightKg,
          exitCameraId: input.cameraId,
          exitCaptureFailed: input.weightCaptureFailed,
        });
        repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.ANOMALY_FLAGGED, {
          weightKg: input.weightKg,
          cameraId: input.cameraId,
          attemptsUsed: input.attemptsUsed,
        });
        repo.recordRawEvent(
          'camera_exit',
          cameraRawPayload(input, plate),
          ticket.id,
        );
        repo.recordRawEvent(
          'scale',
          {
            direction: 'exit',
            weightKg: input.weightKg,
            weightCaptureFailed: input.weightCaptureFailed,
            failureReason: input.failureReason,
            waitedMs: input.waitedMs,
          },
          ticket.id,
        );
        return { kind: 'anomaly_flagged', ticket };
      });
    },
  };
}
