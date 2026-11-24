# Discard an exit reading with no resolvable ticket, before capturing weight

**Status:** All steps implemented and verified (Alpine Docker: `lint`/
`typecheck`/`build` clean; `test` 418/418 passing for `core-service`, the
only touched workspace — one run hit the already-documented pre-existing
`/health` cold-start flake, unrelated, which passed clean on re-run). Not
yet deployed to any production install. Pending user review before
deleting this plan file per `CLAUDE.md`'s workflow.

## Decision (requested by user, 2026-11-23, clarified via follow-up questions)

Today, an exit camera reading always triggers a scale weight capture
first (`scaleClient.readStableWeight`, in `camera/routes.ts`), *then*
`handleExitReading` decides what to do with it: exact `OPEN` ticket match,
then exit re-weigh correction (`docs/plans/2026-11-12-exit-reweigh-plan.md`),
then plate-misread deduction close
(`docs/plans/2026-11-18-plate-misread-deduction-plan.md`), and only if none
of those apply, `flagAnomaly` creates an `ANOMALY` ticket.

New rule, confirmed with the user point by point:

1. **Order**: re-weigh correction and plate-misread deduction keep running
   exactly as today and keep first priority. The new behavior is only the
   *final* fallback — it replaces what happens when **none** of exact
   match / re-weigh / deduction resolves to a ticket.
2. **No `ANOMALY` ticket for this case**: when nothing resolves, the system
   no longer creates an `ANOMALY` ticket. It only logs the event and
   discards it — no ticket of any kind. This does **not** remove the
   `ANOMALY` ticket type, its Admin UI screens, or its filters from the
   system; it is still used for every other case that already produces one
   today (chiefly: a candidate *was* found by this same check, but the
   actual weight capture afterward fails — see "Still reachable" below).
3. **Mechanism**: log it the same way the existing discard cases do — a
   `raw_events` row via `recordRawEvent('camera_exit', ...)` with a new
   `discarded` reason, following the exact pattern of
   `'duplicate_plate_read'` / `'preempted_by_new_plate'` /
   `'post_release_debounce'`.
4. **"Valid plate"**: means a plate that already passed the existing
   `isReliablePlateRead` confidence gate (currently `confidenceLevel >=
   70`) — i.e. `event.rawPlate !== ''` in `camera/routes.ts`'s normalized
   event. An unreliable/unreadable plate is untouched by this change; it
   keeps going through the existing `plate_unreadable` path.
5. **Before the weight-capture job**: the check must run *before*
   `scaleClient.readStableWeight` is even called, not after. The truck is
   never put through a weighing that cannot be attributed to any ticket.

### Why this is safe to check before capturing weight

Re-weigh/deduction candidate lookup never actually needs the captured
weight — only the *existence* of a candidate does:
- Exact match: `repo.findOpenByPlate(plate)` — plate only.
- Re-weigh: `repo.findMostRecentClosedTicketByPlate(plate)` + a window
  check against `exitAt` — plate + clock only.
- Deduction: `findPlateDeductionMatch` against
  `repo.findOpenTicketsEnteredAfter(...)` — plate + the camera's own ANPR
  confidence data (`readQuality`), already available from the webhook
  payload, no weight involved.
- Internal truck (active tare): `truckRepo.findActiveTareByPlate(plate)` —
  plate only; this exit always resolves via the tare regardless of any
  `OPEN` ticket, so it must never be discarded by this new rule.

So a read-only "does *any* candidate exist" check can run with the same
information available pre-capture, mirroring (not re-implementing from
scratch) the exact decision tree `handleExitReading` already uses.

### What happens if the check says "yes, proceed" but the capture then fails

Unchanged, and this is *why* `ANOMALY` isn't removed from the system: if
the pre-check found a re-weigh or deduction candidate but the actual
capture then fails, `handleExitReading` already treats a failed capture as
disqualifying for both of those branches (`input.weightCaptureFailed ?
undefined : ...`) and falls through to `flagAnomaly`, same as today. Only
the specific "zero candidates found at all" case changes — that one can no
longer reach a capture attempt in the first place.

**Explicitly unchanged / out of scope:**
- Entrance readings — untouched, this is exit-only (the entrance rule is
  already "always open a new ticket", there is no equivalent dead end).
- An ambiguous plate-misread match (more than one qualifying candidate) —
  `findPlateDeductionMatch` already collapses "no candidate" and
  "ambiguous" into the same `undefined` return, so this was already
  indistinguishable from "no match" before this change; no special-casing
  added or removed.
- Admin UI, i18n, Admin API serialization — no change. `ANOMALY` as a
  ticket status/screen/filter is untouched; this change only prevents one
  specific *new* `ANOMALY` ticket from ever being created, and only in the
  one scenario above.
- No retroactive handling of anything already in `ANOMALY` today.

## Steps

### Step 1 — `session-service.ts`: expose a read-only candidate check

Add to the `SessionService` interface:

```ts
hasResolvableExitCandidate(
  rawPlate: string,
  readQuality: CameraReadQuality | undefined,
  now: Date,
): boolean;
```

Implement inside `createSessionService` (same closure as `repo`/`truckRepo`/
`ticketConfig`, so it can't drift from the real decision tree's data
sources):
- Normalize the plate; `''` → `true` (not applicable, let the existing
  `plate_unreadable` path handle it).
