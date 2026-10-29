import { http, HttpResponse } from 'msw';
import type {
  AssignConjuntoPayload,
  Conjunto,
  CreateConjuntoPayload,
  CreateTicketPayload,
  CreateTruckPayload,
  EditEntryPayload,
  EditExitPayload,
  LoginPayload,
  ReprintPayload,
  Ticket,
  TruckConjunto,
} from '../types';
import {
  allocateAuditLogId,
  allocateConjuntoId,
  allocateTicketId,
  allocateTicketNumber,
  allocateTruckAuditLogId,
  allocateTruckConjuntoId,
  allocateTruckId,
  MOCK_CREDENTIALS,
  store,
} from './fixtures';

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

  http.get(`${BASE}/trucks`, () => {
    if (!requireAuth()) return unauthorized();
    return HttpResponse.json(store.trucks);
  }),

  http.get(`${BASE}/trucks/:id`, ({ params }) => {
    if (!requireAuth()) return unauthorized();
    const id = Number(params.id);
    const truck = store.trucks.find((t) => t.id === id);
    if (!truck) return notFound(`Truck ${id} not found`);
    const auditLog = store.truckAuditLog.filter((a) => a.truckId === id).sort((a, b) => b.id - a.id);
    return HttpResponse.json({ truck, auditLog });
  }),

  http.post(`${BASE}/trucks`, async ({ request }) => {
    if (!requireAuth()) return unauthorized();
    const body = (await request.json()) as CreateTruckPayload;
    const now = new Date().toISOString();
    const truck = {
      id: allocateTruckId(),
      plate: body.plate.toUpperCase(),
      label: body.label ?? null,
      createdAt: now,
      updatedAt: now,
      conjuntos: [],
    };
    store.trucks.push(truck);
    store.truckAuditLog.push({
      id: allocateTruckAuditLogId(),
      truckId: truck.id,
      actor: store.session?.username ?? 'admin',
      action: 'truck_created',
      payload: { plate: truck.plate, label: truck.label },
      createdAt: now,
    });
    return HttpResponse.json({ truck }, { status: 201 });
  }),

  http.get(`${BASE}/conjuntos`, () => {
    if (!requireAuth()) return unauthorized();
    return HttpResponse.json(store.conjuntos);
  }),

  http.post(`${BASE}/conjuntos`, async ({ request }) => {
    if (!requireAuth()) return unauthorized();
    const body = (await request.json()) as CreateConjuntoPayload;
    if (store.conjuntos.some((c) => c.name === body.name)) {
      return HttpResponse.text('A conjunto with this name already exists', { status: 409 });
    }
    const now = new Date().toISOString();
    const conjunto: Conjunto = { id: allocateConjuntoId(), name: body.name, createdAt: now, updatedAt: now };
    store.conjuntos.push(conjunto);
    return HttpResponse.json({ conjunto }, { status: 201 });
  }),

  http.post(`${BASE}/trucks/:id/conjuntos`, async ({ params, request }) => {
    if (!requireAuth()) return unauthorized();
    const truckId = Number(params.id);
    const truck = store.trucks.find((t) => t.id === truckId);
    if (!truck) return notFound(`Truck ${truckId} not found`);
    const body = (await request.json()) as AssignConjuntoPayload;
    if (!body.conjuntoId && !body.conjuntoName) {
      return HttpResponse.text('Either conjuntoId or conjuntoName is required', { status: 400 });
    }
    const now = new Date().toISOString();

    let conjunto = body.conjuntoId
      ? store.conjuntos.find((c) => c.id === body.conjuntoId)
      : store.conjuntos.find((c) => c.name === body.conjuntoName);
    if (!conjunto && body.conjuntoName) {
      conjunto = { id: allocateConjuntoId(), name: body.conjuntoName, createdAt: now, updatedAt: now };
      store.conjuntos.push(conjunto);
    }
    if (!conjunto) return notFound(`Conjunto ${body.conjuntoId} not found`);

    const assignment: TruckConjunto = {
      id: allocateTruckConjuntoId(),
      truckId,
      conjuntoId: conjunto.id,
      conjuntoName: conjunto.name,
      tareWeightKg: body.tareWeightKg,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    };
    truck.conjuntos.push(assignment);
    store.truckAuditLog.push({
      id: allocateTruckAuditLogId(),
      truckId,
      actor: store.session?.username ?? 'admin',
      action: 'conjunto_assigned',
      payload: { truckConjuntoId: assignment.id, conjuntoName: conjunto.name, tareWeightKg: assignment.tareWeightKg },
      createdAt: now,
    });
    return HttpResponse.json({ truck }, { status: 201 });
  }),

  http.post(`${BASE}/truck-conjuntos/:id/activate`, ({ params }) => {
    if (!requireAuth()) return unauthorized();
    const assignmentId = Number(params.id);
    const truck = store.trucks.find((t) => t.conjuntos.some((a) => a.id === assignmentId));
    if (!truck) return notFound(`Truck conjunto assignment ${assignmentId} not found`);

    const now = new Date().toISOString();
    const target = truck.conjuntos.find((a) => a.id === assignmentId)!;
    for (const assignment of truck.conjuntos) {
      assignment.isActive = assignment.id === assignmentId;
      assignment.updatedAt = now;
    }
    store.truckAuditLog.push({
      id: allocateTruckAuditLogId(),
      truckId: truck.id,
      actor: store.session?.username ?? 'admin',
      action: 'conjunto_activated',
      payload: { truckConjuntoId: target.id, conjuntoName: target.conjuntoName, tareWeightKg: target.tareWeightKg },
      createdAt: now,
    });
    return HttpResponse.json({ truck });
  }),
];
