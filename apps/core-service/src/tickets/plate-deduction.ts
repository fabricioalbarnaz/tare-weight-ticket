import { findSingleCharDifferenceIndex, isValidPlateFormat } from '../domain/plate.js';
import type { CameraReadQuality } from '../camera/normalize.js';

/**
 * Single-sided fallback thresholds, used only when a candidate has no
 * `ownCharConfidence` to compare against (an `OPEN` ticket created before
 * this feature, or by an admin with no camera reading at all). Validated
 * against this install's data (docs/runbooks/known-ticket-failure-patterns.md,
 * 2026-11-18 analysis): every confirmed single-character plate misread had
 * the differing character's `plateCharBelieve` value below 95% *and* at
 * least 15 points below every other character's confidence in the same
 * reading (69/51/95/68/67% on the wrong character vs. 93-99% on the other
 * six, across all 5 confidence-backed cases found). Tune only against
 * further confirmed cases, not speculatively.
 */
const MAX_DIFF_CHAR_CONFIDENCE = 95;
const MIN_CONFIDENCE_GAP = 15;

export interface PlateDeductionCandidate {
  plate: string;
  /**
   * This candidate's own per-character confidence at `plate`'s positions.
   * `undefined` when truly unknown (triggers the single-sided fallback
   * above) — the caller supplies a synthetic all-100 array for a source
   * that should be treated as ground truth (e.g. a registered truck
   * plate) — see docs/plans/2026-11-24-bidirectional-plate-deduction-plan.md.
   */
  ownCharConfidence: number[] | undefined;
}

export interface PlateDeductionMatch<T> {
  candidate: T;
  diffIndex: number;
  /**
   * 'entry' = candidate.plate is correct (today's original behavior —
   * no correction). 'exit' = the incoming reading is correct. Only
   * meaningful to the OPEN-ticket caller, which can correct the ticket's
   * stored plate; the tare caller always uses candidate.plate regardless
   * of this value — truck registration is never auto-corrected by this
   * match.
   */
  winner: 'entry' | 'exit';
  matchedBy: 'format' | 'confidence' | 'fallback';
  /** Set only when winner === 'exit'. */
  correctedPlate: string | null;
  /** null when matchedBy === 'fallback' (no stored ownCharConfidence to report). */
  entryCharConfidence: number | null;
  exitCharConfidence: number;
}

/**
 * Finds the single candidate among `candidates` whose plate the incoming
 * reading (`incomingPlate`) is a one-character misread of — or vice versa.
 * Generic over any candidate with a `plate` and an optional
 * `ownCharConfidence`, so the same function serves both `OPEN` tickets
 * (real stored entrance confidence, or `undefined` for older tickets) and
 * active-tare trucks (a synthetic all-100 array — the registered plate is
 * ground truth) — one source of truth for the matching logic, never
 * duplicated. See docs/plans/2026-11-24-bidirectional-plate-deduction-plan.md
 * for the full design (supersedes the original single-sided
 * docs/plans/2026-11-18-plate-misread-deduction-plan.md rule, which is now
 * only the `matchedBy: 'fallback'` branch below).
 *
 * Deliberately conservative: returns `undefined` when there's no usable
 * confidence data on the incoming reading, when no candidate's differing
 * character qualifies, or when more than one candidate qualifies
 * (ambiguous).
 */
export function findPlateDeductionMatch<T extends PlateDeductionCandidate>(
  candidates: T[],
  incomingPlate: string,
  incomingReadQuality: CameraReadQuality | undefined,
): PlateDeductionMatch<T> | undefined {
  if (!incomingReadQuality || incomingReadQuality.plateCharBelieve.length !== incomingPlate.length) {
    return undefined;
  }

  const matches: PlateDeductionMatch<T>[] = [];
  for (const candidate of candidates) {
    const diffIndex = findSingleCharDifferenceIndex(candidate.plate, incomingPlate);
    if (diffIndex === null) continue;

    const exitCharConfidence = incomingReadQuality.plateCharBelieve[diffIndex]!;

    // Format check first: if exactly one side matches a recognized plate
    // format, that one wins outright, regardless of confidence.
    const entryFormatValid = isValidPlateFormat(candidate.plate);
    const exitFormatValid = isValidPlateFormat(incomingPlate);
    if (entryFormatValid !== exitFormatValid) {
      const entryCharConfidence = candidate.ownCharConfidence?.[diffIndex] ?? null;
      matches.push({
        candidate,
        diffIndex,
        winner: entryFormatValid ? 'entry' : 'exit',
        matchedBy: 'format',
        correctedPlate: entryFormatValid ? null : incomingPlate,
        entryCharConfidence,
        exitCharConfidence,
      });
      continue;
    }

    // Format didn't disambiguate (both valid or both invalid) — fall back
    // to confidence.
    if (candidate.ownCharConfidence && candidate.ownCharConfidence.length === candidate.plate.length) {
      const entryCharConfidence = candidate.ownCharConfidence[diffIndex]!;
      if (entryCharConfidence === exitCharConfidence) {
        // Exact tie — keep the known/original side, no correction, but
        // still a qualifying match (see plan's "why not a bare no-match
        // on tie").
        matches.push({
          candidate,
          diffIndex,
          winner: 'entry',
          matchedBy: 'confidence',
          correctedPlate: null,
          entryCharConfidence,
          exitCharConfidence,
        });
      } else {
        const exitWins = exitCharConfidence > entryCharConfidence;
        matches.push({
          candidate,
          diffIndex,
          winner: exitWins ? 'exit' : 'entry',
          matchedBy: 'confidence',
          correctedPlate: exitWins ? incomingPlate : null,
          entryCharConfidence,
          exitCharConfidence,
        });
      }
      continue;
    }

    // No usable ownCharConfidence at all — today's original single-sided
    // rule: qualifies only if the incoming reading's own diff character
    // looks like a clear outlier within that same reading.
    const otherCharsMinConfidence = Math.min(
      ...incomingReadQuality.plateCharBelieve.filter((_, index) => index !== diffIndex),
    );
    if (
      exitCharConfidence < MAX_DIFF_CHAR_CONFIDENCE &&
      otherCharsMinConfidence - exitCharConfidence >= MIN_CONFIDENCE_GAP
    ) {
      matches.push({
        candidate,
        diffIndex,
        winner: 'entry',
        matchedBy: 'fallback',
        correctedPlate: null,
        entryCharConfidence: null,
        exitCharConfidence,
      });
    }
  }

  return matches.length === 1 ? matches[0] : undefined;
}
