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
