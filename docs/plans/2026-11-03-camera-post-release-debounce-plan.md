# Debounce spurious camera reads right after a truck is released

Status: **Done, pending commit.**
Created: 2026-11-03

## Context

**Production symptom (reported 2026-11-03):** after a truck is weighed and
released at the scale, as it pulls away it sometimes rolls back slightly
before actually moving forward. That small backward motion can re-trigger
either camera (the one that normally reads the truck's rear plate, or —
confirmed by the user — even the entrance camera, if the truck drifts back
far enough).

**Root cause (clarified by the user, 2026-11-03):** this is not a simple
duplicate-read-of-the-same-plate problem. Trucks here are articulated
(tractor + trailer/"caçamba"), and the tractor's plate is a *different*
registration than the trailer's. Each camera normally reads whichever end
of the rig is in front of it — so a spurious re-trigger during the
rollback reads the *other* plate of the same physical vehicle, not the one
already on file for the ticket in progress. Concretely:

- If the **exit-side** camera re-fires: `findOpenByPlate` on that
  (different) plate finds nothing — the real ticket was already closed
  moments earlier under the correct plate — so it's flagged as a false
  `ANOMALY` (master plan §5's "exit without a matching entrance" rule,
  which is correct for a *genuinely* unmatched exit, firing on a false
  positive here).
- If the **entrance-side** camera re-fires: `findOpenByPlate` on that
  (different) plate also finds nothing, so a brand-new, bogus `OPEN`
  ticket gets created for a truck that was actually already leaving — it
  will never get a real matching exit, and depending on what the scale
  reads at that moment, it can also withhold the driver signal for a
  truck that should already be free to go.

Because the spurious read's plate is unreliable by construction (it can
legitimately be either plate of the rig), **matching on "same plate within
N seconds" does not catch this** — the whole point is that the plate is
different. The fix has to be time-anchored, not plate-anchored, confirming
the user's original instinct.

**Accepted risk (confirmed with the user):** a time-based, non-plate-scoped
debounce right after a release could, in principle, also swallow a
*different*, legitimately queued truck's real entrance if it happens to
land inside the same window. The user confirmed this is possible at busy
times but wants to ship this as a production test and observe behavior
rather than block on it — the window is an env var from day one specifically
so it can be tuned (or disabled) without a code change if that happens.

## Decision

- **Global, not per-plate**, debounce: compare the incoming webhook's
  receipt time against the **most recently closed ticket's `exitAt`**
  across the whole system — never against "was this same plate seen
  recently," since the plate itself can't be trusted during the bounce.
- Applies **symmetrically to both** `/webhooks/camera/entrance` and
  `/webhooks/camera/exit` — the user confirmed the rollback can trigger
  either camera.
- Default window **15000ms**, configurable via a new
  `CAMERA_POST_RELEASE_DEBOUNCE_MS` env var (same pattern as
  `SCALE_STABILITY_TIMEOUT_MS` etc. in `scale/config.ts`).
- The check happens **after** parsing the ANPR payload (so the discarded
  event can still be logged with its real plate/camera for diagnosis) but
  **before** `scaleClient.readStableWeight` and before
  `driverSignalAdapter.signalDriver` — a discarded read must not pay the
  up-to-~90s scale-stability wait, and must not flicker the driver signal.
- A discarded read is still written to `raw_events` (source
  `camera_entrance`/`camera_exit`, payload flagged with a discard reason
  and the measured gap) but **never** touches `tickets` or
  `ticket_audit_log`, and is **not** linked to a ticket. This keeps the
  Admin UI's unresolved-events list free of noise while leaving a trail the
  user can inspect to judge whether 15s is too aggressive once this is live.
- New outcome kind at the route layer (`reading_debounced`) — modeled
  outside `session-service`, since a debounced request never reaches it.

This does **not** touch the existing entrance "last-write-wins" retrigger
rule (master plan §5) — that only fires for a *still-open* ticket's own
entrance leg being re-read, which is unrelated to "time since the last
ticket closed."

## Step 1 — `tickets/repository.ts`

Status: **done.**

- Add `findMostRecentExitAt(): Date | null` to `TicketRepository`
  (`SELECT` ordered by `exitAt` descending, `IS NOT NULL`, limit 1 — same
  style as the existing `findLastEventTimestamp`). Covers tickets closed
  via a normal exit *and* via `ticket_closed_via_tare` (internal trucks),
  since both set `exitAt`.
- `repository.test.ts`: null on an empty DB; returns the latest `exitAt`
  across multiple closed tickets.

## Step 2 — `camera/config.ts` (new)

