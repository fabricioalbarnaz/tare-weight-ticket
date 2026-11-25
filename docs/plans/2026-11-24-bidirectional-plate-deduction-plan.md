# Plate-misread deduction: catch a misread *entrance* too, add plate-format validation, treat registered plates as ground truth

**Status:** All steps implemented and verified (Alpine Docker: core-service
`lint`/`typecheck`/`build` clean, `test` 450/452 — the 2 failures are the
already-documented pre-existing cold-start `/health` and `weighing-stream`
flakes, unrelated to this change; admin-ui `typecheck` clean, `test` 50/50
passing, with one unrelated worker-startup flake on `LoginPage.test.tsx` in
that same container run). Not yet deployed to any production install.
Pending user review before deleting this plan file per `CLAUDE.md`'s
workflow.

## Incident that triggered this (2026-11-24)

Ticket #965: entrance read the plate as `RL13H28` (confidence 86%,
per-char `99-98-91-98-90-90-77`) and opened the ticket. ~34 min later the
exit camera read the same truck correctly as `RLI3H28` (confidence 97%,
per-char `99-99-97-99-99-99-97`) — the real plate, confirmed by this
truck's entrance/exit history on every other day. The existing
plate-misread deduction (`findPlateDeductionMatch`,
`apps/core-service/src/tickets/plate-deduction.ts`) only asks "is the
**incoming (exit)** reading's divergent character a clear outlier
*within that same reading*?" It never looks at the entrance reading's own
confidence at all, so it only ever catches the case where the exit was the
one that misread. Here the exit was correct and the entrance was wrong, so
no match was found, no ticket closed, and the reading was discarded
(`no_matching_ticket_for_exit`).

Re-running the existing single-sided outlier check against the entrance
reading *itself* would **not** have caught this either: the entrance's
weakest character was the last digit (77%), not the actually-misread
character at index 2 (91%) — so that character never looks like an
outlier from inside its own reading.

Two independent signals actually resolve this case correctly:
1. **Direct, position-by-position confidence comparison** between the two
   readings: at the differing character, entrance had 91% and exit had
   97% — the exit wins because it's more confident *at that specific
   position*, regardless of whether either reading looks suspicious in
   isolation.
2. **Plate format**: `RL13H28` is `L,L,N,N,L,N,N` — not a valid plate
   under any recognized Brazilian format (position 3 would need to be a
   letter under both the old `LLLNNNN` format and the Mercosul `LLLNLNN`
   format). `RLI3H28` is `L,L,L,N,L,N,N`, which matches the Mercosul
   format exactly. In this real case, the format check alone would have
   resolved it, independent of confidence.

## Decisions confirmed with the user (2026-11-24)

1. **Confidence comparison signal**: compare `plateCharBelieve[diffIndex]`
   between the stored entrance reading and the incoming exit reading —
   the per-character confidence at the one position where the two plates
   differ. Not overall `confidenceLevel`.
2. **No minimum margin** on the confidence comparison: whichever side has
   the higher confidence at that position wins outright, even by a single
   point.
3. **Entrance confidence storage**: a new column on `tickets`, populated
   at entrance-capture time — not a lookup into `raw_events`.
4. **Exact tie in confidence at the differing position**: keep the
   ticket's **original** plate (the one captured at entrance) — don't
   guess, but still close the ticket normally (weigh, signal, print) with
   that plate. This is a deliberate change from the "no match at all"
   default originally proposed — see "Why not a bare no-match on tie"
   below.
5. **Plate-format validation, added on top of confidence comparison**:
   recognize these 5 formats as valid (confirmed with the user,
   2026-11-24) — Brazil old (`LLLNNNN`), Brazil Mercosul (`LLLNLNN`),
   Argentina old (`LLLNNN`), Argentina Mercosul (`LLNNNLL`), Uruguay
   (`LLLNNNN`). **Format validity takes priority over confidence**: if
   exactly one of the two plate strings being compared matches a
   recognized format and the other doesn't, that one wins outright,
   regardless of what the confidence numbers say. Confidence comparison
   (point 1-2 above) only decides when both strings match a recognized
   format, or neither does.
6. **Registered truck plates (active tare) are ground truth**: in the
   internal-truck plate-deduction path, the registered plate is always
   treated as if it had 100% confidence at every character — removing the
   old single-sided outlier check (`<95%` and `>=15pp` gap) for that path
   entirely. The format-priority rule (point 5) and the tie rule (point 4)
   both still apply on top of this — a registered plate only loses to a
   reading if the reading has a valid format that the registered plate's
   stored value lacks (an unlikely data-entry edge case) or on a literal
   100%-vs-100% tie, in which case the registered plate still wins (same
   "keep the known/original side" tie rule as point 4).
