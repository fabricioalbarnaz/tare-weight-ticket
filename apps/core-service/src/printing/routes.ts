import type { FastifyInstance } from 'fastify';
import type { PrintService } from './print-service.js';

export interface PrintRoutesOptions {
  printService: PrintService;
}

const reprintParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[0-9]+$' },
  },
  required: ['id'],
} as const;

/**
 * Manual reprint support (master plan §9 Phase 5), exposed ahead of the
 * Phase 6 Admin UI that will call it from a button. Business-level
 * outcomes (ticket not found, not CLOSED yet, print bridge failure) are
 * reported via the response body as 200s, matching the camera webhook
 * routes' convention — only a malformed request is an HTTP error.
 */
export function registerPrintRoutes(app: FastifyInstance, options: PrintRoutesOptions): void {
  app.post<{ Params: { id: string } }>(
    '/tickets/:id/reprint',
    { schema: { params: reprintParamsSchema } },
    async (request, reply) => {
      const ticketId = Number(request.params.id);
      const result = await options.printService.reprint(ticketId);

      reply.send(result);
    },
  );
}
