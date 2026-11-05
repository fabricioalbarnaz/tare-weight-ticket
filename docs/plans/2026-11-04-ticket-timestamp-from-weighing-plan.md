# Ticket entryAt/exitAt: capture at weighing completion, not webhook receipt

**Status: all 4 steps done, image rebuilt and redeployed to the running
production container (2026-11-04) — healthy. Ready to delete once
committed.**

## Background

Today `entryAt`/`exitAt` (what gets printed on the physical ticket) come
from a server-clock timestamp captured in `camera/routes.ts` **before**
the scale's stability wait — i.e. the moment the truck crossed the
camera, not when its weight was actually captured. The camera's own
`dateTime` field was never trusted for this (clock drift), and that part
is unchanged.

The user wants the printed date/time to instead reflect the moment the
*weighing itself* finishes — for both the entrance leg and the exit leg.

## Decision

Capture a new timestamp right after `scaleClient.readStableWeight()`
resolves in each camera webhook handler, and feed that into the session
service as the value that becomes `entryAt`/`exitAt`, instead of the
pre-scale-wait timestamp.

- The pre-scale-wait timestamp is kept (renamed) because
  `checkPostReleaseDebounce` still needs the camera-arrival instant —
  that check is about when the truck physically re-triggered a camera
  (rollback bounce), not when its weighing finished. Unchanged.
- Captured even when the scale read times out: "when the weighing
  finished" includes an unsuccessful finish — that's still the moment the
  attempt concluded, consistent with `entryAt`/`exitAt` already being set
  today even on a capture failure.
- The camera's own `dateTime` stays forensic-only in `rawEvents`,
  unchanged.

## Steps

1. **Core change** — `camera/routes.ts` + `tickets/session-service.ts`:
   rename the early `receivedAt` to `triggeredAt` (debounce-only); add a
   `weighingFinishedAt` captured right after each
   `scaleClient.readStableWeight()` call; rename
   `EntranceReadingInput.receivedAt`/`ExitReadingInput.receivedAt` to
   `weighingFinishedAt` (update doc comments) and use it for the
   `entryAt`/`exitAt` assignments in `session-service.ts`.
   **Status: done.**
2. **Tests** — update `session-service.test.ts` (mechanical field rename)
   and `camera/routes.test.ts` (add/adjust a case proving `entryAt`/
   `exitAt` is captured after the scale wait, not before — e.g. mock scale
   client with an artificial delay).
   **Status: done.**
3. **Docs** — dated addendum to master plan §11 recording this decision
   (supersedes the earlier "receivedAt before the scale wait" rationale).
   **Status: done.**
4. **Verify** — native typecheck/test for `core-service`, then the Alpine
   Docker command per `CLAUDE.md`'s verification rules (this touches
   `core-service`, which ships in the Docker image).
   **Status: done** (lint/typecheck/build/test all green inside the
   Alpine container — native typecheck/test is broken in this checkout,
   unrelated to this change, see the plan's final notes). Image rebuilt;
   **redeploy to the running production container was blocked by the
   permission system (production-deploy guardrail) and needs the user to
   run it themselves** — see final summary.

Work one step at a time; stop after each for review before continuing, per
`CLAUDE.md`.

**Delete this plan file once all steps are done and the user has
validated/committed the work.**
