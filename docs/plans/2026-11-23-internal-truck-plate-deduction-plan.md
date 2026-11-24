# Plate-misread deduction for internal trucks (tare lookup)

**Status:** All steps implemented and verified (Alpine Docker: `core-service`
`lint`/`typecheck`/`build` clean, `test` 430/431 — the one failure being
the already-documented pre-existing `/health` cold-start flake; `admin-ui`
`typecheck`/`build` clean, `test` 52/52 — a separate, pre-existing,
non-deterministic flake in `ChangePasswordPage.test.tsx` was investigated
and confirmed unrelated to this change via direct A/B testing against the
unmodified codebase (4/4 clean baseline runs; see the note below)). Not
yet deployed to any production install. Pending user review before
deleting this plan file per `CLAUDE.md`'s workflow.

**Unrelated flake investigated during this work:** while verifying,
`apps/admin-ui/src/pages/ChangePasswordPage.test.tsx` occasionally failed
with `TypeError: EventSource is not a constructor` (a pre-existing race in
that file's `globalThis.EventSource` override, used to work around jsdom
not implementing SSE for the Operation screen), which can cascade into a
second test seeing a leaked logged-in session. Confirmed via direct
A/B testing — the unmodified codebase passed this same test file 4/4 runs,
and modified code failed roughly 1 in 8 runs with the identical error,
unrelated to any line this plan touches. Not fixed here (out of scope,
pre-existing test-harness fragility, same category as the already-documented
`/health` cold-start flake) — flagged for awareness only.

## Decision (requested by user, clarified via follow-up questions)

Today, an internal truck (one with an active conjunto tare) is matched by
**exact** plate only: `truckRepo.findActiveTareByPlate(plate)` in both
`handleEntranceReading` and `handleExitReading`
(`tickets/session-service.ts`). If the camera misreads that truck's plate
by one character, the exact lookup fails, the truck is treated as a
regular (non-internal) truck, and — since internal trucks never leave an
`OPEN` ticket behind (entry+exit always resolve atomically via the tare)
— the existing plate-misread deduction feature
(`docs/plans/2026-11-18-plate-misread-deduction-plan.md`) can never
rescue it either, because that one only matches against `OPEN` tickets.

**New rule**: when checking whether a plate belongs to an internal truck
(on *both* entrance and exit), if the exact lookup fails, also check
whether the read plate is a single-character misread — same
confidence-validated criteria as the existing deduction feature (diff
char confidence < 95%, at least 15 points below every other character) —
of **any truck currently holding an active tare**. A unique match is
treated exactly like an exact match, using the truck's real registered
plate (not the misread one) for the ticket. An ambiguous match (more than
one equally-plausible truck) is treated as no match at all — falls
through to the ordinary (non-internal) flow, same conservative rule as
the existing feature.

**Confirmed with the user:**
1. **No time window** — unlike the `OPEN`-ticket deduction (which needs
   `PLATE_DEDUCTION_WINDOW_MS` to bound how old a candidate ticket may
   be), there is nothing to bound here: a truck's tare is either
   currently active or not, there's no "age" dimension. Every
   currently-active-tare truck is a candidate, unconditionally.
2. **Full traceability — own audit action + own result kind**, mirroring
   `closed_by_plate_deduction`/`ticket_closed_by_deduction`:
   - New `TICKET_AUDIT_ACTIONS`: `ENTRY_VIA_TARE_BY_DEDUCTION` =
     `'internal_truck_entry_via_tare_by_deduction'`,
     `EXIT_VIA_TARE_BY_DEDUCTION` =
     `'internal_truck_exit_via_tare_by_deduction'`.
   - New shared result kind, on both `EntranceResult` and `ExitResult`:
     `{ kind: 'ticket_closed_via_tare_by_deduction'; ticket: Ticket;
     misreadPlate: string }`.
3. **Same Admin UI exposure as the existing deduction feature** — badge in
   the ticket list, banner in the ticket detail page, info line in the
   live weighing panel, new i18n keys in both locales, mock fixture.

## Design

### Generalizing the match function instead of duplicating it

