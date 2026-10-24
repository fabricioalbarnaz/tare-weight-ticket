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

    expect(text).toContain('TICKET DE PESAGEM');
    expect(text).toContain('Ticket: 42');
    expect(text).toContain('Placa:  ABC1234');
    expect(text).toContain('Peso entrada: 20000 kg');
    expect(text).toContain('Peso saida:   8000 kg');
    expect(text).toContain('Peso liquido: 12000 kg');
  });

  it('renders N/D for missing weights and timestamps (e.g. a failed capture leg)', () => {
    const text = buildTicketEscPos({
      ...baseTicket,
      exitAt: null,
      exitWeightKg: null,
      netWeightKg: null,
    }).toString('ascii');

    expect(text).toContain('Saida:   N/D');
    expect(text).toContain('Peso saida:   N/D');
    expect(text).toContain('Peso liquido: N/D');
  });

  it('sets double-size only for the title, keeping the body at normal (unstretched) size', () => {
    const text = buildTicketEscPos(baseTicket).toString('latin1');

    const doubleSizeCmd = String.fromCharCode(0x1d, 0x21, 0x11); // GS ! 0x11
    const normalSizeCmd = String.fromCharCode(0x1d, 0x21, 0x00); // GS ! 0x00

    const doubleAt = text.indexOf(doubleSizeCmd);
    const titleAt = text.indexOf('TICKET DE PESAGEM');
    const ticketFieldAt = text.indexOf('Ticket: 42');

    expect(doubleAt).toBeGreaterThanOrEqual(0);
    expect(doubleAt).toBeLessThan(titleAt);
    // back to normal size before the body fields (no stretched characters)
    expect(text.indexOf(normalSizeCmd, titleAt)).toBeGreaterThan(titleAt);
    expect(text.indexOf(normalSizeCmd, titleAt)).toBeLessThan(ticketFieldAt);
  });

  it('bolds the body fields and underlines the net weight for emphasis', () => {
    const text = buildTicketEscPos(baseTicket).toString('latin1');

    const boldOnCmd = String.fromCharCode(0x1b, 0x45, 0x01);
    const underlineOnCmd = String.fromCharCode(0x1b, 0x2d, 0x01);
    const underlineOffCmd = String.fromCharCode(0x1b, 0x2d, 0x00);

    const ticketFieldAt = text.indexOf('Ticket: 42');
    const netWeightAt = text.indexOf('Peso liquido');

    expect(text.lastIndexOf(boldOnCmd, ticketFieldAt)).toBeGreaterThanOrEqual(0);
    expect(text.lastIndexOf(underlineOnCmd, netWeightAt)).toBeGreaterThan(text.indexOf('Peso saida'));
    expect(text.indexOf(underlineOffCmd, netWeightAt)).toBeGreaterThan(netWeightAt);
  });
});
