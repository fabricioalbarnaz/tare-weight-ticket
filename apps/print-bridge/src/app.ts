import Fastify, { type FastifyInstance } from 'fastify';
import type { PrintTicketRequest, PrintTicketResponse } from '@tare/shared';
import { buildTicketEscPos } from './escpos.js';
import type { PrinterTransport } from './printer-transport.js';

export interface BuildAppOptions {
  transport: PrinterTransport;
}

const printTicketRequestSchema = {
  type: 'object',
  properties: {
    ticketId: { type: 'number' },
    ticketNumber: { type: 'number' },
    plate: { type: 'string' },
    entryAt: { type: ['string', 'null'] },
    exitAt: { type: ['string', 'null'] },
    entryWeightKg: { type: ['number', 'null'] },
    exitWeightKg: { type: ['number', 'null'] },
    netWeightKg: { type: ['number', 'null'] },
  },
  required: [
    'ticketId',
    'ticketNumber',
    'plate',
    'entryAt',
    'exitAt',
    'entryWeightKg',
    'exitWeightKg',
    'netWeightKg',
  ],
  additionalProperties: false,
} as const;

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post<{ Body: PrintTicketRequest; Reply: PrintTicketResponse }>(
    '/print',
    { schema: { body: printTicketRequestSchema } },
    async (request, reply) => {
      try {
        const bytes = buildTicketEscPos(request.body);
        await options.transport.print(bytes);
        reply.send({ success: true });
      } catch (err) {
        reply.status(500).send({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  return app;
}
