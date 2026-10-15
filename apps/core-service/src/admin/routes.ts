import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DriverSignalAdapter } from '../driver-signal/types.js';
import type { PrintClient } from '../printing/print-client.js';
import type { PrintService } from '../printing/print-service.js';
import type { ScaleClient } from '../scale/types.js';
import type { TicketRepository } from '../tickets/repository.js';
import { createAdminAuthService } from './auth-service.js';
import { getHardwareStatus } from './hardware-status.js';
import {
  createTicketBodySchema,
  editEntryBodySchema,
  editExitBodySchema,
  listTicketsQuerySchema,
  listUnresolvedEventsQuerySchema,
  loginBodySchema,
  reprintBodySchema,
  ticketIdParamsSchema,
  type CreateTicketBody,
  type EditEntryBody,
  type EditExitBody,
  type ListTicketsQuery,
  type ListUnresolvedEventsQuery,
  type LoginBody,
  type ReprintBody,
  type TicketIdParams,
} from './schemas.js';
import { serializeAuditLogEntry, serializeRawEvent, serializeTicket } from './serialize.js';
import './session.js';

export interface AdminRoutesOptions {
  repo: TicketRepository;
  printService: PrintService;
  scaleClient: ScaleClient;
  driverSignalAdapter: DriverSignalAdapter;
  printClient: PrintClient;
  /** Must be at least 32 characters (enforced by `admin/config.ts`'s `loadAdminConfig`). */
  sessionSecret: string;
}

const AUDIT_ACTIONS = {
  TICKET_CREATED: 'ticket_created_by_admin',
  ENTRY_EDITED: 'entry_edited',
  EXIT_EDITED: 'exit_edited',
  REPRINT_REQUESTED: 'reprint_requested',
} as const;

/**
 * Admin API for the Admin UI (master plan §3.4, §9 Phase 6). Mounted under
 * `/api/admin`; the exact contract is documented in
 * `docs/plans/2026-10-13-phase6-admin-backend-api-plan.md` and mirrors
 * `apps/admin-ui/src/api/types.ts` field-for-field. Session/cookie plugins
 * are registered only inside this encapsulated context, so the camera
 * webhook and print-bridge routes stay untouched by them.
 */