7. **Resolution order for an exit reading** (changed from today's code):
   exact tare match, then exact `OPEN` ticket match, then the exit
   re-weigh candidate, **then** tare-plate-deduction, **then**
   `OPEN`-ticket-plate-deduction, then `ANOMALY`. Today's code resolves
   tare (exact *and* deduction together) before ever checking for an
   exact `OPEN` ticket match — now that tare-deduction is far more
   permissive (point 6), that ordering could let a loose tare-deduction
   match steal a reading that actually has an exact, certain `OPEN`-ticket
   match. Both exact checks (tare, then ticket) must fail before either
   deduction (tare, then ticket) is attempted.

### Why not a bare no-match on tie (point 4)

A plain "no match" on a tie reproduces the exact failure this whole
feature line exists to prevent: when deduction is the *only* path that
could resolve an exit reading (no exact ticket, no re-weigh candidate),
returning "no match" makes `hasResolvableExitCandidate` return `false`,
which — per the 2026-11-23 "exit discarded before weighing" feature —
discards the reading entirely **before the scale is even read**: no
weight, no driver signal, no ticket closed, and the original `OPEN`
ticket stays open indefinitely. A tie is rare (both sides would need the
literal same integer percentage at that one position), but when it
happens, "keep the ticket's original plate" at least resolves the truck's
weighing instead of stranding it at the gate — it just doesn't change the
record when there's no basis to decide which side is right.

### Priority order within a single candidate's check (combines points 4-6)

For a candidate/incoming pair with a confirmed single-character
difference (`findSingleCharDifferenceIndex` returns a valid index):

1. Check plate format on both sides. Exactly one valid → that one wins,
   done (no confidence check needed).
2. Both valid or both invalid → compare confidence at the differing
   position (candidate's own stored value — real data for an `OPEN`
   ticket, or a synthetic 100 for a registered tare plate — vs. the
   incoming reading's value).
   - Strictly higher wins.
   - Tie → candidate (the already-known side) wins, no correction.
3. No stored confidence at all for the candidate (only possible for an
   `OPEN` ticket predating this change, or created manually by an admin)
   → fall back to today's existing rule: qualify only if the incoming
   reading's own diff-character confidence is `<95%` and `>=15pp` below
   its own other characters; candidate always wins (no correction) when
   this fallback is what qualifies the match.

## Scope

- Applies to **both** existing plate-deduction call sites: the
  `OPEN`-ticket exit-side deduction (`CLOSED_BY_PLATE_DEDUCTION`) and the
  internal-truck active-tare deduction (`resolveActiveTare`) — now backed
  by one shared matching function instead of two different rules.
- **Only the `OPEN`-ticket side can have its stored plate corrected.** For
  the tare path, the registered plate in `truckConjuntos` is never
  modified by this logic regardless of which "side" the match function
  says won — truck master data isn't something this feature edits. The
  tare call site always uses the registered plate for the ticket, exactly
  like today; the match function's `winner`/`correctedPlate` fields are
  only acted on by the `OPEN`-ticket caller.
- **Does not change entrance-time behavior.** A misread entrance still
  always opens its own new `OPEN` ticket (2026-11-14 no-overwrite rule,
  untouched). The correction here only ever happens when that ticket is
  later closed at exit, never at entrance time.
- No retroactive reconciliation of already-stuck tickets from before this
  change — same precedent as the 2026-11-18 plan.
- `handleEntranceReading`'s use of `resolveActiveTare` (exact + deduction
  combined) is **not reordered** — there's no `OPEN`-ticket conflict to
  guard against on the entrance side (entrance never checks for an
  existing `OPEN` ticket at all, per the no-overwrite rule), so it keeps
  calling the same combined exact-then-deduction lookup it does today,
  just backed by the new shared matching function underneath.
- The exit re-weigh candidate check keeps its current relative priority
  (checked after both exact matches, before either deduction) — the user
  didn't address re-weigh's position specifically; keeping it ahead of
  both deductions because it's an exact-plate match against a `CLOSED`
  ticket, which is more certain than a character-level guess. Flagging
  this as my own default, not an explicit instruction — easy to reorder
  if wrong.

## Steps

### Step 1 — Schema: store the entrance reading's per-character confidence on the ticket

- `apps/core-service/src/db/schema.ts`: add to `tickets`:
  - `entryConfidenceLevel: real('entry_confidence_level')`
  - `entryPlateCharBelieve: text('entry_plate_char_believe')` — JSON-encoded
    `number[]`, same convention as `raw_events.rawPayload`
    (`JSON.stringify`/`JSON.parse` in the repository layer, not a Drizzle
    JSON column type).
- `npm run db:generate --workspace=@tare/core-service` → new
  `0004_*.sql` migration.
- `apps/core-service/src/tickets/repository.ts`:
  - `CreateTicketInput` gains `entryConfidenceLevel?: number | null` and
    `entryPlateCharBelieve?: number[] | null`.
  - `create()` persists them: `entryConfidenceLevel: input.entryConfidenceLevel ?? null`,
    `entryPlateCharBelieve: input.entryPlateCharBelieve ? JSON.stringify(input.entryPlateCharBelieve) : null`.
- `apps/core-service/src/tickets/repository.test.ts`: new assertions that
  `create()` round-trips both fields (set and omitted).

### Step 2 — session-service.ts: populate the new columns at real entrance capture

In the plain entrance-open branch (the `repo.create({...})` that produces
`ticket_opened` — *not* the internal-truck-tare path, which never
produces an `OPEN` ticket that could reach the deduction query), add:

```ts
entryConfidenceLevel: input.readQuality?.confidenceLevel ?? null,
entryPlateCharBelieve: input.readQuality?.plateCharBelieve ?? null,
```

Leave the tare-entrance path and the re-weigh ticket-creation path alone —
neither ever becomes a candidate in `findOpenTicketsEnteredAfter`.

### Step 3 — `domain/plate.ts`: plate-format validator

```ts
/**
 * Recognized plate formats (confirmed with the user, 2026-11-24): Brazil
 * old (LLLNNNN), Brazil Mercosul (LLLNLNN), Argentina old (LLLNNN),
 * Argentina Mercosul (LLNNNLL), Uruguay (LLLNNNN). Used only as a
 * disambiguation signal for plate-misread deduction — see
 * docs/plans/2026-11-24-bidirectional-plate-deduction-plan.md. Never used
 * to reject a camera read outright; `isReliablePlateRead`
 * (camera/normalize.ts) already deliberately doesn't gate on shape.
 */
const PLATE_FORMATS: RegExp[] = [
  /^[A-Z]{3}[0-9]{4}$/,           // Brazil old / Uruguay
  /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/, // Brazil Mercosul
  /^[A-Z]{3}[0-9]{3}$/,           // Argentina old
  /^[A-Z]{2}[0-9]{3}[A-Z]{2}$/,   // Argentina Mercosul
];

export function isValidPlateFormat(plate: string): boolean {
  return PLATE_FORMATS.some((format) => format.test(plate));
}
```

`apps/core-service/src/domain/plate.test.ts`: one case per format (valid)
plus a handful of invalid shapes (including the real `RL13H28` vs.
`RLI3H28` pair from the incident).

### Step 4 — `plate-deduction.ts`: replace with one shared, format-and-confidence-aware matcher

Replace the existing `findPlateDeductionMatch` (both its implementation
and its single-sided threshold logic) with one function serving both
callers — matching the function's own existing docstring intent ("one
source of truth for the threshold logic, never duplicated"), just now
genuinely unified instead of two different rules under one name.

```ts
export interface PlateDeductionCandidate {
  plate: string;
  /**
   * This candidate's own per-character confidence at `plate`'s
   * positions. `undefined` when truly unknown (triggers the single-sided
   * fallback below) — the caller is responsible for supplying a
   * synthetic all-100 array for a source that should be treated as
   * ground truth (e.g. a registered truck plate).
   */
  ownCharConfidence: number[] | undefined;
}

export interface PlateDeductionMatch<T> {
  candidate: T;
  diffIndex: number;
  /** 'entry' = candidate.plate is correct; 'exit' = the incoming reading is correct. Only meaningful to the OPEN-ticket caller — the tare caller always uses candidate.plate regardless (see Scope). */
  winner: 'entry' | 'exit';
  matchedBy: 'format' | 'confidence' | 'fallback';
  correctedPlate: string | null; // set only when winner === 'exit'
  entryCharConfidence: number | null; // null when matchedBy === 'fallback' (no stored data)
  exitCharConfidence: number;
}

export function findPlateDeductionMatch<T extends PlateDeductionCandidate>(
  candidates: T[],
  incomingPlate: string,
  incomingReadQuality: CameraReadQuality | undefined,
): PlateDeductionMatch<T> | undefined
```

Per candidate:
1. `diffIndex = findSingleCharDifferenceIndex(candidate.plate, incomingPlate)`;
   skip if `null`.
2. Skip entirely if `incomingReadQuality` is missing or
   `incomingReadQuality.plateCharBelieve.length !== incomingPlate.length`
   (same precondition as today).
3. **Format check first**: `isValidPlateFormat(candidate.plate)` vs.
   `isValidPlateFormat(incomingPlate)`.
   - Exactly one valid → qualifies, `matchedBy: 'format'`, winner set to
     whichever side is valid.
   - Otherwise (both valid or both invalid) → continue to confidence.
4. **Confidence check** (only reached when format didn't disambiguate):
   - If `candidate.ownCharConfidence` is defined and its length matches
     `candidate.plate.length`: compare
     `candidate.ownCharConfidence[diffIndex]` vs.
     `incomingReadQuality.plateCharBelieve[diffIndex]`.
     - Strictly higher wins, `matchedBy: 'confidence'`.
     - Equal → candidate wins by default (tie rule), `matchedBy: 'confidence'`, `correctedPlate: null`.
   - Else (no usable `ownCharConfidence`) → today's existing single-sided
     rule: qualifies only if
     `incomingReadQuality.plateCharBelieve[diffIndex] < MAX_DIFF_CHAR_CONFIDENCE`
     and `(min of incoming's other chars) - incomingReadQuality.plateCharBelieve[diffIndex] >= MIN_CONFIDENCE_GAP`;
     when it qualifies, `winner: 'entry'`, `matchedBy: 'fallback'`,
     `correctedPlate: null`; otherwise this candidate doesn't qualify at
     all.
5. Same ambiguity rule as today: collect every qualifying candidate,
   return the single match only if **exactly one** qualifies.

`apps/core-service/src/tickets/plate-deduction.test.ts`: rewritten/extended
cases —
- format disambiguates even when confidence alone would've said otherwise
  (construct a case where the "wrong" format string has higher raw
  confidence than the "right" format one, confirm format wins);
- confidence disambiguates when both formats agree (the real incident's
  numbers, 91 vs 97);
- exact tie at the differing position with no format signal → candidate
  wins, `correctedPlate: null`;
- no stored `ownCharConfidence` → today's existing fallback behavior,
  exact same test cases as the current suite;
- synthetic all-100 `ownCharConfidence` (the tare case) → any
  single-character-different incoming reading matches unless the
  incoming reading is also 100% at that position (tie) or the registered
  plate's format is invalid while the incoming one's isn't;
- ambiguous (two qualifying candidates) → no match, for both the
  confidence path and the format path.

### Step 5 — repository.ts: let `close()` correct the plate

- `CloseTicketInput` gains an optional `plate?: string`.
- `close()`'s `.set({...})` includes `plate: input.plate ?? current.plate`.
  Every existing caller that omits `plate` is unaffected.
- `repository.test.ts`: new case — `close()` with `plate` set updates the
  stored plate; existing `close()` tests (no `plate` passed) still pass
  unchanged.

### Step 6 — session-service.ts: reorder `handleExitReading` and rewire both call sites

New cascade inside `handleExitReading` (and mirrored in
`hasResolvableExitCandidate`):

1. `plate === ''` → unreadable (unchanged).
2. **Exact tare match**: `truckRepo.findActiveTareByPlate(plate)` called
   directly (no longer via the combined `resolveActiveTare` for this
   path) → if found, close via tare exactly as today's exact-tare branch.
3. **Exact `OPEN` ticket match**: `repo.findOpenByPlate(plate)` (unchanged
   logic/branch).
4. **Re-weigh candidate** (unchanged logic/branch, same relative
   position).
5. **Tare-plate-deduction**: build `PlateDeductionCandidate[]` from
   `truckRepo.listActiveTares()`, each with
   `ownCharConfidence: Array(tare.plate.length).fill(100)`; call the new
   `findPlateDeductionMatch`. On a match, close via tare using
   `match.candidate.plate` (the registered plate) — **ignore**
   `match.winner`/`match.correctedPlate` entirely, per Scope above.
   Audit action/result kind unchanged (`EXIT_VIA_TARE_BY_DEDUCTION`,
   `ticket_closed_via_tare_by_deduction`).
6. **`OPEN`-ticket plate-deduction**: build `PlateDeductionCandidate[]`
   from `repo.findOpenTicketsEnteredAfter(cutoff)`, each with
   `ownCharConfidence: ticket.entryPlateCharBelieve ? JSON.parse(ticket.entryPlateCharBelieve) : undefined`;
   call `findPlateDeductionMatch`. On a match:
   ```ts
   const ticket = repo.close(match.candidate.id, {
     exitAt: input.weighingFinishedAt,
     exitWeightKg: input.weightKg,
     exitCameraId: input.cameraId,
     exitCaptureFailed: false,
     plate: match.correctedPlate ?? undefined,
   });
   ```
   `CLOSED_BY_PLATE_DEDUCTION` audit payload gains `matchedBy` always, and
   `correctedFromPlate`/`correctedToPlate` only when `match.winner === 'exit'`.
7. `flagAnomaly` (unchanged, last resort).

`handleEntranceReading`'s `resolveActiveTare` usage is untouched
structurally (still exact-then-deduction combined), but internally now
calls the same new `findPlateDeductionMatch` with a synthetic
all-100 `ownCharConfidence` array for the deduction half, so entrance and
exit apply identical tare-deduction logic.

`apps/core-service/src/tickets/session-service.test.ts`: new/updated
tests —
- (a) low entry confidence at the diff index + high-confidence exit
  closes the ticket with `plate` updated and `correctedFromPlate`/`correctedToPlate`
  in the audit log;
- (b) mirror case, entry confidence higher, behaves exactly like today
  (plate unchanged, no corrected fields, `matchedBy: 'confidence'`);
- (c) a tie falls through to closing with the original plate (not
  `ANOMALY`) — new behavior, replaces the old "ambiguous → ANOMALY" test
  for this specific sub-case;
- (d) a candidate ticket with no stored entry confidence still matches
  via the fallback rule (regression check against the existing suite);
- (e) format disambiguation test using plate strings shaped like the real
  incident;
- (f) an exact `OPEN`-ticket match for a plate that also happens to be a
  1-character-different candidate for some registered tare plate now
  resolves via the exact ticket match, not the tare deduction (the
  reordering fix) — regression test for the priority-order change.

### Step 7 — Admin UI: surface the correction when it happened

- `TicketDetailPage.tsx`: the existing deduction banner already reads the
  `closed_by_plate_deduction` audit entry's payload for `misreadPlate`.
  Extend it to also check `payload.correctedFromPlate`/`correctedToPlate`
  and, when present, render an extra line: new i18n key
  `ticketDetail.closedByDeductionPlateCorrected` (both `en.json` and
  `pt-BR.json`), e.g. "the entry plate was corrected from X to Y".
- No change to `TicketTable.tsx`'s badge or `LiveWeighingPanel.tsx` — same
  `ticket_closed_by_deduction` outcome/badge either way; only the detail
  page (which already fetches the full audit log) shows the extra detail.
- `apps/admin-ui/src/api/mocks/fixtures.ts`: add (or extend) a fixture
  ticket whose `closed_by_plate_deduction` audit entry includes
  `correctedFromPlate`/`correctedToPlate`, so mock mode can exercise the
  new banner line.

### Step 8 — Docs

- `docs/plans/2026-09-29-tare-weight-ticket-plan.md` §11: new dated
  subsection "Plate-misread deduction: either side can be the misread one,
  plate-format validation, registered plates as ground truth
  (2026-11-24)" — the incident, the format-then-confidence priority rule,
  the tie rule, the ground-truth treatment of registered plates, and the
  resolution-order fix.
- `docs/runbooks/known-ticket-failure-patterns.md`: note that the
  2026-11-18 fix only covered a misread *exit*; this closes the symmetric
  gap (misread *entrance*) found in production via ticket #965
  (2026-11-24), and adds plate-format validation as a second, independent
  disambiguation signal.
- `CLAUDE.md`: new dated "Project status" entry once implemented and
  verified, matching the style of the existing entries.

## Verification

Per `CLAUDE.md`'s per-workspace rule:
- `core-service` (Steps 1-6): Alpine Docker one-liner —
  `lint`/`typecheck`/`test`/`build` — authoritative for this workspace.
- `admin-ui` (Step 7): native `typecheck`/`test`.
- Manual: mock-mode browser check that the new detail-page line renders
  for the new fixture ticket.

## Progress

- [x] Step 1 — schema + migration (`0004_tidy_ares.sql`) + repository `CreateTicketInput`
- [x] Step 2 — `session-service.ts` populates the new columns at entrance
- [x] Step 3 — `isValidPlateFormat` + tests
- [x] Step 4 — unified `findPlateDeductionMatch` + tests
- [x] Step 5 — `close()` accepts an optional `plate` override + tests
- [x] Step 6 — reorder `handleExitReading` + rewire both call sites + tests
- [x] Step 7 — Admin UI detail-page banner line + fixture (+ a test, beyond the plan's manual-check-only verification)
- [x] Step 8 — docs (master plan §5/§11, runbook, CLAUDE.md)

All steps done. Per `CLAUDE.md`'s workflow, delete this plan file once the
user has reviewed the work (it's a working document, not permanent
documentation — the master plan §11 subsection above is the permanent
record).
