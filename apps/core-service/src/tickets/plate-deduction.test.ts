import { describe, expect, it } from 'vitest';
import type { CameraReadQuality } from '../camera/normalize.js';
import { findPlateDeductionMatch } from './plate-deduction.js';
import type { Ticket } from './repository.js';

function makeTicket(id: number, plate: string): Ticket {
  return {
    id,
    ticketNumber: id,
    plate,
    status: 'OPEN',
    entryAt: new Date('2026-11-18T08:00:00.000Z'),
    entryWeightKg: 60000,
    entryCameraId: 'cam-entrance',
    entryCaptureFailed: false,
    exitAt: null,
    exitWeightKg: null,
    exitCameraId: null,
    exitCaptureFailed: false,
    netWeightKg: null,
    printedAt: null,
    createdByAdmin: false,
    notes: null,
    reweighOfTicketId: null,
    reweighedByTicketId: null,
    createdAt: new Date('2026-11-18T08:00:00.000Z'),
    updatedAt: new Date('2026-11-18T08:00:00.000Z'),
  };
}

function makeReadQuality(readPlate: string, plateCharBelieve: number[]): CameraReadQuality {
  return { readPlate, confidenceLevel: 96, plateCharBelieve };
}

describe('findPlateDeductionMatch', () => {
  it('matches the single candidate whose one differing character has anomalously low confidence', () => {
    const candidates = [makeTicket(1, 'RKZ6F83')];
    const readQuality = makeReadQuality('RK76F83', [99, 99, 67, 99, 99, 99, 99]);

    const match = findPlateDeductionMatch(candidates, 'RK76F83', readQuality);

    expect(match).toEqual({
      ticket: candidates[0],
      diffIndex: 2,
      diffCharConfidence: 67,
      otherCharsMinConfidence: 99,
    });
  });

  it('returns undefined when no candidate is a one-character match', () => {
    const candidates = [makeTicket(1, 'ABC1234')];
    const readQuality = makeReadQuality('XYZ9999', [99, 99, 99, 99, 99, 99, 99]);

    expect(findPlateDeductionMatch(candidates, 'XYZ9999', readQuality)).toBeUndefined();
  });

  it('returns undefined when the differing character is not confidently low (above threshold)', () => {
    const candidates = [makeTicket(1, 'RKZ6F83')];
    const readQuality = makeReadQuality('RK76F83', [99, 99, 97, 99, 99, 99, 99]);

    expect(findPlateDeductionMatch(candidates, 'RK76F83', readQuality)).toBeUndefined();
  });

  it('returns undefined when the differing character is low but not far enough below the others', () => {
    const candidates = [makeTicket(1, 'RKZ6F83')];
    // 94 is below the 95 cap but only 5 points below the others (84), short of the 15-point gap.
    const readQuality = makeReadQuality('RK76F83', [84, 84, 94, 84, 84, 84, 84]);

    expect(findPlateDeductionMatch(candidates, 'RK76F83', readQuality)).toBeUndefined();
  });

  it('returns undefined when more than one candidate qualifies (ambiguous)', () => {
    const candidates = [makeTicket(1, 'RKZ6F83'), makeTicket(2, 'RKA6F83')];
    const readQuality = makeReadQuality('RK76F83', [99, 99, 60, 99, 99, 99, 99]);

    expect(findPlateDeductionMatch(candidates, 'RK76F83', readQuality)).toBeUndefined();
  });

  it('returns undefined when there is no read-quality data at all', () => {
    const candidates = [makeTicket(1, 'RKZ6F83')];

    expect(findPlateDeductionMatch(candidates, 'RK76F83', undefined)).toBeUndefined();
  });

  it('returns undefined when plateCharBelieve length does not match the plate length', () => {
    const candidates = [makeTicket(1, 'RKZ6F83')];
    const readQuality = makeReadQuality('RK76F83', [99, 99, 60]);

    expect(findPlateDeductionMatch(candidates, 'RK76F83', readQuality)).toBeUndefined();
  });

  it('returns undefined for an empty candidate list', () => {
    const readQuality = makeReadQuality('RK76F83', [99, 99, 60, 99, 99, 99, 99]);

    expect(findPlateDeductionMatch([], 'RK76F83', readQuality)).toBeUndefined();
  });
});
