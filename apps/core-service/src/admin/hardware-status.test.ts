import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { createTicketRepository, type TicketRepository } from '../tickets/repository.js';
import type { ScaleClient, ScaleStatus } from '../scale/types.js';
import type { DriverSignalAdapter, DriverSignalStatus } from '../driver-signal/types.js';
import type { PrintClient } from '../printing/print-client.js';
import { getHardwareStatus } from './hardware-status.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TicketRepository;
let scaleStatus: ScaleStatus;
let relayStatus: DriverSignalStatus;
let printBridgeReachable: boolean;

function createFakeScaleClient(): ScaleClient {
  return {
    async readStableWeight() {
      return { weightKg: null, weightCaptureFailed: true };
    },
    getStatus() {
      return scaleStatus;
    },
    close() {},
  };
}

function createFakeDriverSignalAdapter(): DriverSignalAdapter {
  return {
    async signalDriver() {},
    getStatus() {
      return relayStatus;
    },
  };
}

function createFakePrintClient(): PrintClient {
  return {
    async printTicket() {
      return { success: true };
    },
    async checkHealth() {
      return { reachable: printBridgeReachable };
    },
  };
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-hardware-status-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createTicketRepository(db);
  scaleStatus = { connected: false, lastSeenAt: null };
  relayStatus = { lastSuccessAt: null, lastFailureAt: null };
  printBridgeReachable = false;
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('getHardwareStatus', () => {
  it('reports everything unreachable when nothing has ever happened', async () => {
    const status = await getHardwareStatus({
      repo,
      scaleClient: createFakeScaleClient(),
      driverSignalAdapter: createFakeDriverSignalAdapter(),
      printClient: createFakePrintClient(),
    });

    expect(status).toEqual({
      cameraEntrance: { reachable: false, lastSeenAt: null },
      cameraExit: { reachable: false, lastSeenAt: null },
      scale: { reachable: false, lastSeenAt: null },
      printBridge: { reachable: false, lastSeenAt: null },
      relay: { reachable: false, lastSeenAt: null },
    });
  });

  it('reports a camera reachable when it has a recent raw event', async () => {
    repo.recordRawEvent('camera_entrance', { raw: 'ok' });

    const status = await getHardwareStatus({
      repo,
      scaleClient: createFakeScaleClient(),
      driverSignalAdapter: createFakeDriverSignalAdapter(),
      printClient: createFakePrintClient(),
    });

    expect(status.cameraEntrance.reachable).toBe(true);
    expect(status.cameraEntrance.lastSeenAt).not.toBeNull();
    expect(status.cameraExit.reachable).toBe(false);
  });

  it('reports a camera unreachable once its last event is older than the staleness window', async () => {
    repo.recordRawEvent('camera_entrance', { raw: 'old' });

    const status = await getHardwareStatus({
      repo,
      scaleClient: createFakeScaleClient(),
      driverSignalAdapter: createFakeDriverSignalAdapter(),
      printClient: createFakePrintClient(),
      cameraStalenessMs: -1,
    });

    expect(status.cameraEntrance.reachable).toBe(false);
  });

  it('reflects the scale client status', async () => {
    scaleStatus = { connected: true, lastSeenAt: new Date('2026-01-01T00:00:00Z') };

    const status = await getHardwareStatus({
      repo,
      scaleClient: createFakeScaleClient(),
      driverSignalAdapter: createFakeDriverSignalAdapter(),
      printClient: createFakePrintClient(),
    });

    expect(status.scale).toEqual({ reachable: true, lastSeenAt: '2026-01-01T00:00:00.000Z' });
  });

  it('reflects the print bridge health check', async () => {
    printBridgeReachable = true;

    const status = await getHardwareStatus({
      repo,
      scaleClient: createFakeScaleClient(),
      driverSignalAdapter: createFakeDriverSignalAdapter(),
      printClient: createFakePrintClient(),
    });

    expect(status.printBridge).toEqual({ reachable: true, lastSeenAt: null });
  });

  it('reports the relay reachable only when the most recent attempt succeeded', async () => {
    relayStatus = {
      lastSuccessAt: new Date('2026-01-01T00:00:00Z'),
      lastFailureAt: new Date('2026-01-01T00:01:00Z'),
    };

    const status = await getHardwareStatus({
      repo,
      scaleClient: createFakeScaleClient(),
      driverSignalAdapter: createFakeDriverSignalAdapter(),
      printClient: createFakePrintClient(),
    });

    expect(status.relay.reachable).toBe(false);
  });
});
