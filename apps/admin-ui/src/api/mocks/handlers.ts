import { http, HttpResponse } from 'msw';
import type {
  AssignConjuntoPayload,
  ChangePasswordPayload,
  Conjunto,
  CreateConjuntoPayload,
  CreateTicketPayload,
  CreateTruckPayload,
  CreateUserPayload,
  CurrentUser,
  EditEntryPayload,
  EditExitPayload,
  EditTruckPlatePayload,
  LoginPayload,
  ReprintPayload,
  ResetPasswordPayload,
  Ticket,
  TruckConjunto,
  UpdateUserPayload,
  User,
} from '../types';
import {
  allocateAuditLogId,
  allocateConjuntoId,
  allocateTicketId,
  allocateTicketNumber,
  allocateTruckAuditLogId,
  allocateTruckConjuntoId,
  allocateTruckId,
  allocateUserId,
  store,
  type MockUser,
} from './fixtures';

const BASE = '/api/admin';

function unauthorized() {
  return HttpResponse.text('Unauthorized', { status: 401 });
}

function notFound(message: string) {
  return HttpResponse.text(message, { status: 404 });
}

/** The session's user, re-read on every request (like the real backend) so deactivation applies immediately. */
function sessionUser(): MockUser | null {
  const user = store.users.find((u) => u.id === store.sessionUserId);
  return user && user.active ? user : null;
}

function requireAuth(): boolean {
  const user = sessionUser();
  return user !== null && !user.mustChangePassword;
}

function currentUsername(): string {
  return sessionUser()?.username ?? 'admin';
}

/** Real backend answers 401 without a session and 403 for a non-admin; mirrored here for the users routes. */
function adminGuard() {
  if (!requireAuth()) return unauthorized();
  if (sessionUser()!.role !== 'admin') return HttpResponse.text('admin_required', { status: 403 });
  return null;
}

function toCurrentUser(user: MockUser): CurrentUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