Status: **done.**

- `loadCameraConfig(env)` → `{ postReleaseDebounceMs: number }`, env var
  `CAMERA_POST_RELEASE_DEBOUNCE_MS`, default `15000`, via the existing
  `parsePositiveInt` helper from `config/env.ts`. Kept `parsePositiveInt`
  as-is (rejects `0`) rather than adding a dedicated "disable" value — not
  needed for this change; setting the window very low has the same
  practical effect.
- `camera/config.test.ts` mirroring `scale/config.test.ts`.

## Step 3 — `camera/routes.ts`

Status: **done.**

- `CameraRoutesOptions` gains `postReleaseDebounceMs: number` and
  `getMostRecentExitAt: () => Date | null` (a narrow dependency, not the
  whole `TicketRepository`, to keep this module's surface as small as it
  is today).
- Both handlers: right after computing `event` (plate/camera already
  known) and before the `scaleClient.readStableWeight` call:
  - If `getMostRecentExitAt()` returns a time within
    `postReleaseDebounceMs` of `receivedAt`, record the raw event with a
    discard reason and the measured gap, reply
    `{ kind: 'reading_debounced' }`, and return — skipping the scale read,
    the driver signal, and the `sessionService` call entirely.
- `app.ts`: wires `postReleaseDebounceMs` from `loadCameraConfig(process.env)`
  and `getMostRecentExitAt` from `repo.findMostRecentExitAt`.
- A discard also logs via `request.log.warn` (plate, cameraId, direction,
  `msSinceLastExit`) — not just the `raw_events` row — per the user's
  explicit request (2026-11-03) for a log line when a webhook is discarded
  for this reason.
- `routes.test.ts` new cases (all in a `post-release debounce` describe
  block):
  - An exit webhook arriving right after a ticket's `exitAt`, for an
    unrelated plate, is discarded (scale/driver-signal mocks never called;
    ticket untouched; a `raw_events` row flagged `post_release_debounce`
    is recorded).
  - An entrance webhook arriving right after a ticket's `exitAt`, with a
    plate that matches nothing on file, is also discarded (the
    rollback-into-entrance-camera case).
  - A reading processes normally once the window has passed — simulated
    by backdating the prior ticket's `exitAt` via `repo.correctExit`
    rather than sleeping the test for real.
  - With no ticket ever closed (fresh DB), nothing is debounced.

## Step 4 — Update documentation

Status: **done.**

- Master plan §5: a bullet before "Exit camera fires" describing the
  post-release debounce, and explicitly why it's time-anchored rather than
  plate-matched (tractor/trailer rigs carry two different plates).
- Master plan §11: new "Post-release camera debounce (2026-11-03)"
  subsection — incident, rejected same-plate alternative, decision, and
  the accepted risk the user confirmed.
- `CLAUDE.md` "Project status": left untouched, per that file's own stated
  convention (updated once this is merged, not before).

## Step 5 — Verify

Status: **done.**

- Native `vitest run` (full `core-service` suite, 265/265) and
  `tsc --noEmit` both clean. `eslint` clean on all changed/new files.
- Container-Alpine `npm install && npm run lint && npm run typecheck &&
  npm run test && npm run build`: lint, typecheck, and build all passed
  cleanly. `npm run test` hit one pre-existing, environment-specific flake
  unrelated to this change — the very first `app.inject({ method: 'GET',
  url: '/health' })` call in a given test file times out at 5s inside this
  particular Alpine-in-sandboxed-shell run, then every later call in the
  same file succeeds immediately. Confirmed unrelated: it reproduces
  identically in `apps/print-bridge/src/app.test.ts` and
  `apps/scale-bridge/src/app.test.ts`, neither of which this change
  touches. 262/265 `core-service` tests still passed in that same run.
  Native run (not affected by this flake) is the authoritative result for
  this change's correctness.
- Note for whoever next runs the container-Alpine check on this repo: a
  native `npm install` afterward needs `$env:PYTHON` pointed at a real
  Python 3 (not the Windows Store alias) for `better-sqlite3`'s
  `node-gyp rebuild` — see `CLAUDE.md`'s existing note on this. On this
  machine that's `C:\Users\fabri\AppData\Local\Programs\Python\Python312\python.exe`,
  with Visual Studio Build Tools 2022 already present.
- Once deployed, watch `raw_events` (or a quick ad-hoc query) for
  `reading_debounced` entries to judge in practice whether 15s is too
  aggressive for this site's queueing — the user has flagged this as a
  real possibility and wants to observe it live rather than guess upfront.
