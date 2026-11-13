import { useEffect, useRef } from 'react';
import type { Ticket } from '../api/types';

/**
 * Mirrors `core-service/src/camera/weighing-events.ts`'s payload shapes —
 * see docs/plans/2026-11-05-operator-live-weighing-panel.md. Field names
 * deliberately match the backend, same convention as `api/types.ts`.
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
  failureReason?: string;
  outcome: WeighingOutcome;
  /** Absent only for `plate_unreadable`, the one outcome with no ticket at all. */
  ticket?: Ticket;
}

/**
 * Subscribes to the core-service SSE ticket stream's two narration events
 * (plate detected, then the weighing result) for the Operação screen's
 * live weighing panel. Separate from `useTicketEvents` — that one only
 * signals "something changed, refetch"; this one's payload is the content.
 * Callbacks are read through a ref so the `EventSource` connection is
 * opened once per mount regardless of the caller re-rendering.
 */
export function useWeighingEvents(
  onPlateReceived: (event: PlateReceivedEvent) => void,
  onResult: (event: WeighingResultEvent) => void,
): void {
  const onPlateReceivedRef = useRef(onPlateReceived);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onPlateReceivedRef.current = onPlateReceived;
    onResultRef.current = onResult;
  }, [onPlateReceived, onResult]);

  useEffect(() => {
    const source = new EventSource('/api/admin/tickets/stream');

    const handlePlateReceived = (event: MessageEvent<string>) => {
      onPlateReceivedRef.current(JSON.parse(event.data) as PlateReceivedEvent);
    };
    const handleResult = (event: MessageEvent<string>) => {
      onResultRef.current(JSON.parse(event.data) as WeighingResultEvent);
    };

    source.addEventListener('weighing-plate-received', handlePlateReceived);
    source.addEventListener('weighing-result', handleResult);

    return () => {
      source.removeEventListener('weighing-plate-received', handlePlateReceived);
      source.removeEventListener('weighing-result', handleResult);
      source.close();
    };
  }, []);
}
