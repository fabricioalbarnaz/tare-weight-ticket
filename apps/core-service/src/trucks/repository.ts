import { and, desc, eq } from 'drizzle-orm';
import { conjuntos, internalTrucks, truckAuditLog, truckConjuntos } from '../db/schema.js';
import type { Db } from '../db/client.js';

export type InternalTruck = typeof internalTrucks.$inferSelect;
export type Conjunto = typeof conjuntos.$inferSelect;
export type TruckConjunto = typeof truckConjuntos.$inferSelect;
export type TruckAuditLogEntry = typeof truckAuditLog.$inferSelect;

/** A truck's conjunto assignment, joined with the shared conjunto's name for display. */
export interface TruckConjuntoWithName extends TruckConjunto {
  conjuntoName: string;
}

export interface CreateTruckInput {
  plate: string;
  label?: string | null;
}

export interface CreateConjuntoInput {
  name: string;
}

export interface AssignConjuntoInput {
  truckId: number;
  conjuntoId: number;
  tareWeightKg: number;
}

export interface ActiveTare {
  truckId: number;
  truckConjuntoId: number;
  tareWeightKg: number;
}

export interface TruckRepository {
  listTrucks(): InternalTruck[];
  findTruckById(truckId: number): InternalTruck | undefined;
  findTruckByPlate(plate: string): InternalTruck | undefined;
  createTruck(input: CreateTruckInput): InternalTruck;

  listConjuntos(): Conjunto[];
  findConjuntoById(conjuntoId: number): Conjunto | undefined;
  findConjuntoByName(name: string): Conjunto | undefined;
  createConjunto(input: CreateConjuntoInput): Conjunto;

  /** Every conjunto assignment for a truck, joined with the conjunto's name. */
  listTruckConjuntos(truckId: number): TruckConjuntoWithName[];
  findTruckConjuntoById(truckConjuntoId: number): TruckConjunto | undefined;
  /** Assigns a (possibly already-used elsewhere) conjunto to a truck with this pair's tare. */
  assignConjuntoToTruck(input: AssignConjuntoInput): TruckConjunto;
  /** Marks this assignment active and deactivates every other assignment of the same truck, in one transaction. */
  activateTruckConjunto(truckConjuntoId: number): TruckConjunto;

  /**
   * The tare to use for a plate read, from the truck's currently active
   * conjunto assignment — undefined if the plate isn't a registered
   * internal truck, or if it is but has no active assignment (caller
   * should fall through to the normal external-truck flow in that case,
   * see master plan §11).
   */
  findActiveTareByPlate(plate: string): ActiveTare | undefined;

  findAuditLogByTruckId(truckId: number): TruckAuditLogEntry[];
  appendAuditLog(truckId: number, actor: string, action: string, payload?: unknown): void;
  /** Same semantics as `TicketRepository.transaction` — one synchronous better-sqlite3 transaction. */
  transaction<T>(fn: () => T): T;
}

export function createTruckRepository(db: Db): TruckRepository {
  function requireTruckConjuntoById(truckConjuntoId: number): TruckConjunto {
    const row = db.select().from(truckConjuntos).where(eq(truckConjuntos.id, truckConjuntoId)).get();
    if (!row) {
      throw new Error(`Truck conjunto assignment ${truckConjuntoId} not found`);
    }
    return row;
  }

  return {
    listTrucks() {
      return db.select().from(internalTrucks).all();
    },

    findTruckById(truckId) {
      return db.select().from(internalTrucks).where(eq(internalTrucks.id, truckId)).get();
    },

    findTruckByPlate(plate) {
      return db.select().from(internalTrucks).where(eq(internalTrucks.plate, plate)).get();
    },

    createTruck(input) {
      const now = new Date();
      return db
        .insert(internalTrucks)
        .values({
          plate: input.plate,
          label: input.label ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    },

    listConjuntos() {
      return db.select().from(conjuntos).all();
    },

    findConjuntoById(conjuntoId) {
      return db.select().from(conjuntos).where(eq(conjuntos.id, conjuntoId)).get();
    },

    findConjuntoByName(name) {
      return db.select().from(conjuntos).where(eq(conjuntos.name, name)).get();
    },

    createConjunto(input) {
      const now = new Date();
      return db
        .insert(conjuntos)
        .values({ name: input.name, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },

    listTruckConjuntos(truckId) {
      return db
        .select({
          id: truckConjuntos.id,
          truckId: truckConjuntos.truckId,
          conjuntoId: truckConjuntos.conjuntoId,
          tareWeightKg: truckConjuntos.tareWeightKg,
          isActive: truckConjuntos.isActive,
          createdAt: truckConjuntos.createdAt,
          updatedAt: truckConjuntos.updatedAt,
          conjuntoName: conjuntos.name,
        })
        .from(truckConjuntos)
        .innerJoin(conjuntos, eq(truckConjuntos.conjuntoId, conjuntos.id))
        .where(eq(truckConjuntos.truckId, truckId))
        .all();
    },

    findTruckConjuntoById(truckConjuntoId) {
      return db.select().from(truckConjuntos).where(eq(truckConjuntos.id, truckConjuntoId)).get();
    },

    assignConjuntoToTruck(input) {
      const now = new Date();
      return db
        .insert(truckConjuntos)
        .values({
          truckId: input.truckId,
          conjuntoId: input.conjuntoId,
          tareWeightKg: input.tareWeightKg,
          isActive: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    },

    activateTruckConjunto(truckConjuntoId) {
      return db.transaction(() => {
        const target = requireTruckConjuntoById(truckConjuntoId);

        db.update(truckConjuntos)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(truckConjuntos.truckId, target.truckId), eq(truckConjuntos.isActive, true)))
          .run();

        return db
          .update(truckConjuntos)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(truckConjuntos.id, truckConjuntoId))
          .returning()
          .get()!;
      });
    },

    findActiveTareByPlate(plate) {
      const truck = db.select().from(internalTrucks).where(eq(internalTrucks.plate, plate)).get();
      if (!truck) return undefined;

      const activeAssignment = db
        .select()
        .from(truckConjuntos)
        .where(and(eq(truckConjuntos.truckId, truck.id), eq(truckConjuntos.isActive, true)))
        .get();
      if (!activeAssignment) return undefined;

      return {
        truckId: truck.id,
        truckConjuntoId: activeAssignment.id,
        tareWeightKg: activeAssignment.tareWeightKg,
      };
    },

    findAuditLogByTruckId(truckId) {
      return db
        .select()
        .from(truckAuditLog)
        .where(eq(truckAuditLog.truckId, truckId))
        .orderBy(desc(truckAuditLog.id))
        .all();
    },

    appendAuditLog(truckId, actor, action, payload) {
      db.insert(truckAuditLog)
        .values({
          truckId,
          actor,
          action,
          payload: payload !== undefined ? JSON.stringify(payload) : null,
          createdAt: new Date(),
        })
        .run();
    },

    transaction(fn) {
      return db.transaction(() => fn());
    },
  };
}
