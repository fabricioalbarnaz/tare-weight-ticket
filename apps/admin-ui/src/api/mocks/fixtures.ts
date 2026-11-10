import type {
  AuditLogEntry,
  Conjunto,
  HardwareStatus,
  RawEvent,
  Ticket,
  Truck,
  TruckAuditLogEntry,
  TruckConjunto,
  User,
} from '../types';

const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

export const MOCK_CREDENTIALS = { username: 'admin', password: 'admin123' };
export const MOCK_OPERATOR_CREDENTIALS = { username: 'operador', password: 'operador123' };
/** A user whose password was just set by an admin, so login lands on the forced change-password page. */
export const MOCK_PENDING_CREDENTIALS = { username: 'novo', password: 'temp123' };

/** A mock-only user row: the real API never returns passwords, but the mock login has to check one. */
export interface MockUser extends User {
  password: string;
}

let nextTicketId = 1;
let nextTicketNumber = 1001;
let nextAuditLogId = 1;
let nextRawEventId = 1;
let nextTruckId = 1;
let nextConjuntoId = 1;
let nextTruckConjuntoId = 1;
let nextTruckAuditLogId = 1;
let nextUserId = 1;

function makeTicket(partial: Partial<Ticket> & Pick<Ticket, 'plate' | 'status'>): Ticket {
  const now = new Date().toISOString();
  const ticket: Ticket = {
    id: nextTicketId++,
    ticketNumber: nextTicketNumber++,
    entryAt: null,
    entryWeightKg: null,
    entryCameraId: null,
    entryCaptureFailed: false,
    exitAt: null,
    exitWeightKg: null,
    exitCameraId: null,
    exitCaptureFailed: false,
    netWeightKg: null,
    printedAt: null,
    createdByAdmin: false,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
  return ticket;
}

function makeAuditEntry(ticketId: number, actor: string, action: string, payload: unknown): AuditLogEntry {
  return {
    id: nextAuditLogId++,
    ticketId,
    actor,
    action,
    payload,
    createdAt: new Date().toISOString(),
  };
}

function makeUser(
  partial: Pick<MockUser, 'username' | 'password' | 'name' | 'role'> & Partial<MockUser>,
): MockUser {
  const now = new Date().toISOString();
  return {
    id: nextUserId++,
    active: true,
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export interface FixtureStore {
  tickets: Ticket[];
  auditLog: AuditLogEntry[];
  rawEvents: RawEvent[];
  status: HardwareStatus;
  users: MockUser[];
  /** Id of the logged-in user, re-read from `users` on every request like the real backend does. */
  sessionUserId: number | null;
  trucks: Truck[];
  conjuntos: Conjunto[];
  truckAuditLog: TruckAuditLogEntry[];
}

function buildInitialStore(): FixtureStore {
  nextTicketId = 1;
  nextUserId = 1;
  nextTicketNumber = 1001;
  nextAuditLogId = 1;
  nextRawEventId = 1;
  nextTruckId = 1;
  nextConjuntoId = 1;
  nextTruckConjuntoId = 1;
  nextTruckAuditLogId = 1;

  const open = makeTicket({
    plate: 'ABC1234',
    status: 'OPEN',
    entryAt: hoursAgo(1),
    entryWeightKg: 12500,
    entryCameraId: 'cam-entrance-1',
  });

  const closed = makeTicket({
    plate: 'XYZ9876',
    status: 'CLOSED',
    entryAt: hoursAgo(3),
    entryWeightKg: 11800,
    entryCameraId: 'cam-entrance-1',
    exitAt: hoursAgo(2),
    exitWeightKg: 28400,
    exitCameraId: 'cam-exit-1',
    netWeightKg: 16600,
    printedAt: hoursAgo(2),
  });

  const anomaly = makeTicket({
    plate: 'QWE4455',
    status: 'ANOMALY',
    exitAt: hoursAgo(1.5),
    exitWeightKg: 9800,
    exitCameraId: 'cam-exit-1',
  });

  const needsAttention = makeTicket({
    plate: 'JKL7788',
    status: 'CLOSED',
    entryAt: hoursAgo(4),
    entryWeightKg: 13200,
    entryCameraId: 'cam-entrance-1',
    exitAt: hoursAgo(3.5),
    exitWeightKg: null,
    exitCameraId: 'cam-exit-1',
    exitCaptureFailed: true,
    netWeightKg: null,
  });

  const historical = makeTicket({
    plate: 'LMN0011',
    status: 'CLOSED',
    entryAt: hoursAgo(30),
    entryWeightKg: 10200,
    entryCameraId: 'cam-entrance-1',
    exitAt: hoursAgo(29),
    exitWeightKg: 24100,
    exitCameraId: 'cam-exit-1',
    netWeightKg: 13900,
    printedAt: hoursAgo(29),
  });

  // Mirrors the real backend's listTickets suspectWeight flag (see
  // docs/plans/2026-10-31-scale-weight-attribution-fix-plan.md) — a scale
  // read that only resolved on a retry, worth a human glance.
  const suspect = makeTicket({
    plate: 'SUS5566',
    status: 'CLOSED',
    entryAt: hoursAgo(5),
    entryWeightKg: 20940,
    entryCameraId: 'cam-entrance-1',
    exitAt: hoursAgo(4),
    exitWeightKg: 8000,
    exitCameraId: 'cam-exit-1',
    netWeightKg: 12940,
    printedAt: hoursAgo(4),
    suspectWeight: true,
  });

  const tickets = [open, closed, anomaly, needsAttention, historical, suspect];

  const auditLog: AuditLogEntry[] = [
    makeAuditEntry(open.id, 'system', 'entry_captured', {
      weightKg: open.entryWeightKg,
      cameraId: open.entryCameraId,
    }),
    makeAuditEntry(closed.id, 'system', 'entry_captured', {
      weightKg: closed.entryWeightKg,
      cameraId: closed.entryCameraId,
    }),
    makeAuditEntry(closed.id, 'system', 'exit_captured', {
      weightKg: closed.exitWeightKg,
      cameraId: closed.exitCameraId,
    }),
    makeAuditEntry(anomaly.id, 'system', 'anomaly_flagged', {
      weightKg: anomaly.exitWeightKg,
      cameraId: anomaly.exitCameraId,
    }),
    makeAuditEntry(needsAttention.id, 'system', 'entry_captured', {
      weightKg: needsAttention.entryWeightKg,
      cameraId: needsAttention.entryCameraId,
    }),
    makeAuditEntry(needsAttention.id, 'system', 'exit_capture_failed', {
      weightKg: null,
      cameraId: needsAttention.exitCameraId,
    }),
    makeAuditEntry(historical.id, 'system', 'entry_captured', {
      weightKg: historical.entryWeightKg,
      cameraId: historical.entryCameraId,
    }),
    makeAuditEntry(historical.id, 'system', 'exit_captured', {
      weightKg: historical.exitWeightKg,
      cameraId: historical.exitCameraId,
    }),
    makeAuditEntry(suspect.id, 'system', 'entry_captured', {
      weightKg: suspect.entryWeightKg,
      cameraId: suspect.entryCameraId,
      isRetrigger: false,
      attemptsUsed: 3,
    }),
    makeAuditEntry(suspect.id, 'system', 'exit_captured', {
      weightKg: suspect.exitWeightKg,
      cameraId: suspect.exitCameraId,
      attemptsUsed: 1,
    }),
  ];

  const rawEvents: RawEvent[] = [
    {
      id: nextRawEventId++,
      source: 'camera_entrance',
      rawPayload: { rawPlate: '', cameraId: 'cam-entrance-1', timestamp: hoursAgo(0.5) },
      receivedAt: hoursAgo(0.5),
      linkedTicketId: null,
    },
    {
      id: nextRawEventId++,
      source: 'camera_exit',
      rawPayload: { rawPlate: '#?!', cameraId: 'cam-exit-1', timestamp: hoursAgo(0.25) },
      receivedAt: hoursAgo(0.25),
      linkedTicketId: null,
    },
  ];

  const status: HardwareStatus = {
    cameraEntrance: { reachable: true, lastSeenAt: hoursAgo(0.02) },
    cameraExit: { reachable: true, lastSeenAt: hoursAgo(0.05) },
    scale: { reachable: true, lastSeenAt: hoursAgo(0.02) },
    printBridge: { reachable: true, lastSeenAt: hoursAgo(0.1) },
    relay: { reachable: false, lastSeenAt: hoursAgo(6) },
  };

  const now = new Date().toISOString();

  // Two shared conjunto types, mirroring the company's real paper registry:
  // "Vanderleia" is used by both trucks below, each with its own tare.
  const conjuntoVanderleia: Conjunto = { id: nextConjuntoId++, name: 'Vanderleia', createdAt: now, updatedAt: now };
  const conjuntoBicacamba: Conjunto = {
    id: nextConjuntoId++,
    name: 'Bitrem Bicaçamba',
    createdAt: now,
    updatedAt: now,
  };
  const conjuntos = [conjuntoVanderleia, conjuntoBicacamba];

  const truck1Id = nextTruckId++;
  const truck1AssignmentVanderleia: TruckConjunto = {
    id: nextTruckConjuntoId++,
    truckId: truck1Id,
    conjuntoId: conjuntoVanderleia.id,
    conjuntoName: conjuntoVanderleia.name,
    tareWeightKg: 20120,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const truck1AssignmentBicacamba: TruckConjunto = {
    id: nextTruckConjuntoId++,
    truckId: truck1Id,
    conjuntoId: conjuntoBicacamba.id,
    conjuntoName: conjuntoBicacamba.name,
    tareWeightKg: 22860,
    isActive: false,
    createdAt: now,
    updatedAt: now,
  };
  const truck1: Truck = {
    id: truck1Id,
    plate: 'IZS7I76',
    label: 'Caminhão interno 1',
    createdAt: now,
    updatedAt: now,
    conjuntos: [truck1AssignmentVanderleia, truck1AssignmentBicacamba],
  };

  // Same "Vanderleia" conjunto, assigned to a different truck with a
  // different tare — demonstrates the many-to-many relationship.
  const truck2Id = nextTruckId++;
  const truck2AssignmentVanderleia: TruckConjunto = {
    id: nextTruckConjuntoId++,
    truckId: truck2Id,
    conjuntoId: conjuntoVanderleia.id,
    conjuntoName: conjuntoVanderleia.name,
    tareWeightKg: 20340,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const truck2: Truck = {
    id: truck2Id,
    plate: 'TQT1I39',
    label: 'Caminhão interno 2',
    createdAt: now,
    updatedAt: now,
    conjuntos: [truck2AssignmentVanderleia],
  };

  const trucks = [truck1, truck2];

  const truckAuditLog: TruckAuditLogEntry[] = [
    {
      id: nextTruckAuditLogId++,
      truckId: truck1.id,
      actor: 'admin',
      action: 'truck_created',
      payload: { plate: truck1.plate, label: truck1.label },
      createdAt: now,
    },
    {
      id: nextTruckAuditLogId++,
      truckId: truck1.id,
      actor: 'admin',
      action: 'conjunto_activated',
      payload: {
        truckConjuntoId: truck1AssignmentVanderleia.id,
        conjuntoName: conjuntoVanderleia.name,
        tareWeightKg: truck1AssignmentVanderleia.tareWeightKg,
      },
      createdAt: now,
    },
  ];

  const users: MockUser[] = [
    makeUser({ ...MOCK_CREDENTIALS, name: 'Administrador', role: 'admin' }),
    makeUser({ ...MOCK_OPERATOR_CREDENTIALS, name: 'Operador da Balança', role: 'operator' }),
    makeUser({
      ...MOCK_PENDING_CREDENTIALS,
      name: 'Usuário Novo',
      role: 'operator',
      mustChangePassword: true,
    }),
  ];

  return {
    tickets,
    auditLog,
    rawEvents,
    status,
    users,
    sessionUserId: null,
    trucks,
    conjuntos,
    truckAuditLog,
  };
}

export const store: FixtureStore = buildInitialStore();

export function resetFixtures(): void {
  const fresh = buildInitialStore();
  store.tickets = fresh.tickets;
  store.auditLog = fresh.auditLog;
  store.rawEvents = fresh.rawEvents;
  store.status = fresh.status;
  store.users = fresh.users;
  store.sessionUserId = null;
  store.trucks = fresh.trucks;
  store.conjuntos = fresh.conjuntos;
  store.truckAuditLog = fresh.truckAuditLog;
}

export function allocateTicketId(): number {
  return nextTicketId++;
}

export function allocateTicketNumber(): number {
  return nextTicketNumber++;
}

export function allocateAuditLogId(): number {
  return nextAuditLogId++;
}

export function allocateTruckId(): number {
  return nextTruckId++;
}

export function allocateConjuntoId(): number {
  return nextConjuntoId++;
}

export function allocateTruckConjuntoId(): number {
  return nextTruckConjuntoId++;
}

export function allocateTruckAuditLogId(): number {
  return nextTruckAuditLogId++;
}

export function allocateUserId(): number {
  return nextUserId++;
}
