import { EventEmitter } from 'node:events';
import type { Ticket } from './repository.js';

/**
 * In-process pub/sub so HTTP long-lived connections (the admin SSE ticket
 * stream) can learn about ticket mutations without polling the DB. A single
 * core-service process per balance (master plan §3) means a plain
 * `EventEmitter` is sufficient — no cross-process broker needed.
 */
export interface TicketEvents {
  emitChanged(ticket: Ticket): void;
  onChanged(listener: (ticket: Ticket) => void): void;
  offChanged(listener: (ticket: Ticket) => void): void;
}

const CHANGED = 'changed';

export function createTicketEvents(): TicketEvents {
  const emitter = new EventEmitter();

  return {
    emitChanged(ticket) {
      emitter.emit(CHANGED, ticket);
    },
    onChanged(listener) {
      emitter.on(CHANGED, listener);
    },
    offChanged(listener) {
      emitter.off(CHANGED, listener);
    },
  };
}
