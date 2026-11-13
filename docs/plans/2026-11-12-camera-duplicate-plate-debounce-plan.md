# Discard a duplicate same-plate entrance/exit read within a short window

Status: **All steps done (2026-11-12).** Remaining per CLAUDE.md: delete
this file once this change is merged into `main`.
Created: 2026-11-12

## Context

**User request (2026-11-12):** if two entrance reads, or two exit reads,
arrive for the **same plate** within less than 2 minutes (a parametrized
value), the second one must be discarded — logged, but never acted on.

This is a **different** problem from the two debounce/preemption rules
already in place, and doesn't replace either:

- `checkPostReleaseDebounce` (`camera/routes.ts`, see
  `docs/plans/2026-11-03-camera-post-release-debounce-plan.md`) is
  **global and time-anchored, not plate-matched** — it exists specifically
  because a released truck's rollback bounce reads the *other* plate of
  the same articulated rig, so matching on "same plate" was explicitly
  rejected for *that* failure mode (master plan §11, "Post-release camera
  debounce"). That rejection was scoped to the rollback-bounce problem; it
  doesn't mean same-plate matching is wrong in general, and this feature is
  not resurrecting that rejected alternative.
- `checkPreempted` (see
  `docs/plans/2026-11-10-preempt-scale-read-on-new-plate-plan.md`) discards
  an in-progress scale capture when a **different** plate arrives — the
  opposite condition from this feature.

This feature targets a third, distinct symptom: the **same** plate
triggering the same camera (or occasionally the ANPR engine re-emitting a
push for a vehicle still sitting in frame) twice in quick succession —
e.g. a truck idling at the entrance/exit point, or a camera retry that
duplicates a push the system already acted on.

**Interaction with the existing entrance last-write-wins rule** (master
plan §5: "a re-trigger of the same open entrance replaces the record with
the most recent reading"): that rule is unchanged for a retrigger *outside*
this new window, but a retrigger *inside* it is now discarded instead of
overwriting — discarding takes precedence. This needs a one-line
clarification in the master plan's existing bullet (Step 4).

**Interaction with the exit anomaly rule:** a duplicate exit read for a
plate whose ticket the first exit already closed would otherwise raise a
false `ANOMALY` ("exit without a matching open entrance"). This check runs
before the session service is ever called, so it heads that off too.

**Accepted risk (same shape as the post-release debounce's accepted
risk):** a legitimately fast round trip for the same plate inside the
window would also be discarded. Default is the user's requested 2 minutes;
kept as an env var specifically so it can be tuned (or shortened) without a
code change if that turns out to matter at this site's actual traffic.

## Decisions

- **Scoped per plate, per direction**: an entrance read only debounces
  against the *previous entrance* for that same plate; an exit read only
  against the *previous exit* for that same plate. Cross-direction
  (entrance vs. exit) never debounces each other — that is the existing
  entry/exit matching business rule's job, not this one's.
- Compared against the **most recent `entryAt`/`exitAt` recorded for that
  plate across all tickets**, not just the currently open one — so a
  stray duplicate arriving just after a ticket already closed is still
  caught, same as a duplicate against a still-open ticket's entrance.
- An **unreadable plate (`rawPlate === ''`) never debounces and is never
  debounced against** — nothing reliable to match, same exception as
  `checkPreempted`. Two consecutive unreadable reads both proceed as
  today (queue at the scale as usual).
- Checked **after** `checkPostReleaseDebounce` (global check first) and
  **before** `emitPlateReceived`/`scaleClient.readStableWeight`/
  `driverSignalAdapter.signalDriver` — a discarded duplicate must not
  flicker the live weighing panel, pay the scale-stability wait, or touch
  the driver signal.
- Default window **120000ms (2 minutes)**, configurable via a new
  `CAMERA_DUPLICATE_PLATE_DEBOUNCE_MS` env var, same pattern as
  `CAMERA_POST_RELEASE_DEBOUNCE_MS`.
- A discarded duplicate is still written to `raw_events` (source
  `camera_entrance`/`camera_exit`, payload flagged
  `discarded: 'duplicate_plate_read'` plus the measured gap), but never
  touches `tickets` or `ticket_audit_log`, and is not linked to a ticket —
  matching both existing discard paths. Also logged via `request.log.warn`
  (plate, cameraId, direction, gap).
- New outcome kind at the route layer: `reading_duplicate` (distinct from
  `reading_debounced` and `reading_preempted` so the three discard paths
  stay distinguishable in logs/`raw_events`).

## Step 1 — `tickets/repository.ts`

Status: **done.**

- Add two methods to `TicketRepository`:
  - `findMostRecentEntryAtByPlate(plate: string): Date | null`
  - `findMostRecentExitAtByPlate(plate: string): Date | null`
  Both mirror `findMostRecentExitAt` but add `eq(tickets.plate, plate)` to
  the `where` and select/order by `entryAt`/`exitAt` respectively (`IS NOT
  NULL`, `ORDER BY ... DESC`, `LIMIT 1`).
- `repository.test.ts`: null on an empty DB and when the plate has no
  ticket; returns the latest `entryAt`/`exitAt` for that plate when
  multiple tickets exist for it (including across a closed-then-reopened
  history); unaffected by other plates' tickets.

## Step 2 — `camera/config.ts`

Status: **done.**

- Add `duplicatePlateDebounceMs: number` to `CameraConfig`, env var
  `CAMERA_DUPLICATE_PLATE_DEBOUNCE_MS`, default `120000`, via the existing
  `parsePositiveInt` helper — same pattern as `postReleaseDebounceMs`.
- Extend `camera/config.test.ts` with the new default/override/invalid
  cases.

## Step 3 — `camera/routes.ts` + `app.ts`

Status: **done.**

- `CameraRoutesOptions` gains `duplicatePlateDebounceMs: number`,
  `getMostRecentEntryAtByPlate: (plate: string) => Date | null`, and
  `getMostRecentExitAtByPlate: (plate: string) => Date | null`.
- New `checkDuplicatePlateRead` function, modeled on
  `checkPostReleaseDebounce`: takes the direction, event, and
  `triggeredAt`; returns `false` immediately if `event.rawPlate === ''`;
  otherwise reads the matching-direction getter, computes the gap, and —
  if within `duplicatePlateDebounceMs` — logs, records the raw event
  (`discarded: 'duplicate_plate_read'`), replies
  `{ kind: 'reading_duplicate' }`, and returns `true`.
- Call it in both handlers right after `checkPostReleaseDebounce` and
  before `emitPlateReceived`.
- `app.ts`: wire `duplicatePlateDebounceMs` from `cameraConfig` and the two
  new getters from `repo.findMostRecentEntryAtByPlate`/
  `repo.findMostRecentExitAtByPlate`.
- `routes.test.ts` new cases (a `duplicate plate debounce` describe
  block), mirroring the post-release debounce tests:
  - A second entrance for the same plate inside the window is discarded
    (scale/driver-signal/session-service mocks never called; a
    `duplicate_plate_read` raw event recorded).
  - A second exit for the same plate inside the window is discarded the
    same way, including the case where the first exit already closed the
    ticket (would otherwise raise a false anomaly).
  - A different plate is never debounced by another plate's recent
    read.
  - An entrance does not debounce against a prior *exit* for the same
    plate, or vice versa (direction-scoped).
  - Two consecutive unreadable-plate reads both process normally (not
    debounced).
  - A read after the window has passed processes normally (backdate the
    prior ticket's `entryAt`/`exitAt` rather than sleeping the test).

## Step 4 — Update documentation

Status: **done.**

- Master plan §5: clarify the existing "last-write-wins" bullet (a
  retrigger *inside* the new window is discarded, not overwritten) and add
  a bullet for the new same-plate/same-direction debounce, right beside
  the post-release debounce bullet, explicitly distinguishing the two
  (global+time vs. per-plate+per-direction).
- Master plan §11: new "Same-plate duplicate camera read debounce
  (2026-11-12)" subsection — symptom, the two existing checks it's
  distinct from, decision, and the accepted fast-round-trip risk.
- `CLAUDE.md` "Project status": left untouched until this is merged, per
  that file's own stated convention.

## Step 5 — Verify

Status: **done.**

- Container-Alpine (authoritative for `core-service` per `CLAUDE.md`):
  `npm install && npm run lint && npm run typecheck --workspace=@tare/core-service
  && npm run test --workspace=@tare/core-service && npm run build --workspace=@tare/core-service`.
  Lint/typecheck/build all clean (lint's only output is 2 pre-existing,
  unrelated `admin-ui` warnings). Full suite: 363/367 passed; the 4
  failures were investigated individually:
  - 3 are the pre-existing, already-documented Alpine cold-start hook/health
    timeout flake (`app.test.ts` GET /health, `admin/routes.test.ts`
    `beforeEach`, `printing/routes.test.ts` `beforeEach`) — unrelated to
    this change, reproduces on unmodified `main` too.
  - 1 was real and caused by this change:
    `camera/routes.test.ts > POST /webhooks/camera/entrance > overwrites
    the entry on a retrigger for the same open ticket` — its two
    back-to-back entrance calls for the same plate now fall inside the new
    2-minute duplicate-plate window and get discarded instead of reaching
    the last-write-wins rule the test covers. Fixed by backdating the first
    entrance's `entryAt` past the window (same pattern as the new
    "processes a reading normally once the duplicate window has passed"
    test) before the retrigger. Re-ran scoped
    (`camera/routes.test.ts` + `camera/config.test.ts` +
    `tickets/repository.test.ts`): 83/84 passed, the 1 failure being the
    same cold-start flake landing on a different file this run (confirms
    it's a general characteristic of this sandboxed Alpine run, not
    specific to any one file).
  - Audited the rest of `routes.test.ts` for other same-plate/same-direction
    back-to-back calls within a single test that this change could affect:
    none found (all other repeated-plate sequences either span separate
    `it` blocks with a fresh DB, use different plates, or already
    backdate/alternate direction).
