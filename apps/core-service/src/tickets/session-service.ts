import { normalizePlate } from '../domain/plate.js';
import type { ScaleReadFailureReason } from '../scale/types.js';
import type { Ticket, TicketRepository } from './repository.js';

export const TICKET_AUDIT_ACTIONS = {
  ENTRY_CAPTURED: 'entry_captured',
  ENTRY_CAPTURE_FAILED: 'entry_capture_failed',
  ENTRY_OVERWRITTEN: 'entry_overwritten',
  EXIT_CAPTURED: 'exit_captured',
  EXIT_CAPTURE_FAILED: 'exit_capture_failed',
  ANOMALY_FLAGGED: 'anomaly_flagged',
} as const;

export interface EntranceReadingInput {
  rawPlate: string;
  cameraId: string;
  /** Camera-reported event time — forensic only, see `receivedAt`. */
  timestamp: Date;
  /**
   * Server clock time at webhook receipt, captured before the scale wait.
   * This is the authoritative source for `entryAt` — the camera's own
   * `timestamp` is not trusted for it, since the camera's clock can drift
   * or be misconfigured independently of the server.
   */
  receivedAt: Date;
  /** The stable weight read from the scale, or null if the read timed out. */
  weightKg: number | null;
  /** True when the scale never reported a stable weight within the timeout. */
  weightCaptureFailed: boolean;
  /** Only set when weightCaptureFailed is true — see ScaleReadResult. */
  failureReason?: ScaleReadFailureReason;
  waitedMs?: number;
}

export type EntranceResult =
  | { kind: 'ticket_opened'; ticket: Ticket }
  | { kind: 'ticket_retriggered'; ticket: Ticket }
  | { kind: 'plate_unreadable' };

export interface ExitReadingInput {
  rawPlate: string;
  cameraId: string;
  /** Camera-reported event time — forensic only, see `receivedAt`. */
  timestamp: Date;
  /**
   * Server clock time at webhook receipt, captured before the scale wait.
   * This is the authoritative source for `exitAt` — see the matching note
   * on `EntranceReadingInput.receivedAt`.
   */
  receivedAt: Date;
  weightKg: number | null;
  weightCaptureFailed: boolean;
  /** Only set when weightCaptureFailed is true — see ScaleReadResult. */
  failureReason?: ScaleReadFailureReason;
  waitedMs?: number;
}

export type ExitResult =
  | { kind: 'ticket_closed'; ticket: Ticket }
  | { kind: 'exit_capture_pending'; ticket: Ticket }
  | { kind: 'anomaly_flagged'; ticket: Ticket }
  | { kind: 'plate_unreadable' };

export interface SessionService {
  handleEntranceReading(input: EntranceReadingInput): EntranceResult;
  handleExitReading(input: ExitReadingInput): ExitResult;
}

export function createSessionService(repo: TicketRepository): SessionService {
  return {
    handleEntranceReading(input) {
      const plate = normalizePlate(input.rawPlate);

      if (plate === '') {
        repo.recordRawEvent('camera_entrance', {
          rawPlate: input.rawPlate,
          cameraId: input.cameraId,
          timestamp: input.timestamp,
        });
        return { kind: 'plate_unreadable' };
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
              entryAt: input.receivedAt,
              entryWeightKg: input.weightKg,
              entryCameraId: input.cameraId,
              entryCaptureFailed: input.weightCaptureFailed,
            })
          : repo.create({
              plate,
              entryAt: input.receivedAt,
              entryWeightKg: input.weightKg,
              entryCameraId: input.cameraId,
              entryCaptureFailed: input.weightCaptureFailed,
            });

        repo.appendAuditLog(ticket.id, 'system', action, {
          weightKg: input.weightKg,
          cameraId: input.cameraId,
          isRetrigger: Boolean(existing),
        });
        repo.recordRawEvent(
          'camera_entrance',
          { rawPlate: input.rawPlate, plate, cameraId: input.cameraId, timestamp: input.timestamp },
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
        repo.recordRawEvent('camera_exit', {
          rawPlate: input.rawPlate,
          cameraId: input.cameraId,
          timestamp: input.timestamp,
        });
        return { kind: 'plate_unreadable' };
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
            });
            repo.recordRawEvent(
              'camera_exit',
              { rawPlate: input.rawPlate, plate, cameraId: input.cameraId, timestamp: input.timestamp },
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
            exitAt: input.receivedAt,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: false,
          });
          repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.EXIT_CAPTURED, {
            weightKg: input.weightKg,
            cameraId: input.cameraId,
          });
          repo.recordRawEvent(
            'camera_exit',
            {
              rawPlate: input.rawPlate,
              plate,
              cameraId: input.cameraId,
              timestamp: input.timestamp,
            },
            ticket.id,
          );
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

        const ticket = repo.flagAnomaly({
          plate,
          exitAt: input.receivedAt,
          exitWeightKg: input.weightKg,
          exitCameraId: input.cameraId,
          exitCaptureFailed: input.weightCaptureFailed,
        });
        repo.appendAuditLog(ticket.id, 'system', TICKET_AUDIT_ACTIONS.ANOMALY_FLAGGED, {
          weightKg: input.weightKg,
          cameraId: input.cameraId,
        });
        repo.recordRawEvent(
          'camera_exit',
          { rawPlate: input.rawPlate, plate, cameraId: input.cameraId, timestamp: input.timestamp },
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
