export function normalizePlate(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Index of the single character that differs between two equal-length
 * plates, or `null` when they're identical, differ in more than one
 * position, or differ in length — used only for the ANPR misread-deduction
 * match (docs/plans/2026-11-18-plate-misread-deduction-plan.md). Not a full
 * Levenshtein distance: every confidence-backed misread case validated so
 * far (docs/runbooks/known-ticket-failure-patterns.md) is a same-length
 * single-character substitution, and `plateCharBelieve`'s per-character
 * confidence only maps cleanly onto that shape.
 */
export function findSingleCharDifferenceIndex(a: string, b: string): number | null {
  if (a.length !== b.length) return null;

  let diffIndex: number | null = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (diffIndex !== null) return null;
      diffIndex = i;
    }
  }
  return diffIndex;
}
