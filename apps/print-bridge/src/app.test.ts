import { describe, expect, it } from 'vitest';
import type { PrintTicketRequest } from '@tare/shared';
import { buildApp } from './app.js';
import type { PrinterTransport } from './printer-transport.js';

const validTicket: PrintTicketRequest = {
  ticketId: 1,
  ticketNumber: 42,
  plate: 'ABC1234',
  entryAt: '2026-01-01T08:00:00.000Z',
  exitAt: '2026-01-01T09:00:00.000Z',
  entryWeightKg: 20000,
  exitWeightKg: 8000,
  netWeightKg: 12000,
};

function createFakeTransport(): PrinterTransport & { printedBytes: Buffer[] } {
  const printedBytes: Buffer[] = [];
  return {
    printedBytes,
    async print(bytes) {
      printedBytes.push(bytes);
    },
  };
}

describe('GET /health', () => {
  it('returns ok status', async () => {
    const app = buildApp({ transport: createFakeTransport() });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /print', () => {
  it('builds ESC/POS bytes from the ticket and sends them to the transport', async () => {
    const transport = createFakeTransport();
    const app = buildApp({ transport });

    const response = await app.inject({ method: 'POST', url: '/print', payload: validTicket });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(transport.printedBytes).toHaveLength(1);
    expect(transport.printedBytes[0]!.toString('ascii')).toContain('Placa:  ABC1234');
  });

  it('rejects a payload missing a required field', async () => {
    const app = buildApp({ transport: createFakeTransport() });
    const withoutPlate: Record<string, unknown> = { ...validTicket };
    delete withoutPlate.plate;

    const response = await app.inject({ method: 'POST', url: '/print', payload: withoutPlate });

    expect(response.statusCode).toBe(400);
  });

  it('responds with success: false (not a thrown error) when the transport fails', async () => {
    const app = buildApp({
      transport: {
        async print() {
          throw new Error('printer offline');
        },
      },
    });

    const response = await app.inject({ method: 'POST', url: '/print', payload: validTicket });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ success: false, error: 'printer offline' });
  });
});
