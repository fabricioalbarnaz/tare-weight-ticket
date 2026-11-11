# Always acknowledge (200) camera pushes that aren't usable ANPR events

Status: **Step 1 done — awaiting review before step 2 (production deploy).**
Created: 2026-11-10

## Context

**Production symptom (2026-11-10):** starting 12:01 the entrance camera
(`192.168.29.66:222`) began POSTing to `/webhooks/camera/entrance` roughly
every 10 seconds, every one of them answered **400** by core-service
(2579 x 400 that day vs. a normal ~30/day for either camera). Accepted
entrance plate reads dropped to 8 that day (exit camera: 24), last one at
13:06. The camera was factory-reset at ~19:36 (wiping its HTTP host
config); after re-creating HTTP Host 1 via ISAPI at 20:39 the same
10-second 400 loop resumed immediately — so the reset did not clear
whatever the camera is stuck on.

**Hypothesis:** the camera's HTTP host has `checkResponseEnabled=true`, so
a non-2xx response makes it treat the push as failed and retry it. A
single push core-service can't use (missing `anpr.xml` part, or an
`anpr.xml` without `deviceID`/`dateTime` — a non-ANPR event, e.g. a
heartbeat/other alarm type, since the host is subscribed with
`eventMode=all`) gets rejected forever, and appears to block the camera's
upload queue so real plate reads stop getting through. Unconfirmed: the
rejected payloads' content is not logged today.

## Decision

- Both `/webhooks/camera/entrance` and `/exit`: a push with no `anpr.xml`
  part, or an `anpr.xml` that fails `parseAnprXml`, is answered **200**
  with `{ kind: 'ignored', reason }` instead of 400 — the camera gets an
  ack and moves on. No ticket, scale read, driver signal or print happens
  (same as today's 400 path).
- Log each ignored push at `warn` with enough to identify it: the
  multipart field names received and the first ~500 chars of the
  `anpr.xml` part (if any) — so the payload that triggered the loop can be
  identified from `docker logs`. Not recorded in `raw_events` (a 10 s
  retry loop would flood that table).
- Unchanged: a *valid* ANPR event with an empty/unreadable plate still
  goes through the normal `plate_unreadable` business path.

## Steps

1. **Code + tests** — `camera/routes.ts`: replace both 400 replies with a
   200 `ignored` reply + warn log; update the two existing 400 tests in
   `routes.test.ts` (and add exit-side coverage). Verify lint/typecheck/
   test for core-service (Alpine container is authoritative).
   Status: **done** (2026-11-10 — Alpine container, on a scratchpad copy of
   the repo so the native `node_modules` used by the NSSM bridges wasn't
   touched: typecheck ✓, lint ✓ 0 errors, tests 300/300 ✓)
2. **Production deploy** — rebuild/restart `core-service` following the
   live-data-safety procedure (Admin API export + raw `data/tare.sqlite`
   backup first). Then watch `docker logs` for the `ignored` warn lines
   (identify the payload) and confirm the 10 s loop stops and entrance
   plate reads return 200 again.
   Status: **deployed 2026-11-10 ~20:59** (raw + online SQLite backup in
   `data/backup-before-rebuild-20261110/`; disk was verified current from a
   fresh connection first; previous image tagged
   `docker-core-service:rollback-20261110`). Container healthy.
   **Finding:** the unusable pushes are multipart with a single part named
   `diskerror` (no `anpr.xml`) — the camera's storage-error alarm. ISAPI
   `/ISAPI/ContentMgmt/Storage/hdd` on the entrance camera reports its SD
   card as `status=error`, capacity 0 (exit camera: `ok`, 28928 MB). Once
   acked with 200 the camera sent them ~1/s — steady **~69/min for several
   minutes, not a draining backlog**: the alarm repeats continuously while
   the SD card is in error, and the 10 s cadence before was just the
   camera's retry interval after a 400. So the 200 alone doesn't stop the
   flood; the real fix is on the camera (format/replace the SD card, or
   unlink the HDD-exception alarm from "notify surveillance center").
   Pending: that camera-side fix, and confirming real entrance plate reads
   resume on the next truck.
3. **Docs** — record the outcome (what the payload was, whether the
   hypothesis held) in master plan §11; delete this file once merged.
   Status: pending
