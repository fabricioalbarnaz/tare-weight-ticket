import type { RawEvent, Ticket, TicketAuditLogEntry } from '../tickets/repository.js';
import type { Conjunto, InternalTruck, TruckAuditLogEntry, TruckConjuntoWithName } from '../trucks/repository.js';

/**
 * Wire shapes for the Admin API, matching `apps/admin-ui/src/api/types.ts`
 * field-for-field (ISO date strings over JSON instead of `Date`/nullable
 * Dates). That frontend file is the contract's source of truth.
 */

export interface SerializedTicket {
  id: number;
  ticketNumber: number;
  plate: string;
  status: Ticket['status'];
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

export interface SerializedAuditLogEntry {
  id: number;
  ticketId: number;
  actor: string;
  action: string;
  payload: unknown;
  createdAt: string;
}

export interface SerializedRawEvent {
  id: number;
  source: RawEvent['source'];
  rawPayload: unknown;
  receivedAt: string;
  linkedTicketId: number | null;
}

export function serializeTicket(ticket: Ticket): SerializedTicket {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    plate: ticket.plate,
    status: ticket.status,
    entryAt: ticket.entryAt ? ticket.entryAt.toISOString() : null,
    entryWeightKg: ticket.entryWeightKg,
    entryCameraId: ticket.entryCameraId,
    entryCaptureFailed: ticket.entryCaptureFailed,
    exitAt: ticket.exitAt ? ticket.exitAt.toISOString() : null,
    exitWeightKg: ticket.exitWeightKg,
    exitCameraId: ticket.exitCameraId,
    exitCaptureFailed: ticket.exitCaptureFailed,
    netWeightKg: ticket.netWeightKg,
    printedAt: ticket.printedAt ? ticket.printedAt.toISOString() : null,
    createdByAdmin: ticket.createdByAdmin,
    notes: ticket.notes,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

export function serializeAuditLogEntry(entry: TicketAuditLogEntry): SerializedAuditLogEntry {
  return {
    id: entry.id,
    ticketId: entry.ticketId,
    actor: entry.actor,
    action: entry.action,
    payload: entry.payload ? JSON.parse(entry.payload) : null,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function serializeRawEvent(event: RawEvent): SerializedRawEvent {
  return {
    id: event.id,
    source: event.source,
    rawPayload: JSON.parse(event.rawPayload),
    receivedAt: event.receivedAt.toISOString(),
    linkedTicketId: event.linkedTicketId,
  };
}

export interface SerializedConjunto {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedTruckConjunto {
  id: number;
  truckId: number;
  conjuntoId: number;
  conjuntoName: string;
  tareWeightKg: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedTruck {
  id: number;
  plate: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  conjuntos: SerializedTruckConjunto[];
}

export interface SerializedTruckAuditLogEntry {
  id: number;
  truckId: number;
  actor: string;
  action: string;
  payload: unknown;
  createdAt: string;
}

export function serializeConjunto(conjunto: Conjunto): SerializedConjunto {
  return {
    id: conjunto.id,
    name: conjunto.name,
    createdAt: conjunto.createdAt.toISOString(),
    updatedAt: conjunto.updatedAt.toISOString(),
  };
}

export function serializeTruckConjunto(assignment: TruckConjuntoWithName): SerializedTruckConjunto {
  return {
    id: assignment.id,
    truckId: assignment.truckId,
    conjuntoId: assignment.conjuntoId,
    conjuntoName: assignment.conjuntoName,
    tareWeightKg: assignment.tareWeightKg,
    isActive: assignment.isActive,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

export function serializeTruck(truck: InternalTruck, assignments: TruckConjuntoWithName[]): SerializedTruck {
  return {
    id: truck.id,
    plate: truck.plate,
    label: truck.label,
    createdAt: truck.createdAt.toISOString(),
    updatedAt: truck.updatedAt.toISOString(),
    conjuntos: assignments.map(serializeTruckConjunto),
  };
}

export function serializeTruckAuditLogEntry(entry: TruckAuditLogEntry): SerializedTruckAuditLogEntry {
  return {
    id: entry.id,
    truckId: entry.truckId,
    actor: entry.actor,
    action: entry.action,
    payload: entry.payload ? JSON.parse(entry.payload) : null,
    createdAt: entry.createdAt.toISOString(),
  };
}
