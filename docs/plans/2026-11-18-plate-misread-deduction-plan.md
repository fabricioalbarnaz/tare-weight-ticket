# Auto-close an OPEN ticket by plate-misread deduction instead of filing an ANOMALY

**Status:** All steps implemented and verified (Alpine Docker: `lint`/
`typecheck`/`build` clean; `test` 407/407 passing for `core-service` +
`admin-ui`, the only touched workspaces — the `print-bridge`/`scale-bridge`
test failures in that same run are the pre-existing, already-documented
`/health` container-only flake, unrelated to this change). Not yet
deployed to any production install. Pending user review before deleting
this plan file per `CLAUDE.md`'s workflow.

## Decision (requested by user, 2026-11-18)

Implements the "suggested fix" from
`docs/runbooks/known-ticket-failure-patterns.md`'s "single-character plate
misread" pattern — but **fully automatic**, not merely surfaced as a
suggestion: when an exit reading finds no exact-plate `OPEN` ticket, the
system now also checks for an `OPEN` ticket whose plate is a one-character
misread of this reading, and if the per-character ANPR confidence data
confirms it, **closes that ticket automatically** using this exit's
weight — instead of filing `ANOMALY`. The closed ticket is left with a
visible, auditable "closed by deduction" indicator rather than looking
like an ordinary exit match.

Three parameters confirmed with the user before implementation:
1. **Match criteria**: the validated pattern from the runbook — the
   differing character's `plateCharBelieve` confidence is **below 95%**
   **and** at least **15 percentage points** below every other
   character's confidence in that same reading. This is the exact shape
   of all 5 confidence-backed cases found in the 2026-11-18 runbook
   analysis (69/51/95/68/67% on the wrong character vs. 93–99% on the
   other six) — not a guessed threshold.
2. **Ambiguous match (more than one qualifying `OPEN` candidate)**: do
   **not** auto-close anything — fall through to the normal `ANOMALY`
   path, same as if no deduction match had been attempted.
3. **Eligibility window**: an `OPEN` ticket only qualifies while its
   `entryAt` is within **24h** of the exit reading. Configurable, not
   hardcoded (`PLATE_DEDUCTION_WINDOW_MS`), matching the existing
   `EXIT_REWEIGH_WINDOW_MS`/`CAMERA_DUPLICATE_PLATE_DEBOUNCE_MS` pattern.

**Explicitly unchanged / out of scope** (confirm before Step 1 if any of
this is wrong):
- The two tickets already stuck in production today because of this
  exact pattern — **#744** (id 749, plate `RKZ6F83`) open since
  2026-11-17, and **#598** (id 603, plate `IUO8H27`) open since
  2026-11-11 — are **not** touched by this feature (both are already
  well past any reasonable 24h window) and must be fixed by an admin
  manually via the Admin UI, independent of this work.
- Scoped to **same-length, single-character-substitution** misreads
  only (Hamming distance 1 on equal-length plate strings) — not a full
  Levenshtein distance allowing insertions/deletions. Every
  confidence-backed validated case in the runbook is this shape, and it's
  the only shape that maps cleanly onto a single `plateCharBelieve` index.
  A length-mismatched near-match still falls through to `ANOMALY`,
  unchanged.
- Only applies on **exit** reads with no exact-plate `OPEN` ticket,
  mirroring where the runbook's pattern and suggested fix are both
  scoped. Entrance reads are unaffected (per the 2026-11-14 "no
  overwrite" rule, a misread entrance just opens its own new ticket,
  which is a different, already-handled situation).
- A failed weight capture never qualifies for deduction-close (nothing
  new to attribute) — falls straight through to the existing `ANOMALY`
  path, same precedent as the exit re-weigh feature.
- No retroactive reconciliation job for already-stuck OPEN tickets.

## Why

