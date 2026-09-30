# Phase 1 — Domain core

Status: complete, awaiting user review
Parent plan: `docs/plans/2026-09-29-tare-weight-ticket-plan.md` (§9, Phase 1)

## Goal

Build the ticket session state machine and its storage, fully unit tested,
with no real hardware wiring yet (that starts in Phase 2/3/4). At the end
of this phase, `core-service` can open/close/flag tickets and enforce every
business rule from the master plan's §5 purely in-process, backed by a real
SQLite database.

## Steps

Work proceeds one step at a time; each step stops for review before the
next starts.

1. [x] Add DB tooling to `apps/core-service`: `drizzle-orm`,
   `better-sqlite3` (deps), `drizzle-kit`, `@types/better-sqlite3`
   (devDeps), a `drizzle.config.ts` (sqlite dialect, schema at
   `src/db/schema.ts` — created next step, out dir `./drizzle`), and a
   `db:generate` script. (`db:migrate` will be added in step 3 once the
   migrate runner script exists.) Verified: `better-sqlite3`'s native
   binary loads and runs a real query; lint/typecheck/test/build all still
   pass. Note: `drizzle-kit`'s bundled `@esbuild-kit` dependency has a
   known moderate, dev-tool-only advisory (stale dev-server esbuild) with
   no non-breaking fix available upstream yet — not exploitable via our
   usage (local CLI codegen, never run as a server), tracked but not
   blocking.
2. [x] Define the Drizzle schema (`src/db/schema.ts`) for `tickets`,
   `ticket_audit_log`, `raw_events`, `admin_users` per master plan §4;
   generate the initial migration. Added `entry_capture_failed` /
   `exit_capture_failed` bool columns to `tickets` beyond the original §4
   table — needed to represent the §5 scale-timeout rule; updated the
   master plan's data model table to match rather than let it drift.
   Generated `drizzle/0000_chief_jetstream.sql` (+ meta journal/snapshot)
   via `npm run db:generate`; verified the SQL matches the schema exactly
   (4 tables, correct FKs, unique indexes on `username` and
   `ticket_number`). Full lint/typecheck/test/build still pass.
3. [x] DB bootstrap module (`src/db/client.ts`): `createDb(dbPath)` opens
   the SQLite file (creating its parent dir if needed), enables WAL mode
   and foreign-key enforcement, and runs pending migrations on startup via
   drizzle's `migrate()`. `dbPath` is a parameter rather than read from
   `DB_PATH` internally, so the module stays pure/testable — reading
   `process.env.DB_PATH` and calling `createDb` is wiring that belongs in
   `server.ts`, deferred until something actually needs the DB connection
   (Phase 3, when HTTP routes get wired up — this phase has none yet).
   Tested against real temp-file SQLite DBs (table creation, WAL +
   foreign_keys pragmas, and idempotency of re-running migrate against an
   already-migrated file). Also manually verified the migrations-folder
   path resolves correctly from the **compiled** `dist/` output, not just
   via `tsx`/vitest against `src/` — `dist/db/client.js` mirrors
   `src/db/client.ts`'s depth, so the relative `../../drizzle` path holds
   in both. Full lint/typecheck/test/build pass.
4. [x] Pure domain helpers: `src/domain/net-weight.ts`
   (`calculateNetWeightKg`, `abs(entry - exit)` rounded to 2 decimals to
   avoid float noise — e.g. `100.3 - 100.2` raw is `0.09999999999999432`)
   and `src/domain/plate.ts` (`normalizePlate`: trim, uppercase, strip
   non-alphanumeric; empty/unreadable input normalizes to `''`, which
   later steps use as the "unreadable plate" signal). Both fully unit
   tested (both load directions, equal weights, whitespace/dash/mixed-case
   plate formats). No I/O, no DB. 11 tests passing across the phase so
   far; lint/typecheck/test/build all pass.
5. [x] Ticket repository (`src/tickets/repository.ts`): thin data-access
   layer over Drizzle — `findOpenByPlate`, `findById`, `create`,
   `updateEntry`, `close`, `flagAnomaly`, `appendAuditLog`,
   `recordRawEvent`. Dropped the separately-planned `updateExit` — closing
   a ticket always sets exit fields *and* transitions to `CLOSED` in one
   step (there's no business case for updating exit data without closing,
   and leaving the ticket `OPEN` after the truck has physically left would
   wrongly let a later entrance event treat it as a retrigger).
   **Schema correction required:** implementing `flagAnomaly` (exit event,
   readable plate, no open ticket → create an `ANOMALY` ticket per §5)
   exposed that step 2's `entryAt NOT NULL` was wrong — an anomaly ticket
   by definition has no entrance data. Made `entryAt` nullable in
   `schema.ts`, and since no real database has ever used the old
   migration (only ephemeral test temp-files), regenerated migration 0000
   fresh (`drizzle/0000_tearful_gravity.sql`) rather than layering a fixup
   migration on schema that was never actually deployed.
   Also decided: `close()` computes `netWeightKg` only when both entry and
   exit weights are present, leaving it `null` otherwise (e.g. when the
   entrance leg had a `weight_capture_failed`) — the master plan's §5
   doesn't explicitly cover this combination, and introducing a 4th ticket
   status for it would be scope creep beyond the documented
   OPEN/CLOSED/ANOMALY model; a `CLOSED` ticket with `netWeightKg: null`
   is a fine, queryable signal for the admin UI (Phase 6) to surface as
   needing attention.
   Ticket numbers are assigned via `MAX(ticket_number) + 1`, kept
   independent of the internal `id` per the master plan's data model.
   Tested against real temp-file SQLite DBs — 22 tests total across the
   phase, covering: ticket creation, sequential numbering across both
   `create` and `flagAnomaly`, plate lookup, retrigger overwrite via
   `updateEntry`, closing in both load directions, `netWeightKg` staying
   null after a failed entry capture, anomaly ticket creation with no
   entry data, and audit-log/raw-event writes. Full
   lint/typecheck/test/build pass.
