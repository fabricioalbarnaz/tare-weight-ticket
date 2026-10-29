import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { createTruckRepository, type TruckRepository } from './repository.js';

let dbPath: string;
let sqlite: ReturnType<typeof createDb>['sqlite'];
let db: Db;
let repo: TruckRepository;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `tare-truck-repo-test-${randomUUID()}.sqlite`);
  const created = createDb(dbPath);
  db = created.db;
  sqlite = created.sqlite;
  repo = createTruckRepository(db);
});

afterEach(() => {
  sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

describe('TruckRepository', () => {
  it('creates a truck and finds it by plate or id', () => {
    const truck = repo.createTruck({ plate: 'ABC1234', label: 'Caminhão 1' });

    expect(truck.plate).toBe('ABC1234');
    expect(repo.findTruckByPlate('ABC1234')?.id).toBe(truck.id);
    expect(repo.findTruckById(truck.id)?.label).toBe('Caminhão 1');
  });

  it('lists trucks', () => {
    repo.createTruck({ plate: 'AAA1111' });
    repo.createTruck({ plate: 'BBB2222' });

    expect(repo.listTrucks().map((t) => t.plate).sort()).toEqual(['AAA1111', 'BBB2222']);
  });

  it('creates a conjunto and finds it by name or id', () => {
    const conjunto = repo.createConjunto({ name: 'Vanderleia' });

    expect(repo.findConjuntoByName('Vanderleia')?.id).toBe(conjunto.id);
    expect(repo.findConjuntoById(conjunto.id)?.name).toBe('Vanderleia');
    expect(repo.listConjuntos()).toHaveLength(1);
  });

  it('assigns a conjunto to a truck as inactive by default, joined with the conjunto name', () => {
    const truck = repo.createTruck({ plate: 'CCC3333' });
    const conjunto = repo.createConjunto({ name: 'Vanderleia' });
    const assignment = repo.assignConjuntoToTruck({ truckId: truck.id, conjuntoId: conjunto.id, tareWeightKg: 8000 });

    expect(assignment.isActive).toBe(false);
    expect(assignment.tareWeightKg).toBe(8000);

    const assignments = repo.listTruckConjuntos(truck.id);
    expect(assignments).toEqual([expect.objectContaining({ conjuntoName: 'Vanderleia', tareWeightKg: 8000 })]);
  });

  it('the same conjunto can be assigned to multiple trucks with different tares', () => {
    const truckA = repo.createTruck({ plate: 'AAA0001' });
    const truckB = repo.createTruck({ plate: 'BBB0002' });
    const conjunto = repo.createConjunto({ name: 'Bitrem Bicaçamba' });

    repo.assignConjuntoToTruck({ truckId: truckA.id, conjuntoId: conjunto.id, tareWeightKg: 22860 });
    repo.assignConjuntoToTruck({ truckId: truckB.id, conjuntoId: conjunto.id, tareWeightKg: 20800 });

    expect(repo.listTruckConjuntos(truckA.id)[0].tareWeightKg).toBe(22860);
    expect(repo.listTruckConjuntos(truckB.id)[0].tareWeightKg).toBe(20800);
  });

  it('a truck can have multiple conjunto assignments', () => {
    const truck = repo.createTruck({ plate: 'DDD4444' });
    const conjuntoA = repo.createConjunto({ name: 'A' });
    const conjuntoB = repo.createConjunto({ name: 'B' });

    repo.assignConjuntoToTruck({ truckId: truck.id, conjuntoId: conjuntoA.id, tareWeightKg: 8000 });
    repo.assignConjuntoToTruck({ truckId: truck.id, conjuntoId: conjuntoB.id, tareWeightKg: 8500 });

    expect(repo.listTruckConjuntos(truck.id)).toHaveLength(2);
  });

  it('activating an assignment deactivates every other assignment of the same truck', () => {
    const truck = repo.createTruck({ plate: 'EEE5555' });
    const conjuntoA = repo.createConjunto({ name: 'A' });
    const conjuntoB = repo.createConjunto({ name: 'B' });
    const assignmentA = repo.assignConjuntoToTruck({ truckId: truck.id, conjuntoId: conjuntoA.id, tareWeightKg: 8000 });
    const assignmentB = repo.assignConjuntoToTruck({ truckId: truck.id, conjuntoId: conjuntoB.id, tareWeightKg: 8500 });

    repo.activateTruckConjunto(assignmentA.id);
    repo.activateTruckConjunto(assignmentB.id);

    const assignments = repo.listTruckConjuntos(truck.id);
    expect(assignments.find((a) => a.id === assignmentA.id)?.isActive).toBe(false);
    expect(assignments.find((a) => a.id === assignmentB.id)?.isActive).toBe(true);
  });

  it('activating an assignment for one truck does not affect another truck’s assignments', () => {
    const truckA = repo.createTruck({ plate: 'FFF6666' });
    const truckB = repo.createTruck({ plate: 'GGG7777' });
    const conjunto = repo.createConjunto({ name: 'Shared' });
    const assignmentA = repo.assignConjuntoToTruck({ truckId: truckA.id, conjuntoId: conjunto.id, tareWeightKg: 8000 });
    const assignmentB = repo.assignConjuntoToTruck({ truckId: truckB.id, conjuntoId: conjunto.id, tareWeightKg: 9000 });

    repo.activateTruckConjunto(assignmentA.id);
    repo.activateTruckConjunto(assignmentB.id);

    expect(repo.findTruckConjuntoById(assignmentA.id)?.isActive).toBe(true);
    expect(repo.findTruckConjuntoById(assignmentB.id)?.isActive).toBe(true);
  });

  it('throws when activating an assignment that does not exist', () => {
    expect(() => repo.activateTruckConjunto(999)).toThrow();
  });

  describe('findActiveTareByPlate', () => {
    it('returns undefined for a plate that is not a registered internal truck', () => {
      expect(repo.findActiveTareByPlate('NOTREG01')).toBeUndefined();
    });

    it('returns undefined when the truck has no active conjunto yet', () => {
      repo.createTruck({ plate: 'NOACTIVE' });
      expect(repo.findActiveTareByPlate('NOACTIVE')).toBeUndefined();
    });

    it('returns the active assignment tare for a registered truck', () => {
      const truck = repo.createTruck({ plate: 'HASTARE1' });
      const conjuntoOld = repo.createConjunto({ name: 'Old' });
      const conjuntoCurrent = repo.createConjunto({ name: 'Current' });
      const inactive = repo.assignConjuntoToTruck({ truckId: truck.id, conjuntoId: conjuntoOld.id, tareWeightKg: 7000 });
      const active = repo.assignConjuntoToTruck({
        truckId: truck.id,
        conjuntoId: conjuntoCurrent.id,
        tareWeightKg: 8200,
      });
      repo.activateTruckConjunto(active.id);

      const tare = repo.findActiveTareByPlate('HASTARE1');
      expect(tare).toEqual({ truckId: truck.id, truckConjuntoId: active.id, tareWeightKg: 8200 });
      expect(repo.findTruckConjuntoById(inactive.id)?.isActive).toBe(false);
    });
  });
});
