import { EventEmitter } from 'node:events';
import type { ScaleReadFailureReason } from '../scale/types.js';
import type { Ticket } from '../tickets/repository.js';

/**
 * In-process pub/sub narrating each camera/scale weighing as it happens, so
 * the Admin UI's "Operação" screen can show a live play-by-play (plate
 * detected → reading weight → result) instead of only refetching the
 * ticket listing — see docs/plans/2026-11-05-operator-live-weighing-panel.md.
 * Separate from `tickets/ticket-events.ts`'s `TicketEvents`, which is
 * deliberately payload-less ("something changed, refetch"); this one's
 * payload *is* the content. Same single-process `EventEmitter` rationale
 * as `TicketEvents` — one core-service process per balance.
 */
export type WeighingDirection = 'entrance' | 'exit';

export interface PlateReceivedEvent {
  direction: WeighingDirection;
  rawPlate: string;
}

export type WeighingOutcome =
  | 'ticket_opened'
  | 'ticket_retriggered'
  | 'ticket_closed'
  | 'ticket_closed_via_tare'
  | 'ticket_reweighed'
  | 'exit_capture_pending'
  | 'anomaly_flagged'
  | 'plate_unreadable';

export interface WeighingResultEvent {
  direction: WeighingDirection;
  rawPlate: string;
  weightKg: number | null;
  weightCaptureFailed: boolean;
  failureReason?: ScaleReadFailureReason;
  outcome: WeighingOutcome;
  /** Absent only for `plate_unreadable`, the one outcome with no ticket at all. */
  ticket?: Ticket;
}

export interface WeighingEvents {
  emitPlateReceived(event: PlateReceivedEvent): void;
  onPlateReceived(listener: (event: PlateReceivedEvent) => void): void;
  offPlateReceived(listener: (event: PlateReceivedEvent) => void): void;

  emitWeighingResult(event: WeighingResultEvent): void;
  onWeighingResult(listener: (event: WeighingResultEvent) => void): void;
  offWeighingResult(listener: (event: WeighingResultEvent) => void): void;
}

const PLATE_RECEIVED = 'plate-received';
const WEIGHING_RESULT = 'weighing-result';

export function createWeighingEvents(): WeighingEvents {
  const emitter = new EventEmitter();

  return {
    emitPlateReceived(event) {
      emitter.emit(PLATE_RECEIVED, event);
    },
    onPlateReceived(listener) {
      emitter.on(PLATE_RECEIVED, listener);
    },
    offPlateReceived(listener) {
      emitter.off(PLATE_RECEIVED, listener);
    },

    emitWeighingResult(event) {
      emitter.emit(WEIGHING_RESULT, event);
    },
    onWeighingResult(listener) {
      emitter.on(WEIGHING_RESULT, listener);
    },
    offWeighingResult(listener) {
      emitter.off(WEIGHING_RESULT, listener);
    },
  };
}
