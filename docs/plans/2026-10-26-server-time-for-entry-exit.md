# Plan: use server time for entryAt/exitAt instead of camera event dateTime

## Status: implementation complete, awaiting commit

## Why

`entryAt`/`exitAt` on a ticket currently come from the Hikvision ANPR
payload's `dateTime` field (parsed in `camera/normalize.ts`, carried as
`NormalizedCameraEvent.timestamp`, and used as-is for `entryAt`/`exitAt` in
`tickets/session-service.ts`). That makes the ticket's authoritative
entry/exit time dependent on the camera's own clock, which core-service has
no way to validate or keep in sync. Net weight timing and ticket print
times should be anchored to the core-service server's own clock instead.

Decisions (confirmed with user 2026-10-26):
- The raw camera-reported `dateTime` is **kept** in the `raw_events` forensic
  log (`camera_entrance`/`camera_exit` payloads) — useful later for spotting
  camera clock drift. Only the ticket's `entryAt`/`exitAt` fields switch to
  server time.
- Server time is captured **at webhook receipt**, before the scale's
  stable-weight wait — not after, which would skew `entryAt`/`exitAt` by
  however long the scale took to settle.

## Steps

1. **`tickets/session-service.ts`**: add a `receivedAt: Date` field to
   `EntranceReadingInput`/`ExitReadingInput`, used for `entryAt`/`exitAt` in
   `repo.create`/`repo.updateEntry`/`repo.close`/`repo.flagAnomaly`. Keep the
   existing `timestamp` field (camera-reported) exactly as-is, still used only
   for the `camera_entrance`/`camera_exit` raw event payloads. Update
   `session-service.test.ts` to pass `receivedAt` and assert `entryAt`/
   `exitAt` reflect it (not the camera `timestamp`).
   Status: done

2. **`camera/routes.ts`**: capture `const receivedAt = new Date()` at the
   top of each webhook handler (right after the route starts, before
   `scaleClient.readStableWeight`), and pass it through as `receivedAt` to
   `handleEntranceReading`/`handleExitReading`, alongside the existing
   `timestamp: event.timestamp`. Update `camera/routes.test.ts` if needed.
   Status: done — no test changes needed (camera/routes.test.ts doesn't
   assert on timestamps).

3. **Full verification**: run lint/typecheck/test for `core-service`
   (native Windows is fine for this workspace per CLAUDE.md — not one of
   the two native-Windows-only apps, but also not touching anything
   Alpine-toolchain-sensitive; confirm with root `npm run lint && npm run
   typecheck && npm run test` is sufficient, no Docker verification needed
   since this doesn't touch dependencies). Delete this plan file once done
   and merged.
   Status: done — `npm run typecheck --workspace=@tare/core-service`,
   `npm run test --workspace=@tare/core-service` (206/206 passed), and
   root `npm run lint` (0 errors, 2 pre-existing unrelated warnings in
   admin-ui) all passed. No Docker/Alpine verification needed — this
   change touches no dependencies, just two already-covered source files.
   Awaiting user commit; delete this file once committed/merged per the
   project's plan-file lifecycle.
