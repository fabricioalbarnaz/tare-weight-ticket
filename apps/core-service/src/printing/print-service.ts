import type { PrintTicketRequest, PrintTicketResponse } from '@tare/shared';
import type { Ticket, TicketRepository } from '../tickets/repository.js';
import type { PrintClient } from './print-client.js';

export const PRINT_AUDIT_ACTIONS = {
  TICKET_PRINTED: 'ticket_printed',
  TICKET_REPRINTED: 'ticket_reprinted',
  PRINT_FAILED: 'ticket_print_failed',
} as const;

export interface PrintService {
  /** Auto-print right after a ticket closes. No-op if it was already printed (master plan §5 single-print guarantee). */
  printIfNeeded(ticket: Ticket): Promise<void>;
  /** Forces a reprint regardless of printedAt — the "manual reprint support" deliverable, called by the future Admin UI. */
  reprint(ticketId: number): Promise<PrintTicketResponse>;
}

export function createPrintService(repo: TicketRepository, printClient: PrintClient): PrintService {
  async function print(ticket: Ticket, actor: 'system' | 'admin'): Promise<PrintTicketResponse> {
    const result = await printClient.printTicket(toPrintTicketRequest(ticket));

    repo.transaction(() => {
      if (result.success) {
        repo.markPrinted(ticket.id, new Date());
        repo.appendAuditLog(
          ticket.id,
          actor,
          actor === 'admin' ? PRINT_AUDIT_ACTIONS.TICKET_REPRINTED : PRINT_AUDIT_ACTIONS.TICKET_PRINTED,
        );
      } else {
        repo.appendAuditLog(ticket.id, actor, PRINT_AUDIT_ACTIONS.PRINT_FAILED, { error: result.error });
      }
    });

    return result;
  }

  return {
    async printIfNeeded(ticket) {
      if (ticket.status !== 'CLOSED' || ticket.printedAt !== null) return;
      await print(ticket, 'system');
    },

    async reprint(ticketId) {
      const ticket = repo.findById(ticketId);
      if (!ticket) return { success: false, error: `Ticket ${ticketId} not found` };
      if (ticket.status !== 'CLOSED') return { success: false, error: `Ticket ${ticketId} is not CLOSED` };

      return print(ticket, 'admin');
    },
  };
}

function toPrintTicketRequest(ticket: Ticket): PrintTicketRequest {
  return {
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    plate: ticket.plate,
    entryAt: ticket.entryAt ? ticket.entryAt.toISOString() : null,
    exitAt: ticket.exitAt ? ticket.exitAt.toISOString() : null,
    entryWeightKg: ticket.entryWeightKg,
    exitWeightKg: ticket.exitWeightKg,
    netWeightKg: ticket.netWeightKg,
  };
}
