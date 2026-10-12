/**
 * Admin REST API contract this app is built against. The real routes are
 * implemented server-side in `apps/core-service` (a parallel, not-yet-merged
 * effort) — see `docs/plans/2026-10-10-phase6-admin-ui-frontend-plan.md` for
 * the full contract write-up. Field names deliberately mirror
 * `apps/core-service/src/db/schema.ts` so wiring up the real backend later
 * is a rename-free integration.
 */

export const TICKET_STATUSES = ['OPEN', 'CLOSED', 'ANOMALY'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const RAW_EVENT_SOURCES = ['camera_entrance', 'camera_exit', 'scale'] as const;
export type RawEventSource = (typeof RAW_EVENT_SOURCES)[number];

export interface Ticket {
  id: number;
  ticketNumber: number;
  plate: string;
  status: TicketStatus;

  entryAt: string | null;
  entryWeightKg: number | null;
  entryCameraId: string | null;
  entryCaptureFailed: boolean;

  exitAt: string | null;
  exitWeightKg: number | null;
  exitCameraId: string | null;
  exitCaptureFailed: boolean;

  netWeightKg: number | null;
  printedAt: string | null;
  createdByAdmin: boolean;
  notes: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: number;
  ticketId: number;
  actor: string;
  action: string;
  payload: unknown;
  createdAt: string;
}

export interface RawEvent {
  id: number;
  source: RawEventSource;
  rawPayload: unknown;
  receivedAt: string;
  linkedTicketId: number | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TicketListQuery {
  status?: TicketStatus;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface TicketDetail {
  ticket: Ticket;
  auditLog: AuditLogEntry[];
}

export interface CreateTicketPayload {
  plate: string;
  entryAt: string;
  entryWeightKg: number;
  reason: string;
}

export interface EditEntryPayload {
  entryAt: string;
  entryWeightKg: number;
  cameraId?: string;
  reason: string;
}

export interface EditExitPayload {
  exitAt: string;
  exitWeightKg: number;
  cameraId?: string;
  reason: string;
}

export interface ReprintPayload {
  reason?: string;
}

export interface HardwareComponentStatus {
  reachable: boolean;
  lastSeenAt: string | null;
}

export interface HardwareStatus {
  cameraEntrance: HardwareComponentStatus;
  cameraExit: HardwareComponentStatus;
  scale: HardwareComponentStatus;
  printBridge: HardwareComponentStatus;
  relay: HardwareComponentStatus;
}

export interface CurrentUser {
  username: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}
