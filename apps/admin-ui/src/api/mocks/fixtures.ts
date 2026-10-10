import type {
  AuditLogEntry,
  CurrentUser,
  HardwareStatus,
  RawEvent,
  Ticket,
} from '../types';

const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

export const MOCK_CREDENTIALS = { username: 'admin', password: 'admin123' };

let nextTicketId = 1;
let nextTicketNumber = 1001;
let nextAuditLogId = 1;
let nextRawEventId = 1;

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

export interface FixtureStore {
  tickets: Ticket[];
  auditLog: AuditLogEntry[];
  rawEvents: RawEvent[];
  status: HardwareStatus;
  session: CurrentUser | null;
}

function buildInitialStore(): FixtureStore {
  nextTicketId = 1;
  nextTicketNumber = 1001;
  nextAuditLogId = 1;
  nextRawEventId = 1;

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

  const tickets = [open, closed, anomaly, needsAttention, historical];

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

  return { tickets, auditLog, rawEvents, status, session: null };
}

export const store: FixtureStore = buildInitialStore();

export function resetFixtures(): void {
  const fresh = buildInitialStore();
  store.tickets = fresh.tickets;
  store.auditLog = fresh.auditLog;
  store.rawEvents = fresh.rawEvents;
  store.status = fresh.status;
  store.session = null;
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