function toUser(user: MockUser): User {
  return {
    ...toCurrentUser(user),
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function userError(code: string, status: number) {
  return HttpResponse.text(code, { status });
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
    const user = store.users.find((u) => u.username === body.username);
    if (!user || !user.active || user.password !== body.password) {
      return unauthorized();
    }
    store.sessionUserId = user.id;
    return HttpResponse.json(toCurrentUser(user));
  }),

  http.post(`${BASE}/auth/logout`, () => {
    store.sessionUserId = null;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE}/auth/me`, () => {
    const user = sessionUser();
    if (!user) return unauthorized();
    return HttpResponse.json(toCurrentUser(user));
  }),

  http.post(`${BASE}/auth/change-password`, async ({ request }) => {
    const user = sessionUser();
    if (!user) return unauthorized();
    const body = (await request.json()) as ChangePasswordPayload;
    if (body.currentPassword !== user.password) return userError('wrong_current_password', 400);
    if (body.newPassword === user.password) return userError('same_password', 400);
    user.password = body.newPassword;
    user.mustChangePassword = false;
    user.updatedAt = new Date().toISOString();
    return HttpResponse.json(toCurrentUser(user));
  }),

  http.get(`${BASE}/users`, () => {
    const denied = adminGuard();
    if (denied) return denied;
    return HttpResponse.json(
      [...store.users].sort((a, b) => a.name.localeCompare(b.name)).map(toUser),
    );
  }),

  http.post(`${BASE}/users`, async ({ request }) => {
    const denied = adminGuard();
    if (denied) return denied;
    const body = (await request.json()) as CreateUserPayload;
    if (store.users.some((u) => u.username === body.username))
      return userError('username_taken', 409);
    const now = new Date().toISOString();
    const user: MockUser = {
      id: allocateUserId(),
      username: body.username,
      name: body.name.trim(),
      role: body.role,
      password: body.password,
      active: true,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
    return HttpResponse.json({ user: toUser(user) }, { status: 201 });
  }),

  http.patch(`${BASE}/users/:id`, async ({ params, request }) => {
    const denied = adminGuard();
    if (denied) return denied;
    const user = store.users.find((u) => u.id === Number(params.id));
    if (!user) return notFound(`User ${params.id} not found`);
    const body = (await request.json()) as UpdateUserPayload;
    if (body.role !== user.role && user.id === store.sessionUserId)
      return userError('cannot_change_own_role', 400);
    user.name = body.name.trim();
    user.role = body.role;
    user.updatedAt = new Date().toISOString();
    return HttpResponse.json({ user: toUser(user) });
  }),

  http.post(`${BASE}/users/:id/reset-password`, async ({ params, request }) => {
    const denied = adminGuard();
    if (denied) return denied;
    const user = store.users.find((u) => u.id === Number(params.id));
    if (!user) return notFound(`User ${params.id} not found`);
    if (user.id === store.sessionUserId) return userError('cannot_reset_own_password', 400);
    const body = (await request.json()) as ResetPasswordPayload;
    user.password = body.password;
    user.mustChangePassword = true;
    user.updatedAt = new Date().toISOString();
    return HttpResponse.json({ user: toUser(user) });
  }),

  http.post(`${BASE}/users/:id/:action`, ({ params }) => {
    const denied = adminGuard();
    if (denied) return denied;
    if (params.action !== 'activate' && params.action !== 'deactivate')
      return notFound('Unknown action');
    const user = store.users.find((u) => u.id === Number(params.id));
    if (!user) return notFound(`User ${params.id} not found`);
    if (params.action === 'deactivate' && user.id === store.sessionUserId) {
      return userError('cannot_deactivate_self', 400);
    }
    user.active = params.action === 'activate';
    user.updatedAt = new Date().toISOString();
    return HttpResponse.json({ user: toUser(user) });
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
      reweighOfTicketId: null,
      reweighedByTicketId: null,
      notes: body.reason,
      createdAt: now,
      updatedAt: now,
    };
    store.tickets.push(ticket);
    appendAudit(ticket.id, currentUsername(), 'manual_create', {
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

    appendAudit(ticket.id, currentUsername(), 'manual_edit', {
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

    appendAudit(ticket.id, currentUsername(), 'manual_edit', {
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
    appendAudit(ticket.id, currentUsername(), 'reprint', {
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
    const plate = body.plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (store.trucks.some((t) => t.plate === plate)) {
      return HttpResponse.text('Another truck already uses this plate', { status: 409 });
    }
    const now = new Date().toISOString();
    const truck = {
      id: allocateTruckId(),
      plate,
      label: body.label ?? null,
      createdAt: now,
      updatedAt: now,
      conjuntos: [],
    };
    store.trucks.push(truck);
    store.truckAuditLog.push({
      id: allocateTruckAuditLogId(),
      truckId: truck.id,
      actor: currentUsername(),
      action: 'truck_created',
      payload: { plate: truck.plate, label: truck.label },
      createdAt: now,
    });
    return HttpResponse.json({ truck }, { status: 201 });
  }),

  http.patch(`${BASE}/trucks/:id/plate`, async ({ params, request }) => {
    if (!requireAuth()) return unauthorized();
    const id = Number(params.id);
    const truck = store.trucks.find((t) => t.id === id);
    if (!truck) return notFound(`Truck ${id} not found`);
    const body = (await request.json()) as EditTruckPlatePayload;
    const plate = body.plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (store.trucks.some((t) => t.plate === plate && t.id !== id)) {
      return HttpResponse.text('Another truck already uses this plate', { status: 409 });
    }
    const now = new Date().toISOString();
    const before = truck.plate;
    truck.plate = plate;
    truck.updatedAt = now;
    store.truckAuditLog.push({
      id: allocateTruckAuditLogId(),
      truckId: id,
      actor: currentUsername(),
      action: 'plate_edited',
      payload: { reason: body.reason, before: { plate: before }, after: { plate } },
      createdAt: now,
    });
    return HttpResponse.json({ truck });
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
      actor: currentUsername(),
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
      actor: currentUsername(),
      action: 'conjunto_activated',
      payload: { truckConjuntoId: target.id, conjuntoName: target.conjuntoName, tareWeightKg: target.tareWeightKg },
      createdAt: now,
    });
    return HttpResponse.json({ truck });
  }),
];
