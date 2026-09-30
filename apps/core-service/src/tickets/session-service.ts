import { normalizePlate } from '../domain/plate.js';
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
  timestamp: Date;
  /** The stable weight read from the scale, or null if the read timed out. */
  weightKg: number | null;
  /** True when the scale never reported a stable weight within the timeout. */
  weightCaptureFailed: boolean;
}

export type EntranceResult =
  | { kind: 'ticket_opened'; ticket: Ticket }
  | { kind: 'ticket_retriggered'; ticket: Ticket }
  | { kind: 'plate_unreadable' };

export interface ExitReadingInput {
  rawPlate: string;
  cameraId: string;
  timestamp: Date;
  weightKg: number | null;
  weightCaptureFailed: boolean;
}

export type ExitResult =
  | { kind: 'ticket_closed'; ticket: Ticket }
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
              entryAt: input.timestamp,
              entryWeightKg: input.weightKg,
              entryCameraId: input.cameraId,
              entryCaptureFailed: input.weightCaptureFailed,
            })
          : repo.create({
              plate,
              entryAt: input.timestamp,
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
          const ticket = repo.close(existing.id, {
            exitAt: input.timestamp,
            exitWeightKg: input.weightKg,
            exitCameraId: input.cameraId,
            exitCaptureFailed: input.weightCaptureFailed,
          });
          repo.appendAuditLog(
            ticket.id,
            'system',
            input.weightCaptureFailed
              ? TICKET_AUDIT_ACTIONS.EXIT_CAPTURE_FAILED
              : TICKET_AUDIT_ACTIONS.EXIT_CAPTURED,
            { weightKg: input.weightKg, cameraId: input.cameraId },
          );
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
          return { kind: 'ticket_closed', ticket };
        }

        const ticket = repo.flagAnomaly({
          plate,
          exitAt: input.timestamp,
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
        return { kind: 'anomaly_flagged', ticket };
      });
    },
  };
}
