# Entrance stops overwriting an open ticket — each entrance opens a new one

**Status:** Executing all steps in one pass (user instruction, 2026-11-14 —
no per-step stop-for-review checkpoint for this plan).

## Decision (confirmed with user, 2026-11-14)

Reverses the "last-write-wins" entrance rule from the master plan (§4
"Duplicate/misread handling" row, §5 entrance bullet). New behavior:

- Entrance camera fires for plate `X`, plate readable, no active internal-truck
  tare → **always** creates a brand-new `OPEN` ticket, even if another `OPEN`
  ticket already exists for `X`. No more "repeated entrance read for an
  already-open ticket overwrites it."
- Exit camera fires for plate `X` → unchanged in spirit (closes the open
  ticket for `X`), but since more than one `OPEN` ticket can now exist for the
  same plate, it must close the **most recently opened** one, matched by
  `entryAt`.
- An older `OPEN` ticket left behind when a newer one for the same plate gets
  closed by an exit stays `OPEN` indefinitely — **no automatic flag, no
  anomaly, no cleanup job.** Confirmed with user (2026-11-14): this is
  acceptable, resolved manually by an admin like any other stuck ticket.
- The 2-minute same-plate/same-direction camera debounce
  (`CAMERA_DUPLICATE_PLATE_DEBOUNCE_MS`, `docs/plans/2026-11-12-camera-duplicate-plate-debounce-plan.md`)
  is unaffected and keeps being the only guard against accidental duplicate
  tickets from camera flicker/re-trigger within that window. Past that
  window, a second entrance read for the same plate is now a deliberate new
  ticket, not an update.
- The internal-truck active-tare path (`findActiveTareByPlate`, both
  entrance and exit) is unaffected — it already always creates-and-closes a
  ticket in one step and never calls `findOpenByPlate`.
- The exit re-weigh rule (`docs/plans/2026-11-12-exit-reweigh-plan.md`,
  matches against the most recent `CLOSED` ticket when no `OPEN` ticket
  exists) is unaffected.

## Why

Operationally, a last-write-wins entrance meant a truck that triggers the
entrance camera twice (e.g. backs out and re-enters properly) silently loses
its first weighing with no record it ever happened as a separate event. The
user wants every entrance reading preserved as its own ticket instead.

## Steps

### Step 1 — Core domain logic (`core-service`) — **in progress**

- `apps/core-service/src/tickets/repository.ts`: `findOpenByPlate` adds
  `.orderBy(desc(tickets.entryAt), desc(tickets.id)).limit(1)` (currently a
  bare `.get()` with no ordering, which only worked because at most one
  `OPEN` row per plate could ever exist). Update its interface doc comment
  to say "most recently opened" instead of implying uniqueness.
- `apps/core-service/src/tickets/session-service.ts`:
  - `handleEntranceReading`: remove the `existing = repo.findOpenByPlate(plate)`
    branch entirely — always `repo.create(...)`, always
    `TICKET_AUDIT_ACTIONS.ENTRY_CAPTURED` (or `ENTRY_CAPTURE_FAILED`), always
    `{ kind: 'ticket_opened', ticket }`.
  - Remove `ENTRY_OVERWRITTEN` from `TICKET_AUDIT_ACTIONS`.
  - Remove `'ticket_retriggered'` from the `EntranceResult` union.
  - Drop the `isRetrigger` field from the audit log payload (it can only ever
    be `false` now).
- Update/replace the now-obsolete tests that assert overwrite/retrigger
  behavior, and add a new one for the actual target behavior:
  - `apps/core-service/src/tickets/repository.test.ts` (~line 111,
    `findOpenByPlate('RET1234')` after a second entrance).
  - `apps/core-service/src/tickets/session-service.test.ts` (~lines 125-129,
    221-276, 885) — second entrance for the same plate while the first is
    still `OPEN` must produce a **second** ticket (`kind: 'ticket_opened'`,
    different `id`), not `'ticket_retriggered'`.
  - New test: two entrances for the same plate (two `OPEN` tickets) then one
    exit → exit closes the second (most recent) ticket; the first stays
    `OPEN` untouched.

### Step 2 — Camera routes / live weighing stream (`core-service`)

- `apps/core-service/src/camera/weighing-events.ts`: remove
  `'ticket_retriggered'` from `WeighingOutcome`.
- `apps/core-service/src/camera/routes.ts` and `routes.test.ts`: update any
  logic/assertions keyed on the `'ticket_retriggered'` outcome (lines ~200,
  215, 239, 250-260, 374, 633, 859-882, 917, 952 touch `findOpenByPlate` or
  retrigger expectations — each needs re-checking against the new
  behavior, not just the retrigger-specific ones).

### Step 3 — Admin UI (`admin-ui`)

- `apps/admin-ui/src/lib/useWeighingEvents.ts`: remove `'ticket_retriggered'`
  from its local `WeighingOutcome` type (mirror of the backend's).
- `apps/admin-ui/src/i18n/locales/pt-BR.json` and `en.json`: remove the
  `entry_overwritten` audit-log label (line ~179 in both) — no longer a
  possible audit action.
- `apps/admin-ui/src/api/mocks/fixtures.ts`: drop the now-meaningless
  `isRetrigger: false` field (~line 255).
- Sweep `apps/admin-ui/src/components/operation/LiveWeighingPanel.tsx` and
  its test for any remaining reference to the removed outcome (none found
  in the initial grep, but re-check once Step 2 lands).

### Step 4 — Docs + verification

- `docs/plans/2026-09-29-tare-weight-ticket-plan.md`:
  - Requirements table, "Duplicate/misread handling" row (~line 40): replace
    the last-write-wins sentence with the new rule.
  - §5 entrance bullet (~lines 193-197): rewrite to describe "always opens a
    new ticket" instead of "replace".
  - §5 exit bullet: note it now matches the most recently opened ticket when
    more than one is `OPEN` for the plate.
  - §11: add a dated decision entry (2026-11-14) summarizing the reversal and
    why (see "Why" above), same pattern as the other reversed-decision
    entries already there.
- Verify per `CLAUDE.md`'s environment-specific rule: `core-service` via the
  Alpine Docker one-liner (`lint`, `typecheck`, `test`, `build`), `admin-ui`
  native is fine for its own checks.

## Progress

- [x] Investigated current behavior and confirmed scope/edge cases with user
- [ ] Step 1 — core domain logic + its tests
- [ ] Step 2 — camera routes / weighing stream
- [ ] Step 3 — admin UI
- [ ] Step 4 — docs + verification