The runbook's investigation (see "Pattern: single-character plate
misread..." in `docs/runbooks/known-ticket-failure-patterns.md`) found
that when a camera's overall plate confidence is high enough to be
accepted (`confidenceLevel >= 80`, 7 characters) but one specific
character's confidence is a clear outlier, that character is reliably the
misread one — 5/5 confirmed cases. This currently still produces a stuck
`OPEN` ticket and a dangling `ANOMALY` ticket, needing manual admin
reconciliation every time (two real examples open in production for 7+
days as of the runbook's writing). Automating the well-confirmed case
removes that manual step for a known, recurring failure mode while
staying conservative (no match on ambiguity, no match without confidence
data, bounded to 24h).

## Risk / tradeoff to flag before starting

This is a deliberate, narrow reversal of the master plan's stated
invariant that "a misread/unreadable plate is never auto-corrected — it
requires an admin." A wrong auto-match here would silently attribute one
truck's exit weight to a different truck's ticket, printing an incorrect
net weight with no human in the loop. The match criteria above are
designed to keep false positives at effectively zero against the data
analyzed so far (100% precision on 5/5 known cases), but that is 5 data
points, not a statistical guarantee. Proceeding as scoped per the user's
explicit decision above — flagging this once, in writing, before Step 1.

## Steps

### Step 1 — Domain helper: single-character difference

`apps/core-service/src/domain/plate.ts`: add
`findSingleCharDifferenceIndex(a: string, b: string): number | null` —
returns the index of the one differing character for two equal-length
strings, or `null` when they're identical, differ in more than one
position, or differ in length. Pure function, easy to unit test
exhaustively (identical, one diff at each position, two diffs, different
lengths).

`apps/core-service/src/domain/plate.test.ts`: new test cases for the
above.

### Step 2 — Matching function

New file `apps/core-service/src/tickets/plate-deduction.ts`:

```ts
export interface PlateDeductionMatch {
  ticket: Ticket;
  diffIndex: number;
  diffCharConfidence: number;
  otherCharsMinConfidence: number;
}

export function findPlateDeductionMatch(
  candidates: Ticket[],
  misreadPlate: string,
  readQuality: CameraReadQuality | undefined,
): PlateDeductionMatch | undefined
```

- Returns `undefined` immediately if `readQuality` is missing or
  `readQuality.plateCharBelieve.length !== misreadPlate.length` (no
  confidence data to validate against — predates the confidence feature,
  or malformed).
- For each candidate, calls `findSingleCharDifferenceIndex(candidate.plate,
  misreadPlate)`; skips candidates where it returns `null`.
- For a candidate with a diff index, checks:
  `plateCharBelieve[diffIndex] < 95` **and**
  `min(every other plateCharBelieve value) - plateCharBelieve[diffIndex] >= 15`.
- Collects all candidates meeting that bar. Returns the single match only
  if **exactly one** qualifies; returns `undefined` for zero or more than
  one (ambiguous — per the user's decision above).
- Document the two threshold constants (`MAX_DIFF_CHAR_CONFIDENCE = 95`,
  `MIN_CONFIDENCE_GAP = 15`) with a comment citing the runbook's validated
  table, same style as `camera/normalize.ts`'s `MIN_CONFIDENCE_LEVEL`
  comment — tune only against further confirmed cases, not speculatively.

`apps/core-service/src/tickets/plate-deduction.test.ts`: unit tests —
exact single qualifying match; two qualifying candidates (ambiguous, no
match); a candidate whose diff char confidence is low but not 15pp below
the others (no match); missing `plateCharBelieve`/length-mismatched
`readQuality` (no match); zero candidates.

### Step 3 — Config

`apps/core-service/src/tickets/config.ts`: add `plateDeductionWindowMs` to
`TicketConfig`, loaded as `PLATE_DEDUCTION_WINDOW_MS` via
`parsePositiveInt`, default `24 * 60 * 60 * 1000` (24h) — same pattern as
`reweighWindowMs`.

### Step 4 — Repository: candidate query

`apps/core-service/src/tickets/repository.ts`: add
`findOpenTicketsEnteredAfter(cutoff: Date): Ticket[]` to `TicketRepository`
— `status = 'OPEN' AND entryAt IS NOT NULL AND entryAt >= cutoff`, ordered
`entryAt desc, id desc`. Document (like the other `find*` methods) that
this anchors the plate-deduction match and is expected to return at most
a handful of rows given this system's volume.

`apps/core-service/src/tickets/repository.test.ts`: new tests — returns
`OPEN` tickets with `entryAt >= cutoff`, excludes older ones, excludes
`CLOSED`/`ANOMALY` tickets, excludes `OPEN` tickets with a null `entryAt`
if that's reachable (defensive, shouldn't occur in practice).

### Step 5 — Wire into `handleExitReading`

`apps/core-service/src/tickets/session-service.ts`:
- Add `CLOSED_BY_PLATE_DEDUCTION: 'closed_by_plate_deduction'` to
  `TICKET_AUDIT_ACTIONS`.
- Add a new `ExitResult` kind:
  `{ kind: 'ticket_closed_by_deduction'; ticket: Ticket; misreadPlate: string }`.
- In the "no `OPEN` ticket for `X`" branch (after the existing re-weigh
  check, before the `flagAnomaly` fallback — exact plate match and exact
  re-weigh match both take priority over a deduced guess): when
  `!input.weightCaptureFailed`, call
  `repo.findOpenTicketsEnteredAfter(new Date(input.weighingFinishedAt.getTime() - ticketConfig.plateDeductionWindowMs))`
  then `findPlateDeductionMatch(candidates, plate, input.readQuality)`.
  - On a match: `repo.close(match.ticket.id, { exitAt: weighingFinishedAt,
    exitWeightKg: weightKg, exitCameraId: cameraId, exitCaptureFailed:
    false })`, append `CLOSED_BY_PLATE_DEDUCTION` audit log on the closed
    ticket with payload `{ misreadPlate, diffIndex, diffCharConfidence,
    otherCharsMinConfidence, weightKg, cameraId, attemptsUsed }`, record
    the usual `camera_exit`/`scale` raw events linked to that ticket id,
    return `{ kind: 'ticket_closed_by_deduction', ticket, misreadPlate:
    plate }`.
  - No match: fall through to the existing `flagAnomaly` call, unchanged.

`apps/core-service/src/tickets/session-service.test.ts`: new tests
mirroring the existing re-weigh test block — a qualifying `OPEN` ticket
within the window gets closed with the right weight/net weight and audit
entry; outside the window falls through to `ANOMALY`; ambiguous (two
qualifying candidates) falls through to `ANOMALY`; a failed capture always
falls through to `ANOMALY` regardless of a qualifying candidate existing.

### Step 6 — Wire the new `ExitResult` kind everywhere it's switched on

- `apps/core-service/src/camera/routes.ts`: the print-trigger condition
  (currently `result.kind === 'ticket_closed' || result.kind ===
  'ticket_reweighed'`) also includes `'ticket_closed_by_deduction'` — the
  ticket is genuinely `CLOSED` at this point and the truck has already
  left, same as the re-weigh case. Driver signal needs no change (already
  fires for any non-`plate_unreadable`, non-`weightCaptureFailed` result
  via the existing `else` branch).
- `apps/core-service/src/camera/weighing-events.ts`: add
  `'ticket_closed_by_deduction'` to `WeighingOutcome`.
- `apps/core-service/src/camera/routes.test.ts`: new test asserting the
  deduction-close path prints and signals the driver, same shape as the
  existing re-weigh test.

### Step 7 — Admin UI: live panel

- `apps/admin-ui/src/lib/useWeighingEvents.ts`: add
  `'ticket_closed_by_deduction'` to `WeighingOutcome`.
- `apps/admin-ui/src/components/operation/LiveWeighingPanel.tsx`: add
  `'ticket_closed_by_deduction'` to `CLOSING_OUTCOMES` (renders as a
  success, not an alert — the ticket really is closed) **and** add a
  non-alert informational line under the ticket table specifically for
  this outcome (parallel to the existing `alert &&
  closedNeedsAttention` line, but amber/info-toned, always shown for this
  outcome regardless of `alert`): new key
  `operation.panel.info.closedByDeduction`.
- `apps/admin-ui/src/components/operation/LiveWeighingPanel.test.tsx`: new
  test for this outcome rendering the success state + the info line.

### Step 8 — Admin UI: ticket list badge

- `apps/admin-ui/src/api/types.ts`: add `closedByDeduction?: boolean` to
  `Ticket`, documented the same way as `suspectWeight` ("only present on
  tickets returned by `listTickets`").
- `apps/core-service/src/tickets/repository.ts`: `listTickets` gains a
  `findDeductionClosedTicketIds` helper mirroring the existing
  `findSuspectTicketIds` (scans `ticketAuditLog` for `action ===
  'closed_by_plate_deduction'` among the listed ticket ids), and
  `TicketListItem` gains `closedByDeduction: boolean`.
- `apps/core-service/src/admin/routes.ts`: `GET /tickets` serialization
  includes `closedByDeduction: item.closedByDeduction` alongside the
  existing `suspectWeight`.
- `apps/admin-ui/src/components/tickets/TicketTable.tsx`: a small badge
  next to the plate, same visual treatment as the existing `reweigh`
  badge (`tickets.table.deduction`/`deductionShort` i18n keys).
- `apps/admin-ui/src/api/mocks/fixtures.ts`/`handlers.ts`: add one fixture
  ticket with `closedByDeduction: true` so the mock-mode UI and any
  snapshot-style tests can exercise the badge.

### Step 9 — Admin UI: ticket detail banner

`apps/admin-ui/src/pages/TicketDetailPage.tsx`: no backend field needed
here — the full `auditLog` is already fetched for this page. Derive
directly: `const deductionEntry = auditLog.find((e) => e.action ===
'closed_by_plate_deduction')`. When present, render an amber info banner
(same visual treatment as the existing `reweighOf`/`reweighedBy` banners)
using the entry's payload: `t('ticketDetail.closedByDeduction', { misreadPlate:
payload.misreadPlate })`, linking to nothing further (no second ticket
to cross-reference — the `ANOMALY` leg this exit would otherwise have
created never exists at all, since the match replaces it before any
ticket is written).

New i18n keys in both `apps/admin-ui/src/i18n/locales/en.json` and
`pt-BR.json`: `tickets.table.deduction`/`deductionShort`,
`ticketDetail.closedByDeduction`,
`operation.panel.info.closedByDeduction`.

### Step 10 — Docs

- `docs/plans/2026-09-29-tare-weight-ticket-plan.md`:
  - §5 "Exit camera fires" bullet: add the new branch between the
    existing "open ticket exists" and "no open ticket → ANOMALY" cases,
    cross-referencing the new §11 subsection.
  - §11: new dated subsection "Plate-misread deduction close
    (2026-11-18)", mirroring the "Exit re-weigh (2026-11-12)" subsection's
    structure (decision, where it lives, config, Admin UI, explicitly out
    of scope, link to this plan file for deletion).
- `docs/runbooks/known-ticket-failure-patterns.md`: update the "Suggested
  fix, not yet implemented" paragraph to record that it's now implemented
  (date, and that it auto-closes rather than merely surfacing a
  suggestion — note the deliberate deviation from the runbook's original
  wording), and that tickets #744/#598 still need manual correction
  (unaffected by this feature, per the scope above).
- `CLAUDE.md`: new dated entry under "Project status" once implemented
  and verified, following the existing style of the other dated entries
  (e.g. "Exit re-weigh correction (2026-11-12)").

## Verification

Per `CLAUDE.md`'s per-workspace rule:
- `core-service` (Steps 1-6): verify via the Alpine Docker one-liner
  (`lint`, `typecheck`, `test`) — authoritative environment for this
  workspace.
- `admin-ui` (Steps 7-9): native (`npm run typecheck|test
  --workspace=@tare/admin-ui`).
- Manual check in the browser (mock mode, `VITE_API_MODE=mock`, using the
  new fixture ticket): the badge renders in the ticket list, the detail
  banner renders with the right text, and the live panel's info line
  renders for a simulated `ticket_closed_by_deduction` event.

## Progress

- [x] Step 1 — domain helper (`findSingleCharDifferenceIndex`) + tests
- [x] Step 2 — matching function (`plate-deduction.ts`) + tests
- [x] Step 3 — config (`PLATE_DEDUCTION_WINDOW_MS`)
- [x] Step 4 — repository (`findOpenTicketsEnteredAfter`) + tests
- [x] Step 5 — `handleExitReading` wiring + tests
- [x] Step 6 — `routes.ts`/`weighing-events.ts` wiring + tests
- [x] Step 7 — Admin UI live panel
- [x] Step 8 — Admin UI ticket list badge
- [x] Step 9 — Admin UI ticket detail banner
- [x] Step 10 — docs (master plan §5/§11, runbook, CLAUDE.md)

Verification not yet run — see below.
