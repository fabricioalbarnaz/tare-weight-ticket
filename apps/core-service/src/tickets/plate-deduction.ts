import { findSingleCharDifferenceIndex } from '../domain/plate.js';
import type { CameraReadQuality } from '../camera/normalize.js';
import type { Ticket } from './repository.js';

/**
 * Validated against this install's data (docs/runbooks/known-ticket-failure-patterns.md,
 * 2026-11-18 analysis): every confirmed single-character plate misread had
 * the differing character's `plateCharBelieve` value below 95% *and* at
 * least 15 points below every other character's confidence in the same
 * reading (69/51/95/68/67% on the wrong character vs. 93-99% on the other
 * six, across all 5 confidence-backed cases found). Tune only against
 * further confirmed cases, not speculatively.
 */
const MAX_DIFF_CHAR_CONFIDENCE = 95;
const MIN_CONFIDENCE_GAP = 15;

export interface PlateDeductionMatch {
  ticket: Ticket;
  diffIndex: number;
  diffCharConfidence: number;
  otherCharsMinConfidence: number;
}

/**
 * Finds the single `OPEN` ticket among `candidates` whose plate this exit
 * reading's `misreadPlate` is a one-character misread of, per the ANPR
 * per-character confidence data — see
 * docs/plans/2026-11-18-plate-misread-deduction-plan.md. Deliberately
 * conservative: returns `undefined` (never guesses) when there's no usable
 * confidence data, when no candidate's differing character meets the
 * criteria above, or when more than one candidate qualifies (ambiguous).
 */
export function findPlateDeductionMatch(
  candidates: Ticket[],
  misreadPlate: string,
  readQuality: CameraReadQuality | undefined,
): PlateDeductionMatch | undefined {
  if (!readQuality || readQuality.plateCharBelieve.length !== misreadPlate.length) {
    return undefined;
  }

  const matches: PlateDeductionMatch[] = [];
  for (const candidate of candidates) {
    const diffIndex = findSingleCharDifferenceIndex(candidate.plate, misreadPlate);
    if (diffIndex === null) continue;

    const diffCharConfidence = readQuality.plateCharBelieve[diffIndex]!;
    const otherCharsMinConfidence = Math.min(
      ...readQuality.plateCharBelieve.filter((_, index) => index !== diffIndex),
    );

    if (
      diffCharConfidence < MAX_DIFF_CHAR_CONFIDENCE &&
      otherCharsMinConfidence - diffCharConfidence >= MIN_CONFIDENCE_GAP
    ) {
      matches.push({ ticket: candidate, diffIndex, diffCharConfidence, otherCharsMinConfidence });
    }
  }

  return matches.length === 1 ? matches[0] : undefined;
}
