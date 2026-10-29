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

/**
 * Internal trucks / conjuntos (master plan §11): a company-owned truck with
 * a pre-registered tare. A camera read for a registered plate closes a
 * ticket from a single event, using the active conjunto assignment's tare
 * for the leg that didn't fire.
 *
 * A conjunto is a shared rig/trailer type (e.g. "Vanderleia", "Bitrem
 * Bicaçamba") — the same conjunto can be assigned to many trucks, each with
 * its own tare, confirmed against the company's real paper registry.
 */
export interface Conjunto {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** One (truck, conjunto) assignment, carrying that pair's tare. */
export interface TruckConjunto {
  id: number;
  truckId: number;
  conjuntoId: number;
  conjuntoName: string;
  tareWeightKg: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Truck {
  id: number;
  plate: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  conjuntos: TruckConjunto[];
}

export interface TruckAuditLogEntry {
  id: number;
  truckId: number;
  actor: string;
  action: string;
  payload: unknown;
  createdAt: string;
}

export interface TruckDetail {
  truck: Truck;
  auditLog: TruckAuditLogEntry[];
}

export interface CreateTruckPayload {
  plate: string;
  label?: string;
}

export interface CreateConjuntoPayload {
  name: string;
}

/** Either `conjuntoId` (assign an existing conjunto) or `conjuntoName` (create one inline) must be set. */
export interface AssignConjuntoPayload {
  conjuntoId?: number;
  conjuntoName?: string;
  tareWeightKg: number;
}

export interface LoginPayload {
  username: string;
  password: string;
}