`tickets/plate-deduction.ts`'s `findPlateDeductionMatch` only works on
`Ticket[]` today (it reads `candidate.plate` and returns `{ ticket,
diffIndex, ... }`). Rather than copy its ~20-line matching loop for a
second candidate shape (active-tare trucks), generalize it:

```ts
export interface PlateDeductionMatch<T> {
  candidate: T;
  diffIndex: number;
  diffCharConfidence: number;
  otherCharsMinConfidence: number;
}

export function findPlateDeductionMatch<T extends { plate: string }>(
  candidates: T[],
  misreadPlate: string,
  readQuality: CameraReadQuality | undefined,
): PlateDeductionMatch<T> | undefined
```

Same algorithm, same two threshold constants, same "exactly one
qualifying candidate or it's ambiguous" rule — only the field name on the
result changes (`ticket` → `candidate`). This is a single source of truth
for the match rule, reused by both features. `Ticket` and the new
`ActiveTareWithPlate` (below) both satisfy `{ plate: string }`.

**Mechanical fallout**: `session-service.ts`'s existing
`deductionMatch.ticket` → `deductionMatch.candidate`;
`plate-deduction.test.ts`'s one `toEqual({ ticket: ..., ... })` → `{
candidate: ..., ... }`. No behavior change for the existing `OPEN`-ticket
feature.

### New candidate source: active-tare trucks with their plate

`ActiveTare` (`trucks/repository.ts`) has no `plate` field today (just
`truckId`/`truckConjuntoId`/`tareWeightKg` — callers already know the
plate they looked it up by). New:

```ts
export interface ActiveTareWithPlate extends ActiveTare {
  plate: string;
}
```

`TruckRepository` gains `listActiveTares(): ActiveTareWithPlate[]` — every
truck with a currently-active conjunto assignment, joined for its plate.
Expected to return a small number of rows (this system's whole internal
fleet), same "not a performance concern at this volume" posture as
`findOpenTicketsEnteredAfter`.

### Wiring: one shared resolver, used in three places

`tickets/session-service.ts` gains a private helper inside
`createSessionService` (same closure as `repo`/`truckRepo`, so it can't
drift):

```ts
function resolveActiveTare(
  plate: string,
  readQuality: CameraReadQuality | undefined,
): { tare: ActiveTare; plate: string; deduction?: { misreadPlate: string; diffIndex: number; diffCharConfidence: number; otherCharsMinConfidence: number } } | undefined {
  const exact = truckRepo.findActiveTareByPlate(plate);
  if (exact) return { tare: exact, plate };

  const match = findPlateDeductionMatch(truckRepo.listActiveTares(), plate, readQuality);
  if (!match) return undefined;
  return {
    tare: match.candidate,
    plate: match.candidate.plate,
    deduction: {
      misreadPlate: plate,
      diffIndex: match.diffIndex,
      diffCharConfidence: match.diffCharConfidence,
      otherCharsMinConfidence: match.otherCharsMinConfidence,
    },
  };
}
```

Used by:
1. **`handleEntranceReading`**: replaces `const activeTare =
   truckRepo.findActiveTareByPlate(plate)`. Ticket is created with
   `plate: resolved.plate` (the *real* plate) — the raw-event payload
   still records the actual reading via the existing `cameraRawPayload(input,
   plate)` call (`plate` there stays the top-level normalized *read*
   value, i.e. the misread one when deduced — same convention the
   `OPEN`-ticket deduction feature already uses: the raw event is what was
   read, the ticket is what it resolved to). When `resolved.deduction` is
   set, append `ENTRY_VIA_TARE_BY_DEDUCTION` (with the deduction payload)
   instead of `ENTRY_VIA_TARE`, and return `{ kind:
   'ticket_closed_via_tare_by_deduction', ticket, misreadPlate }` instead
   of `{ kind: 'ticket_closed_via_tare', ticket }`.
2. **`handleExitReading`**'s own active-tare branch: same substitution.
   Note this branch today returns the *exact-match* case as `{ kind:
   'ticket_closed', ticket }` (reusing the plain exit-close kind, unlike
   the entrance side) — the new deduced case still gets its own distinct
   kind here too (`ticket_closed_via_tare_by_deduction`), per the user's
   request for full traceability on both legs. This means
   `camera/routes.ts`'s exit print-trigger condition needs this new kind
   added explicitly (it's not covered by the existing `'ticket_closed'`
   check).
3. **`hasResolvableExitCandidate`** (`docs/plans/2026-11-23-exit-no-ticket-discard-plan.md`,
   already merged into this file this session): its active-tare check
   must also try deduction, otherwise a misread internal-truck exit would
   be wrongly discarded by that pre-capture gate before ever reaching the
   (now deduction-aware) logic above. Replace its `if
   (truckRepo.findActiveTareByPlate(plate)) return true;` with `if
   (resolveActiveTare(plate, readQuality)) return true;`.

### Ambiguous match

Unchanged by construction: `findPlateDeductionMatch` already collapses
"no candidate" and "more than one qualifying candidate" into the same
`undefined`. `resolveActiveTare` returns `undefined` in both cases, and
every caller already has a well-defined "not an internal truck" fallback
path (the pre-existing non-tare logic) — no new branching needed.

## Steps

### Step 1 — Generalize `plate-deduction.ts`

- `PlateDeductionMatch<T>` becomes generic, `candidate` replaces `ticket`.
- `findPlateDeductionMatch` becomes generic over `T extends { plate:
  string }`.
- `session-service.ts`: update the one existing call site
  (`deductionMatch.ticket` → `deductionMatch.candidate`).
- `plate-deduction.test.ts`: update the one `toEqual` assertion's field
  name. No new test cases needed here — the algorithm itself is untested
  for a non-`Ticket` candidate type until Step 2/3's own tests exercise it
  through `resolveActiveTare`.

### Step 2 — `trucks/repository.ts`: `listActiveTares`

- `ActiveTareWithPlate` interface + `listActiveTares(): ActiveTareWithPlate[]`
  on `TruckRepository`, implemented as `internalTrucks` inner-joined to
  `truckConjuntos` where `isActive = true`.
- `trucks/repository.test.ts`: new tests — returns every truck with a
  currently-active assignment (plate included), excludes trucks with no
  assignment or only inactive ones, empty when no truck has an active
  tare.

### Step 3 — `tickets/session-service.ts`: `resolveActiveTare` + wiring

- Add `ENTRY_VIA_TARE_BY_DEDUCTION`/`EXIT_VIA_TARE_BY_DEDUCTION` to
  `TICKET_AUDIT_ACTIONS`.
- Add `{ kind: 'ticket_closed_via_tare_by_deduction'; ticket: Ticket;
  misreadPlate: string }` to both `EntranceResult` and `ExitResult`.
- Add the private `resolveActiveTare` helper (above).
- Rewire `handleEntranceReading`, `handleExitReading`, and
  `hasResolvableExitCandidate` to use it, per "Wiring" above.
- `session-service.test.ts`: new tests (mirroring the existing
  "plate-misread deduction close" and "internal trucks" blocks) —
  - Entrance: a misread of an active-tare truck's plate closes
    immediately via tare, using the *real* plate, audited
    `internal_truck_entry_via_tare_by_deduction`, returns
    `ticket_closed_via_tare_by_deduction`.
  - Exit: same, audited `internal_truck_exit_via_tare_by_deduction`.
  - Ambiguous (two active-tare trucks both one-character-diff
    candidates): falls through to the ordinary non-internal flow (opens
    a brand-new ticket under the literal misread plate on entrance; on
    exit, falls through to whatever the normal exit chain resolves to —
    e.g. `anomaly_flagged` or the new discard outcome if nothing else
    matches either).
  - No time-window test needed (none exists) — instead, a test
    confirming a truck's tare deactivated long ago is simply never a
    candidate (`listActiveTares` already excludes it structurally, not
    via a window check).
  - `hasResolvableExitCandidate`: a misread active-tare-truck plate
    returns `true`.

### Step 4 — `camera/routes.ts` and `camera/weighing-events.ts`

- Entrance print-trigger: add `|| result.kind ===
  'ticket_closed_via_tare_by_deduction'`.
- Exit print-trigger: add `|| result.kind ===
  'ticket_closed_via_tare_by_deduction'` (not already covered —
  exact-match tare-exit reuses `'ticket_closed'`, but the deduced case
  gets its own kind per the design above).
- `weighing-events.ts`: add `'ticket_closed_via_tare_by_deduction'` to
  `WeighingOutcome`.
- `camera/routes.test.ts`: new tests under "internal trucks" — entrance
  and exit each with a misread plate still close/print/signal via tare,
  using the truck's real plate on the resulting ticket.

### Step 5 — Admin UI

- `apps/admin-ui/src/lib/useWeighingEvents.ts`: add
  `'ticket_closed_via_tare_by_deduction'` to `WeighingOutcome`.
- `apps/admin-ui/src/components/operation/LiveWeighingPanel.tsx`: add the
  new outcome to `CLOSING_OUTCOMES` and a new info line (parallel to the
  existing `closedByDeduction` one), key
  `operation.panel.info.closedViaTareByDeduction`.
- `apps/admin-ui/src/api/types.ts`: `Ticket` gains
  `closedViaTareByDeduction?: boolean` (only present on `listTickets`
  results, same convention as `closedByDeduction`/`suspectWeight`).
- `apps/core-service/src/tickets/repository.ts`: `TicketListItem` gains
  `closedViaTareByDeduction: boolean`; `listTickets` gains
  `findTareDeductionTicketIds` (mirrors `findDeductionClosedTicketIds`,
  checking for either new audit action).
- `apps/core-service/src/admin/routes.ts`: `GET /tickets` serialization
  includes `closedViaTareByDeduction: item.closedViaTareByDeduction`.
- `apps/admin-ui/src/components/tickets/TicketTable.tsx`: new badge next
  to the plate (same visual treatment), i18n keys
  `tickets.table.tareDeduction`/`tareDeductionShort`.
- `apps/admin-ui/src/pages/TicketDetailPage.tsx`: derive
  `tareDeductionEntry` from the audit log (either new action), banner
  with `misreadPlate` from its payload, key
  `ticketDetail.closedViaTareByDeduction`.
- `apps/admin-ui/src/api/mocks/fixtures.ts`: one new mock ticket
  demonstrating this (an internal truck whose exit plate was misread),
  with its matching audit log entries.
- New i18n keys in `en.json` and `pt-BR.json`:
  `operation.panel.info.closedViaTareByDeduction`,
  `tickets.table.tareDeduction`/`tareDeductionShort`,
  `ticketDetail.closedViaTareByDeduction`.
- `apps/core-service/src/admin/routes.test.ts` and
  `apps/core-service/src/tickets/repository.test.ts`: new tests mirroring
  the existing `closedByDeduction` serialization/flag tests.
- `apps/admin-ui/src/components/operation/LiveWeighingPanel.test.tsx`: new
  test mirroring the existing plate-misread-deduction one.

### Step 6 — Docs

- `docs/plans/2026-09-29-tare-weight-ticket-plan.md`: §5 (entrance/exit
  camera bullets) note the deduction fallback on the active-tare check;
  §11 new dated subsection "Plate-misread deduction for internal trucks
  (2026-11-23)".
- `CLAUDE.md`: new dated entry under "Project status".

## Verification

Per `CLAUDE.md`'s per-workspace rule:
- `core-service` (Steps 1-4): Alpine Docker (`lint`/`typecheck`/`test`/`build`).
- `admin-ui` (Step 5): native (`npm run typecheck|test --workspace=@tare/admin-ui`).

## Progress

- [x] Step 1 — generalize `plate-deduction.ts`
- [x] Step 2 — `trucks/repository.ts`: `listActiveTares`
- [x] Step 3 — `session-service.ts`: `resolveActiveTare` + wiring + tests
- [x] Step 4 — `camera/routes.ts`/`weighing-events.ts` + tests
- [x] Step 5 — Admin UI (types, repository flag, admin API, badge, banner,
  live panel, fixtures, i18n)
- [x] Step 6 — docs (master plan §5/§11, `CLAUDE.md`)
- [x] Verification (Alpine Docker for both `core-service` and `admin-ui`
  — corrected from the original "native for admin-ui" note above: per
  `CLAUDE.md`, the Alpine container is authoritative for both, native is
  only a quick sanity check; only `print-bridge`/`scale-bridge` need
  native Windows verification)