6. [x] Session service (`src/tickets/session-service.ts`):
   `handleEntranceReading` / `handleExitReading`, each taking a
   `weightKg: number | null` + `weightCaptureFailed: boolean` pair.
   **Design decision:** scale timeout isn't a separate handler/branch —
   it's the same entrance/exit handler called with `weightKg: null,
   weightCaptureFailed: true` instead of a real reading, since a timeout
   doesn't change *which* ticket operation happens (open/retrigger/close/
   anomaly), only whether a real weight got recorded. This avoids
   duplicating the ticket-creation/retrigger/anomaly branching for what
   is, from the domain's perspective, the same event with a missing
   measurement. Every reading — successful, failed, or unreadable-plate —
   is always recorded via `recordRawEvent` for full traceability per the
   master plan's rationale for that table, and every ticket-affecting
   action writes a `ticket_audit_log` row via named action constants
   (`entry_captured`, `entry_overwritten`, `entry_capture_failed`,
   `exit_captured`, `exit_capture_failed`, `anomaly_flagged`).
   Unit tested for all six §5 branches (entrance new/retrigger/timeout/
   unreadable; exit close/anomaly/timeout/unreadable) plus both load
   directions end-to-end through the real repository/DB, asserting on
   the returned ticket *and* the actual audit-log/raw-event rows written.
   31 tests passing across the phase; lint/typecheck/test/build all pass.
7. [x] Updated `CLAUDE.md` project status to reflect Phase 1 complete.

**Phase 1 complete.** Per workflow, pausing here for review. Once merged,
this plan file gets deleted (per `CLAUDE.md`'s workflow rule) — the design
decisions worth keeping (nullable `entryAt`, timeout-as-same-handler,
dropped `updateExit`, null-`netWeightKg`-on-failed-capture) are already
folded into the master plan and `CLAUDE.md` so nothing is lost. Say
"continue" to move on to Phase 2 (scale integration: TCP client for the
Digi-Tron Isis New, stability-wait logic, protocol parser).

**Post-review fix (2026-09-30):** GitHub Actions CI failed on the "Build
core-service Docker image" step with
`process "/bin/sh -c npm ci" did not complete successfully: exit code: 1`.
Root cause: `better-sqlite3` (added in step 1 of this phase) is a native
module. `docker/Dockerfile.core-service` uses `node:24-alpine` for every
stage, and Alpine (musl libc, no C/C++ toolchain by default) has no
guaranteed matching prebuilt binary, so `npm ci` falls back to compiling
from source via `node-gyp` — which fails with no compiler present. This
slipped through because the Docker build was last verified in Phase 0,
*before* `better-sqlite3` existed; Phase 1's local verification only ran
`npm run build`/`npm run test` directly on macOS, where a prebuilt darwin
binary downloads fine, so it never re-exercised the Alpine/musl path.
Fixed by adding `RUN apk add --no-cache python3 make g++` to the `deps`
stage only, before `npm ci` — confirmed necessary and sufficient: a
rebuild's log explicitly showed
`better-sqlite3@13.0.3 (install: node-gyp rebuild)` succeeding with the
toolchain present, the image now builds clean with `--no-cache`, and the
container runs and serves `GET /health` correctly. Doesn't affect the
final image size/content since the toolchain never leaves the
intermediate `deps` stage in this multi-stage build.
**Lesson for later phases:** re-run the Docker build (not just
`npm run build`/`test` on the host) whenever a phase adds or changes a
native/platform-sensitive dependency, not only in Phase 0.

**Post-review fix (2026-09-30, code review):** an automated review flagged
that `repository.ts`'s `updateEntry` and `close` only filtered their
`UPDATE` by `tickets.id`, not also by `status = 'OPEN'`. Verified as a
real gap: current callers (`session-service.ts`) happen to pre-check via
`findOpenByPlate` before calling either method, but the repository itself
had nothing stopping a future/other caller from silently mutating an
already-`CLOSED`/`ANOMALY` ticket — e.g. closing the same ticket twice
would recompute and overwrite `netWeightKg`/`exitAt`/etc. on a ticket
that's supposed to be terminal. There was also a real type/runtime gap:
both methods declared a non-nullable `Ticket` return type, but Drizzle's
`.get()` can return `undefined` when the `WHERE` matches nothing, and
nothing checked for that. Fixed both methods to filter on
`and(eq(tickets.id, ticketId), eq(tickets.status, 'OPEN'))` and to throw
explicitly (`"...not found or not OPEN"`) when no row comes back;
`close()`'s existing `requireById` missing-ticket check (needed before the
update, to read `entryWeightKg` for the net-weight calc) is unchanged.
Added two repository tests covering both refusal paths. 33 tests passing;
lint/typecheck/test/build all still pass.

## Explicitly not in this phase

- No HTTP routes for entrance/exit events yet (Phase 3 wires the camera
  webhooks that call into this service).
- No real scale/printer/relay integration (Phases 2, 4, 5).
- No use of `packages/shared` yet — domain types stay local to
  `core-service` until `admin-ui` (Phase 6) actually needs to consume them
  across a package boundary; promoting them earlier would be speculative.
