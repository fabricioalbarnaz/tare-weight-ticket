# Preempt an in-progress scale read when a new plate arrives

Status: **All steps done and deployed to production (2026-11-10) — pending commit/merge, then delete this file.**
Created: 2026-11-10

## Context

The scale client serializes every read through one FIFO queue
(`scale/tcp-client.ts`) with no notion of which truck is physically on
the platform. A read that keeps retrying (up to `SCALE_STABILITY_RETRY_COUNT`
x `SCALE_STABILITY_TIMEOUT_MS`, now 3 x 45 s) outlives its truck and
captures the *next* truck's settled weight — see
`docs/runbooks/known-ticket-failure-patterns.md`, "exit retry loop outlives
the truck" (MFX8B10 / IRR7J60, 2026-11-07: MFX8B10's exit closed and
printed with IRR7J60's entrance weight, net 980 kg).

User request (2026-11-10): if the system is capturing a weight and a new
plate reading arrives, discard that capture and start a fresh one for the
new plate.

## Decisions (confirmed with the user, 2026-11-10)

- **Trigger:** a new camera reading (either camera — one physical scale)
  with a **readable** plate that is **different** from the plate of a
  read that is in progress or queued. Compared on the already-normalized
  `rawPlate` from `normalizeCameraPayload`.
- **Not a trigger:** an unreadable plate (`rawPlate === ''`) — camera
  noise must not kill a legitimate weighing; it queues as today. A
  re-read of the **same** plate also doesn't preempt (queues as today,
  existing last-write-wins behavior).
- **Every** older pending read (active or still queued) whose plate
  differs from the new one is preempted — including queued unreadable
  ones — so the scale always serves the newest truck.
- **The preempted reading is discarded entirely** (user choice over
  "record as a failed capture"): no ticket created/updated, no driver
  signal, no print. Only a `raw_events` row (`discarded:
  'preempted_by_new_plate'`, with the preempting plate) for traceability,
  and the webhook gets `200 { kind: 'reading_preempted' }`.
  Accepted risk: if the preempted truck was real, its leg vanishes
  without a ticket — only visible in `raw_events`/logs.
- **No weighing-result event** is emitted for the preempted reading: the
  live panel has already switched to the new plate (its
  `plate-received` fires first), and a late result for the old plate
  would overwrite it on screen. No Admin UI change needed.
- **No teardown** of the TCP connection on preemption (unlike the
  stability-timeout path): the new read is for the truck physically on
  the platform now, so the next stable frame legitimately belongs to it.
- Retries stop immediately for a preempted read.

## Steps

**Note (2026-11-10): user approved running all remaining steps (2–4,
including the production deploy) without pausing for review between them.**

1. **Scale client** — `ScaleReadContext` gains the normalized plate key;
   `ScaleReadFailureReason` gains `'preempted'`; `tcp-client.ts`
   `readStableWeight` preempts older reads (resolve active waiter / skip
   queued ones with `failureReason: 'preempted'`, stop retry loop).
   Tests in `tcp-client.test.ts`.
   Status: **done** (2026-11-10 — Alpine: 7 new preemption tests, 5/5
   repeat runs green; core-service typecheck/lint clean; full suite green
   except the pre-existing `app.test.ts > GET /health` cold-start timeout
   flake, reproduced on unmodified `main` too — 5.5 s vs 5 s limit under
   parallel load, unrelated to this change).
2. **Camera routes** — pass the plate key; on `failureReason ===
   'preempted'` record the raw event, reply `reading_preempted`, return
   before the session service. Tests in `routes.test.ts` (entrance/exit,
   different plate preempts, same plate and unreadable don't).
   Status: **done** (2026-11-10 — 5 new route tests incl. an end-to-end
   replay of the MFX8B10/IRR7J60 scenario against the real TCP client +
   mock scale server; 5/5 repeat runs green, typecheck/lint clean).
3. **Docs** — master plan §5/§11 and the runbook pattern ("fixed by
   preemption"); CLAUDE.md status if warranted.
   Status: **done** (master plan §5 rule + §11 entry, runbook "Fixed"
   note on the MFX8B10/IRR7J60 pattern, CLAUDE.md status paragraph).
4. **Production deploy** — backup procedure, rebuild, watch logs.
   Status: **done** (2026-11-10 22:36 — full Alpine verification green
   first (build/typecheck/lint/all workspace tests); online SQLite backup in
   `data/backup-before-preemption-deploy-20261110/`; previous image tagged
   `docker-core-service:rollback-20261110c`; container healthy, preemption
   code confirmed in the running image's `dist`, env still 45 s timeout /
   5 s debounce, tickets untouched (556, last id 561)). Not yet observed
   live: the first real preemption will show as a `warn` "reading
   discarded — its weight capture was preempted" log line plus a
   `raw_events` row flagged `preempted_by_new_plate`.
   Remaining after merge: delete this file (per CLAUDE.md).
