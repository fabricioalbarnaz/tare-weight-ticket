import { describe, expect, it } from 'vitest';
import type { PrintTicketRequest } from '@tare/shared';
import { buildTicketEscPos } from './escpos.js';

const baseTicket: PrintTicketRequest = {
  ticketId: 1,
  ticketNumber: 42,
  plate: 'ABC1234',
  entryAt: '2026-01-01T08:00:00.000Z',
  exitAt: '2026-01-01T09:00:00.000Z',
  entryWeightKg: 20000,
  exitWeightKg: 8000,
  netWeightKg: 12000,
};

describe('buildTicketEscPos', () => {
  it('starts with the ESC/POS initialize command and ends with the cut command', () => {
    const bytes = buildTicketEscPos(baseTicket);

    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(bytes.subarray(-3)).toEqual(Buffer.from([0x1d, 0x56, 0x00]));
  });

  it('includes the plate, ticket number, and weights as readable text', () => {
    const text = buildTicketEscPos(baseTicket).toString('ascii');

    expect(text).toContain('Ticket #: 42');
    expect(text).toContain('Plate: ABC1234');
    expect(text).toContain('Entry weight: 20000 kg');
    expect(text).toContain('Exit weight:  8000 kg');
    expect(text).toContain('Net weight:   12000 kg');
  });

  it('renders N/A for missing weights and timestamps (e.g. a failed capture leg)', () => {
    const text = buildTicketEscPos({
      ...baseTicket,
      exitAt: null,
      exitWeightKg: null,
      netWeightKg: null,
    }).toString('ascii');

    expect(text).toContain('Exit:  N/A');
    expect(text).toContain('Exit weight:  N/A');
    expect(text).toContain('Net weight:   N/A');
  });
});
