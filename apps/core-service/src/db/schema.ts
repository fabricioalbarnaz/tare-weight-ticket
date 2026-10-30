import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const TICKET_STATUSES = ['OPEN', 'CLOSED', 'ANOMALY'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const RAW_EVENT_SOURCES = ['camera_entrance', 'camera_exit', 'scale'] as const;
export type RawEventSource = (typeof RAW_EVENT_SOURCES)[number];

export const tickets = sqliteTable('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketNumber: integer('ticket_number').notNull().unique(),
  plate: text('plate').notNull(),
  status: text('status', { enum: TICKET_STATUSES }).notNull().default('OPEN'),

  entryAt: integer('entry_at', { mode: 'timestamp_ms' }),
  entryWeightKg: real('entry_weight_kg'),
  entryCameraId: text('entry_camera_id'),
  entryCaptureFailed: integer('entry_capture_failed', { mode: 'boolean' }).notNull().default(false),

  exitAt: integer('exit_at', { mode: 'timestamp_ms' }),
  exitWeightKg: real('exit_weight_kg'),
  exitCameraId: text('exit_camera_id'),
  exitCaptureFailed: integer('exit_capture_failed', { mode: 'boolean' }).notNull().default(false),

  netWeightKg: real('net_weight_kg'),
  printedAt: integer('printed_at', { mode: 'timestamp_ms' }),
  createdByAdmin: integer('created_by_admin', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),

  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const ticketAuditLog = sqliteTable('ticket_audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: integer('ticket_id')
    .notNull()
    .references(() => tickets.id),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  payload: text('payload'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const rawEvents = sqliteTable('raw_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source', { enum: RAW_EVENT_SOURCES }).notNull(),
  rawPayload: text('raw_payload').notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
  linkedTicketId: integer('linked_ticket_id').references(() => tickets.id),
});

export const adminUsers = sqliteTable('admin_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Company-owned trucks with a pre-registered tare. See master plan §11
 * (internal trucks / conjuntos feature): a camera read for a registered
 * plate here closes a ticket from a single camera event, filling the leg
 * that didn't fire from the truck's active `truckConjuntos` row's
 * `tareWeightKg`.
 */
export const internalTrucks = sqliteTable('internal_trucks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  plate: text('plate').notNull().unique(),
  label: text('label'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * A "conjunto": a shared rig/trailer type (e.g. "Vanderleia", "Bitrem
 * Bicaçamba") that many trucks can be assigned to — see `truckConjuntos`
 * for the per-truck assignment and tare. Confirmed against the company's
 * real paper registry (master plan §11): the same conjunto is reused
 * across many plates, each with its own tare.
 */
export const conjuntos = sqliteTable('conjuntos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * The many-to-many assignment of a conjunto to a truck, carrying the tare
 * specific to that (truck, conjunto) pair — the same conjunto has a
 * different tare for each truck it's assigned to (different chassis
 * weight), confirmed from the real paper registry. Only one row per
 * `truckId` has `isActive: true` at a time — enforced by application
 * logic (`TruckRepository.activateTruckConjunto`), not a DB constraint,
 * matching this repo's existing style (see `tickets.status` guards in
 * `repository.ts`).
 */
export const truckConjuntos = sqliteTable('truck_conjuntos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  truckId: integer('truck_id')
    .notNull()
    .references(() => internalTrucks.id),
  conjuntoId: integer('conjunto_id')
    .notNull()
    .references(() => conjuntos.id),
  tareWeightKg: real('tare_weight_kg').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Audit trail for admin mutations on internal trucks/conjuntos, mirroring `ticketAuditLog`. */
export const truckAuditLog = sqliteTable('truck_audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  truckId: integer('truck_id')
    .notNull()
    .references(() => internalTrucks.id),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  payload: text('payload'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
