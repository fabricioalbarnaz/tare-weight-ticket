import { describe, expect, it } from 'vitest';
import type { CameraReadQuality } from '../camera/normalize.js';
import { findPlateDeductionMatch, type PlateDeductionCandidate } from './plate-deduction.js';

function candidate(plate: string, ownCharConfidence?: number[]): PlateDeductionCandidate {
  return { plate, ownCharConfidence };
}

function makeReadQuality(readPlate: string, plateCharBelieve: number[]): CameraReadQuality {
  return { readPlate, confidenceLevel: 96, plateCharBelieve };
}

describe('findPlateDeductionMatch', () => {
  describe('fallback (no stored ownCharConfidence — today\'s original single-sided rule)', () => {
    // Leading digit on both sides guarantees neither matches a recognized
    // plate format, so the format check never disambiguates and this
    // block genuinely exercises the fallback branch (not the format one).
    it('matches the single candidate whose one differing character has anomalously low confidence', () => {
      const candidates = [candidate('9KZ6F83')];
      const readQuality = makeReadQuality('9K76F83', [99, 99, 67, 99, 99, 99, 99]);

      const match = findPlateDeductionMatch(candidates, '9K76F83', readQuality);

      expect(match).toMatchObject({
        candidate: candidates[0],
        diffIndex: 2,
        winner: 'entry',
        matchedBy: 'fallback',
        correctedPlate: null,
        entryCharConfidence: null,
        exitCharConfidence: 67,
      });
    });

    it('returns undefined when no candidate is a one-character match', () => {
      const candidates = [candidate('ABC1234')];
      const readQuality = makeReadQuality('XYZ9999', [99, 99, 99, 99, 99, 99, 99]);

      expect(findPlateDeductionMatch(candidates, 'XYZ9999', readQuality)).toBeUndefined();
    });

    it('returns undefined when the differing character is not confidently low (above threshold)', () => {
      const candidates = [candidate('9KZ6F83')];
      const readQuality = makeReadQuality('9K76F83', [99, 99, 97, 99, 99, 99, 99]);

      expect(findPlateDeductionMatch(candidates, '9K76F83', readQuality)).toBeUndefined();
    });

    it('returns undefined when the differing character is low but not far enough below the others', () => {
      const candidates = [candidate('9KZ6F83')];
      // 94 is below the 95 cap but only 5 points below the others (84), short of the 15-point gap.
      const readQuality = makeReadQuality('9K76F83', [84, 84, 94, 84, 84, 84, 84]);

      expect(findPlateDeductionMatch(candidates, '9K76F83', readQuality)).toBeUndefined();
    });

    it('returns undefined when more than one candidate qualifies (ambiguous)', () => {
      const candidates = [candidate('9KZ6F83'), candidate('9KA6F83')];
      const readQuality = makeReadQuality('9K76F83', [99, 99, 60, 99, 99, 99, 99]);

      expect(findPlateDeductionMatch(candidates, '9K76F83', readQuality)).toBeUndefined();
    });

    it('returns undefined when there is no read-quality data at all', () => {
      const candidates = [candidate('9KZ6F83')];

      expect(findPlateDeductionMatch(candidates, '9K76F83', undefined)).toBeUndefined();
    });

    it('returns undefined when plateCharBelieve length does not match the plate length', () => {
      const candidates = [candidate('9KZ6F83')];
      const readQuality = makeReadQuality('9K76F83', [99, 99, 60]);

      expect(findPlateDeductionMatch(candidates, '9K76F83', readQuality)).toBeUndefined();
    });

    it('returns undefined for an empty candidate list', () => {
      const readQuality = makeReadQuality('9K76F83', [99, 99, 60, 99, 99, 99, 99]);

      expect(findPlateDeductionMatch([], '9K76F83', readQuality)).toBeUndefined();
    });
  });

  describe('bidirectional confidence comparison (candidate has stored ownCharConfidence)', () => {
    // AABA111/AAAA111/AACA111 (4 letters + 3 digits) match none of the
    // recognized formats on either side, so the format check never
    // disambiguates here and the confidence comparison is what's
    // actually under test — isolated from the 2026-11-24 incident's own
    // plates (RL13H28/RLI3H28), which happen to also differ in format
    // validity and are covered separately below.
    it('corrects to the incoming reading when it is more confident at the differing position (shape of the 2026-11-24 incident)', () => {
      const candidates = [candidate('AABA111', [99, 98, 91, 98, 90, 90, 77])];
      const readQuality = makeReadQuality('AAAA111', [99, 99, 97, 99, 99, 99, 97]);

      const match = findPlateDeductionMatch(candidates, 'AAAA111', readQuality);

      expect(match).toMatchObject({
        diffIndex: 2,
        winner: 'exit',
        matchedBy: 'confidence',
        correctedPlate: 'AAAA111',
        entryCharConfidence: 91,
        exitCharConfidence: 97,
      });
    });

    it('keeps the candidate plate when it is more confident at the differing position', () => {
      const candidates = [candidate('AAAA111', [99, 99, 97, 99, 99, 99, 97])];
      const readQuality = makeReadQuality('AABA111', [99, 98, 91, 98, 90, 90, 77]);

      const match = findPlateDeductionMatch(candidates, 'AABA111', readQuality);

      expect(match).toMatchObject({
        diffIndex: 2,
        winner: 'entry',
        matchedBy: 'confidence',
        correctedPlate: null,
      });
    });

    it('keeps the candidate plate (no correction) on an exact tie at the differing position', () => {
      const candidates = [candidate('AABA111', [99, 99, 93, 99, 99, 99, 97])];
      const readQuality = makeReadQuality('AAAA111', [99, 98, 93, 98, 90, 90, 77]);

      const match = findPlateDeductionMatch(candidates, 'AAAA111', readQuality);

      expect(match).toMatchObject({
        diffIndex: 2,
        winner: 'entry',
        matchedBy: 'confidence',
        correctedPlate: null,
        entryCharConfidence: 93,
        exitCharConfidence: 93,
      });
    });

    it('returns undefined when more than one candidate qualifies by confidence (ambiguous)', () => {
      const candidates = [
        candidate('AABA111', [99, 99, 97, 99, 99, 99, 97]),
        candidate('AACA111', [99, 99, 50, 99, 99, 99, 97]),
      ];
      const readQuality = makeReadQuality('AAAA111', [99, 98, 91, 98, 90, 90, 77]);

      expect(findPlateDeductionMatch(candidates, 'AAAA111', readQuality)).toBeUndefined();
    });
  });

  describe('plate-format priority (overrides confidence)', () => {
    it('picks the valid-format side even when confidence alone would favor the invalid one', () => {
      // RL13H28 is not a valid format (digit where Mercosul needs a letter); RLI3H28 is valid Mercosul.
      // Confidence here favors the (invalid) candidate plate, but format should still win for the incoming reading.
      const candidates = [candidate('RL13H28', [99, 98, 99, 98, 90, 90, 77])];
      const readQuality = makeReadQuality('RLI3H28', [99, 99, 10, 99, 99, 99, 97]);

      const match = findPlateDeductionMatch(candidates, 'RLI3H28', readQuality);

      expect(match).toMatchObject({
        diffIndex: 2,
        winner: 'exit',
        matchedBy: 'format',
        correctedPlate: 'RLI3H28',
      });
    });

    it('picks the valid-format candidate even when confidence alone would favor the invalid incoming reading', () => {
      const candidates = [candidate('RLI3H28', [99, 99, 10, 99, 99, 99, 97])];
      const readQuality = makeReadQuality('RL13H28', [99, 98, 99, 98, 90, 90, 77]);

      const match = findPlateDeductionMatch(candidates, 'RL13H28', readQuality);

      expect(match).toMatchObject({
        diffIndex: 2,
        winner: 'entry',
        matchedBy: 'format',
        correctedPlate: null,
      });
    });

    it('falls back to confidence when both sides match a valid format', () => {
      // ABC1234 vs ABC1934 differ at index 4 ('2' vs '9'); both are valid Brazil-old-format plates.
      const candidates = [candidate('ABC1234', [99, 99, 99, 99, 91, 99, 99])];
      const readQuality = makeReadQuality('ABC1934', [99, 99, 99, 99, 97, 99, 99]);

      const match = findPlateDeductionMatch(candidates, 'ABC1934', readQuality);

      expect(match).toMatchObject({ matchedBy: 'confidence', winner: 'exit', correctedPlate: 'ABC1934' });
    });

    it('falls back to confidence when neither side matches a valid format', () => {
      // 1234ABC vs 1934ABC differ at index 1 ('2' vs '9'); neither matches a recognized format (none start with digits).
      const candidates = [candidate('1234ABC', [99, 91, 99, 99, 99, 99, 99])];
      const readQuality = makeReadQuality('1934ABC', [99, 97, 99, 99, 99, 99, 99]);

      const match = findPlateDeductionMatch(candidates, '1934ABC', readQuality);

      expect(match).toMatchObject({ matchedBy: 'confidence', winner: 'exit', correctedPlate: '1934ABC' });
    });
  });

  describe('synthetic ground-truth candidate (internal-truck tare — candidate.plate always wins)', () => {
    // AABA111/AAAA111 (4 letters + 3 digits) match none of the recognized
    // formats, on either side — chosen so the format check doesn't
    // disambiguate here and the confidence comparison actually runs.
    it('matches any single-character-different reading against a 100%-confidence candidate', () => {
      const candidates = [candidate('AABA111', [100, 100, 100, 100, 100, 100, 100])];
      const readQuality = makeReadQuality('AAAA111', [99, 98, 91, 98, 90, 90, 77]);

      const match = findPlateDeductionMatch(candidates, 'AAAA111', readQuality);

      expect(match).toMatchObject({
        diffIndex: 2,
        winner: 'entry',
        matchedBy: 'confidence',
        correctedPlate: null,
      });
    });

    it('ties (no correction) when the incoming reading is also 100% at the differing position', () => {
      const candidates = [candidate('AABA111', [100, 100, 100, 100, 100, 100, 100])];
      const readQuality = makeReadQuality('AAAA111', [100, 100, 100, 100, 100, 100, 100]);

      const match = findPlateDeductionMatch(candidates, 'AAAA111', readQuality);

      expect(match).toMatchObject({ winner: 'entry', matchedBy: 'confidence', correctedPlate: null });
    });
  });
});
