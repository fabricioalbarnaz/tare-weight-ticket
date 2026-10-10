import { http, HttpResponse } from 'msw';
import type {
  CreateTicketPayload,
  EditEntryPayload,
  EditExitPayload,
  LoginPayload,
  ReprintPayload,
  Ticket,
} from '../types';
import { allocateAuditLogId, allocateTicketId, allocateTicketNumber, MOCK_CREDENTIALS, store } from './fixtures';

const BASE = '/api/admin';

function unauthorized() {
  return HttpResponse.text('Unauthorized', { status: 401 });
}

function notFound(message: string) {
  return HttpResponse.text(message, { status: 404 });
}

function requireAuth(): boolean {
  return store.session !== null;
}

function appendAudit(ticketId: number, actor: string, action: string, payload: unknown) {
  store.auditLog.push({
    id: allocateAuditLogId(),
    ticketId,
    actor,
    action,
    payload,
    createdAt: new Date().toISOString(),
  });
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

export const handlers = [
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as LoginPayload;
    if (body.username !== MOCK_CREDENTIALS.username || body.password !== MOCK_CREDENTIALS.password) {
      return unauthorized();
    }
    store.session = { username: body.username };
    return HttpResponse.json({ username: body.username });
  }),

  http.post(`${BASE}/auth/logout`, () => {
    store.session = null;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE}/auth/me`, () => {
    if (!requireAuth()) return unauthorized();
    return HttpResponse.json(store.session);
  }),

  http.get(`${BASE}/tickets`, ({ request }) => {
    if (!requireAuth()) return unauthorized();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search')?.toUpperCase() ?? '';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');

    let items = [...store.tickets].sort((a, b) => b.id - a.id);
    if (status) items = items.filter((t) => t.status === status);
    if (search) items = items.filter((t) => t.plate.includes(search));
    if (from) items = items.filter((t) => t.createdAt >= from);
    if (to) items = items.filter((t) => t.createdAt <= to);

    return HttpResponse.json(paginate(items, page, pageSize));
  }),

  http.get(`${BASE}/tickets/:id`, ({ params }) => {
    if (!requireAuth()) return unauthorized();
    const id = Number(params.id);
    const ticket = store.tickets.find((t) => t.id === id);
    if (!ticket) return notFound(`Ticket ${id} not found`);
    const auditLog = store.auditLog
      .filter((a) => a.ticketId === id)
      .sort((a, b) => b.id - a.id);
    return HttpResponse.json({ ticket, auditLog });
  }),

  http.post(`${BASE}/tickets`, async ({ request }) => {
    if (!requireAuth()) return unauthorized();
    const body = (await request.json()) as CreateTicketPayload;
    const now = new Date().toISOString();
    const ticket: Ticket = {
      id: allocateTicketId(),
      ticketNumber: allocateTicketNumber(),
      plate: body.plate.toUpperCase(),
      status: 'OPEN',
      entryAt: body.entryAt,
      entryWeightKg: body.entryWeightKg,
      entryCameraId: null,
      entryCaptureFailed: false,
      exitAt: null,
      exitWeightKg: null,
      exitCameraId: null,
      exitCaptureFailed: false,
      netWeightKg: null,
      printedAt: null,
      createdByAdmin: true,
      notes: body.reason,
      createdAt: now,
      updatedAt: now,
    };
    store.tickets.push(ticket);
    appendAudit(ticket.id, store.session?.username ?? 'admin', 'manual_create', {
      reason: body.reason,
    });
    return HttpResponse.json({ ticket }, { status: 201 });
  }),

  http.patch(`${BASE}/tickets/:id/entry`, async ({ params, request }) => {
    if (!requireAuth()) return unauthorized();
    const id = Number(params.id);
    const ticket = store.tickets.find((t) => t.id === id);
    if (!ticket) return notFound(`Ticket ${id} not found`);
    const body = (await request.json()) as EditEntryPayload;

    ticket.entryAt = body.entryAt;
    ticket.entryWeightKg = body.entryWeightKg;
    ticket.entryCameraId = body.cameraId ?? ticket.entryCameraId;
    ticket.entryCaptureFailed = false;
    ticket.updatedAt = new Date().toISOString();
    if (ticket.exitWeightKg !== null) {
      ticket.netWeightKg = Math.abs(ticket.entryWeightKg - ticket.exitWeightKg);
    }

    appendAudit(ticket.id, store.session?.username ?? 'admin', 'manual_edit', {
      leg: 'entry',
      entryAt: body.entryAt,
      entryWeightKg: body.entryWeightKg,
      reason: body.reason,
    });

    return HttpResponse.json({ ticket });
  }),

  http.patch(`${BASE}/tickets/:id/exit`, async ({ params, request }) => {
    if (!requireAuth()) return unauthorized();
    const id = Number(params.id);
    const ticket = store.tickets.find((t) => t.id === id);
    if (!ticket) return notFound(`Ticket ${id} not found`);
    const body = (await request.json()) as EditExitPayload;

    ticket.exitAt = body.exitAt;
    ticket.exitWeightKg = body.exitWeightKg;
    ticket.exitCameraId = body.cameraId ?? ticket.exitCameraId;
    ticket.exitCaptureFailed = false;
    ticket.status = 'CLOSED';
    ticket.updatedAt = new Date().toISOString();
    if (ticket.entryWeightKg !== null) {
      ticket.netWeightKg = Math.abs(ticket.entryWeightKg - body.exitWeightKg);
    }

    appendAudit(ticket.id, store.session?.username ?? 'admin', 'manual_edit', {
      leg: 'exit',
      exitAt: body.exitAt,
      exitWeightKg: body.exitWeightKg,
      reason: body.reason,
    });

    return HttpResponse.json({ ticket });
  }),

  http.post(`${BASE}/tickets/:id/reprint`, async ({ params, request }) => {
    if (!requireAuth()) return unauthorized();
    const id = Number(params.id);
    const ticket = store.tickets.find((t) => t.id === id);
    if (!ticket) return notFound(`Ticket ${id} not found`);
    const body = (await request.json().catch(() => ({}))) as ReprintPayload;

    ticket.printedAt = new Date().toISOString();
    appendAudit(ticket.id, store.session?.username ?? 'admin', 'reprint', {
      reason: body.reason ?? null,
    });

    return HttpResponse.json({ ticket }, { status: 202 });
  }),

  http.get(`${BASE}/unresolved-events`, ({ request }) => {
    if (!requireAuth()) return unauthorized();
    const url = new URL(request.url);
    const source = url.searchParams.get('source');
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');

    let items = store.rawEvents.filter((e) => e.linkedTicketId === null);
    if (source) items = items.filter((e) => e.source === source);
    items = [...items].sort((a, b) => b.id - a.id);

    return HttpResponse.json(paginate(items, page, pageSize));
  }),

  http.get(`${BASE}/status`, () => {
    if (!requireAuth()) return unauthorized();
    return HttpResponse.json(store.status);
  }),
];