export function registerAdminRoutes(app: FastifyInstance, options: AdminRoutesOptions): void {
  app.register(
    async (instance) => {
      await instance.register(fastifyCookie);
      await instance.register(fastifySession, {
        secret: options.sessionSecret,
        // Plain HTTP on a closed LAN (master plan §3.4/§7) — no TLS to require `secure` cookies for.
        cookie: { secure: false, httpOnly: true, sameSite: 'lax' },
      });

      const authService = createAdminAuthService(options.repo);

      async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
        if (!request.session.adminUsername) {
          reply.code(401).send('Not authenticated');
        }
      }

      // --- Auth ---

      instance.post<{ Body: LoginBody }>(
        '/auth/login',
        { schema: { body: loginBodySchema } },
        async (request, reply) => {
          const username = authService.verifyCredentials(request.body.username, request.body.password);
          if (!username) {
            reply.code(401).send('Invalid credentials');
            return;
          }
          request.session.adminUsername = username;
          reply.send({ username });
        },
      );

      instance.post('/auth/logout', async (request, reply) => {
        await request.session.destroy();
        reply.code(204).send();
      });

      instance.get('/auth/me', async (request, reply) => {
        if (!request.session.adminUsername) {
          reply.code(401).send('Not authenticated');
          return;
        }
        reply.send({ username: request.session.adminUsername });
      });

      // --- Tickets ---

      instance.get<{ Querystring: ListTicketsQuery }>(
        '/tickets',
        { schema: { querystring: listTicketsQuerySchema }, preHandler: requireAuth },
        async (request, reply) => {
          const { status, search, from, to, page, pageSize } = request.query;
          const result = options.repo.listTickets({
            status,
            search,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
            page,
            pageSize,
          });
          reply.send({
            items: result.items.map(serializeTicket),
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
          });
        },
      );

      instance.get<{ Params: TicketIdParams }>(
        '/tickets/:id',
        { schema: { params: ticketIdParamsSchema }, preHandler: requireAuth },
        async (request, reply) => {
          const ticketId = Number(request.params.id);
          const ticket = options.repo.findById(ticketId);
          if (!ticket) {
            reply.code(404).send('Ticket not found');
            return;
          }
          const auditLog = options.repo.findAuditLogByTicketId(ticketId);
          reply.send({ ticket: serializeTicket(ticket), auditLog: auditLog.map(serializeAuditLogEntry) });
        },
      );

      instance.post<{ Body: CreateTicketBody }>(
        '/tickets',
        { schema: { body: createTicketBodySchema }, preHandler: requireAuth },
        async (request, reply) => {
          const { plate, entryAt, entryWeightKg, reason } = request.body;
          const actor = request.session.adminUsername!;

          const ticket = options.repo.transaction(() => {
            const created = options.repo.create({
              plate,
              entryAt: new Date(entryAt),
              entryWeightKg,
              entryCameraId: null,
              entryCaptureFailed: false,
              createdByAdmin: true,
            });
            options.repo.appendAuditLog(created.id, actor, AUDIT_ACTIONS.TICKET_CREATED, {
              reason,
              plate,
              entryAt,
              entryWeightKg,
            });
            return created;
          });

          reply.code(201).send({ ticket: serializeTicket(ticket) });
        },
      );

      instance.patch<{ Params: TicketIdParams; Body: EditEntryBody }>(
        '/tickets/:id/entry',
        { schema: { params: ticketIdParamsSchema, body: editEntryBodySchema }, preHandler: requireAuth },
        async (request, reply) => {
          const ticketId = Number(request.params.id);
          const existing = options.repo.findById(ticketId);
          if (!existing) {
            reply.code(404).send('Ticket not found');
            return;
          }
          if (existing.status !== 'OPEN') {
            reply.code(409).send('Ticket is not OPEN');
            return;
          }

          const { entryAt, entryWeightKg, cameraId, reason } = request.body;
          const actor = request.session.adminUsername!;

          const updated = options.repo.transaction(() => {
            const result = options.repo.updateEntry(ticketId, {
              entryAt: new Date(entryAt),
              entryWeightKg,
              entryCameraId: cameraId ?? existing.entryCameraId,
              entryCaptureFailed: false,
            });
            options.repo.appendAuditLog(ticketId, actor, AUDIT_ACTIONS.ENTRY_EDITED, {
              reason,
              before: { entryAt: existing.entryAt, entryWeightKg: existing.entryWeightKg },
              after: { entryAt, entryWeightKg },
            });
            return result;
          });

          reply.send({ ticket: serializeTicket(updated) });
        },
      );

      instance.patch<{ Params: TicketIdParams; Body: EditExitBody }>(
        '/tickets/:id/exit',
        { schema: { params: ticketIdParamsSchema, body: editExitBodySchema }, preHandler: requireAuth },
        async (request, reply) => {
          const ticketId = Number(request.params.id);
          const existing = options.repo.findById(ticketId);
          if (!existing) {
            reply.code(404).send('Ticket not found');
            return;
          }
          // ANOMALY tickets are missing entry data, not exit data — the documented
          // correction path is creating a new ticket (Admin UI's "unresolved events"
          // view pre-fills POST /tickets from one), not editing this ticket's exit.
          if (existing.status === 'ANOMALY') {
            reply.code(409).send('Cannot edit exit data on an ANOMALY ticket; create a new ticket instead');
            return;
          }

          const { exitAt, exitWeightKg, cameraId, reason } = request.body;
          const actor = request.session.adminUsername!;
          const exitInput = {
            exitAt: new Date(exitAt),
            exitWeightKg,
            exitCameraId: cameraId ?? existing.exitCameraId,
            exitCaptureFailed: false,
          };

          const updated = options.repo.transaction(() => {
            const result =
              existing.status === 'OPEN'
                ? options.repo.close(ticketId, exitInput)
                : options.repo.correctExit(ticketId, exitInput);
            options.repo.appendAuditLog(ticketId, actor, AUDIT_ACTIONS.EXIT_EDITED, {
              reason,
              before: { exitAt: existing.exitAt, exitWeightKg: existing.exitWeightKg },
              after: { exitAt, exitWeightKg },
            });
            return result;
          });

          // No-op if already printed (e.g. the correction-on-a-CLOSED-ticket path) —
          // single-print guarantee from master plan §5, enforced by printIfNeeded itself.
          await options.printService.printIfNeeded(updated);

          reply.send({ ticket: serializeTicket(options.repo.findById(ticketId)!) });
        },
      );

      instance.post<{ Params: TicketIdParams; Body: ReprintBody }>(
        '/tickets/:id/reprint',
        { schema: { params: ticketIdParamsSchema, body: reprintBodySchema }, preHandler: requireAuth },
        async (request, reply) => {
          const ticketId = Number(request.params.id);
          const existing = options.repo.findById(ticketId);
          if (!existing) {
            reply.code(404).send('Ticket not found');
            return;
          }
          if (existing.status !== 'CLOSED') {
            reply.code(409).send('Ticket is not CLOSED');
            return;
          }

          if (request.body.reason) {
            options.repo.appendAuditLog(ticketId, request.session.adminUsername!, AUDIT_ACTIONS.REPRINT_REQUESTED, {
              reason: request.body.reason,
            });
          }

          const result = await options.printService.reprint(ticketId);
          if (!result.success) {
            reply.code(502).send(result.error ?? 'Print failed');
            return;
          }

          reply.code(202).send({ ticket: serializeTicket(options.repo.findById(ticketId)!) });
        },
      );

      // --- Unresolved events ---

      instance.get<{ Querystring: ListUnresolvedEventsQuery }>(
        '/unresolved-events',
        { schema: { querystring: listUnresolvedEventsQuerySchema }, preHandler: requireAuth },
        async (request, reply) => {
          const result = options.repo.listUnresolvedEvents(request.query);
          reply.send({
            items: result.items.map(serializeRawEvent),
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
          });
        },
      );

      // --- Hardware status ---

      instance.get('/status', { preHandler: requireAuth }, async (_request, reply) => {
        const status = await getHardwareStatus({
          repo: options.repo,
          scaleClient: options.scaleClient,
          driverSignalAdapter: options.driverSignalAdapter,
          printClient: options.printClient,
        });
        reply.send(status);
      });
    },
    { prefix: '/api/admin' },
  );
}