- Active tare → `true`.
- `repo.findOpenByPlate(plate)` → `true`.
- `repo.findMostRecentClosedTicketByPlate(plate)` within
  `ticketConfig.reweighWindowMs` of `now` → `true`.
- `findPlateDeductionMatch(repo.findOpenTicketsEnteredAfter(now -
  plateDeductionWindowMs), plate, readQuality)` → `true`.
- Otherwise `false`.

`session-service.test.ts`: new `describe('hasResolvableExitCandidate ...')`
block — true for an exact `OPEN` match, true for a re-weigh candidate in
window / false outside it, true for a unique deduction match / false for
an ambiguous or absent one, true for an active tare with no `OPEN` ticket,
false when nothing matches, true for an empty/unreadable plate.

### Step 2 — `camera/routes.ts`: gate the exit handler before the scale call

New function, same style as `checkPostReleaseDebounce` /
`checkDuplicatePlateRead` / `checkPreempted`:

```ts
function checkNoResolvableExitCandidate(
  options: CameraRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
  event: NormalizedCameraEvent,
  triggeredAt: Date,
): boolean
```

- Returns `false` immediately when `event.rawPlate === ''`.
- Returns `false` when `options.sessionService.hasResolvableExitCandidate(...)`
  is `true`.
- Otherwise: `request.log.warn(...)`, `options.recordRawEvent('camera_exit',
  { rawPlate, cameraId, triggeredAt, discarded: 'no_matching_ticket_for_exit',
  ...event.readQuality })`, `reply.send({ kind: 'reading_no_matching_ticket' })`,
  return `true`.

Wire it into the exit handler only, right after
`checkDuplicatePlateRead(...)` and before
`options.weighingEvents.emitPlateReceived(...)` — same position in the
sequence as the other pre-capture discard checks.

No new fields needed on `CameraRoutesOptions` — `sessionService` is
already there, so no change to `app.ts`'s wiring either.

### Step 3 — `camera/routes.test.ts`

- Update the existing "flags an anomaly when there is no open ticket for
  the plate" test (plate `NOENTR1`) — this exact scenario is the one that
  changes. Replace it with a test asserting: reply is `{ kind:
  'reading_no_matching_ticket' }`, `scaleContexts` stayed empty (no
  capture attempted), `driverSignalCalls` stayed empty, no ticket of any
  status was created for that plate, and a `raw_events` row with
  `discarded: 'no_matching_ticket_for_exit'` exists.
- New test: a re-weigh candidate in window still proceeds through capture
  normally (`ticket_reweighed`), confirming the gate doesn't swallow valid
  candidates.
- New test: a unique plate-misread deduction candidate still proceeds
  (`ticket_closed_by_deduction`), same reasoning.
- New test: an unreliable/unreadable plate with no ticket still returns
  `plate_unreadable`, not the new discard kind (confirms the gate is a
  no-op for this case).
- New test: when a re-weigh candidate exists (gate says proceed) but the
  scale capture then fails, the ticket still ends up `ANOMALY` — confirms
  `ANOMALY` is not removed from the system, only the "zero candidates"
  case changes.
- Confirm (existing tests should already cover this, re-check rather than
  re-write): an internal truck (active tare) with no `OPEN` ticket still
  closes normally on exit, never hitting the new discard path.

### Step 4 — Docs

- `docs/plans/2026-09-29-tare-weight-ticket-plan.md`:
  - §5 "Exit camera fires" bullet list: insert a new sub-bullet between
    the plate-misread-deduction one and "Otherwise, no open ticket for X →
    flag as ANOMALY", narrowing that final bullet to the case where the
    *weight capture itself* then fails despite a re-weigh/deduction
    candidate having been found — the "zero candidates, capture never
    attempted" case moves to the new sub-bullet instead.
  - §11: new dated subsection "Exit reading discarded when no ticket can
    be resolved (2026-11-23)", same structure as the "Exit re-weigh" /
    "Plate-misread deduction close" subsections (decision, why, what's
    still reachable for `ANOMALY`, link to this plan file for deletion).
- `CLAUDE.md`: new dated entry under "Project status", following the
  existing style of the other dated entries.

## Verification

Per `CLAUDE.md`'s per-workspace rule — only `core-service` is touched, so:
Alpine Docker one-liner (`lint`, `typecheck`, `test`, `build`) is
authoritative. Native Windows run skipped (this machine lacks the
Python/VS Build Tools toolchain `better-sqlite3`'s install script needs —
see memory `toolchain-native-install-gap`).

## Progress

- [x] Step 1 — `session-service.ts`: `hasResolvableExitCandidate` + tests
- [x] Step 2 — `camera/routes.ts`: gate wiring
- [x] Step 3 — `camera/routes.test.ts`: updated/new tests (also required
  updating `admin/weighing-stream.test.ts`'s matching exit-anomaly test,
  not anticipated in the original step list — the no-ticket exit scenario
  is also exercised there, confirming it no longer emits any SSE
  narration)
- [x] Step 4 — docs (master plan §5/§11, `CLAUDE.md`)
- [x] Verification via Alpine Docker (`lint`/`typecheck`/`test`/`build`)
