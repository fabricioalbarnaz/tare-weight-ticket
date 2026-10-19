# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phases 0–6 are complete and merged into `main`: PR #1 (Phase 0 scaffolding +
Phase 1 domain core), PR #2 (Phases 2–5 together: scale TCP integration,
camera webhooks, driver-signal relay adapter, and the print bridge), PR #3
(Phase 6 Admin UI frontend), PR #4 (Phase 6 admin backend API), and PR #5
(real Hikvision ANPR camera payload + Isis New scale serial field
diagnostics/docs). See the
master plan's §11 "Implementation notes from completed phases" for the
design decisions made along the way (most notably: `entryAt` is nullable to
support `ANOMALY` tickets created from an exit-without-entrance event, scale
timeouts are handled by the same entrance/exit handlers rather than a
separate code path, each handler runs inside one SQLite transaction, and the
driver signal fires right after every scale read — success or
capture-failed — so the truck is never left stuck on the scale).

In short: `core-service` has a Drizzle/SQLite schema and migrations
(`src/db/`), a ticket repository (`src/tickets/repository.ts`) with tables
already in place for admin work (`ticketAuditLog`, `rawEvents`,
`adminUsers`), and a session service (`src/tickets/session-service.ts`)
implementing every business rule from the master plan's §5, all backed by
real temp-file SQLite DBs in tests (no mocking the DB). `src/scale/` has a
TCP client with stability-wait logic against a placeholder frame parser —
still a placeholder: field diagnostics against the real Digi-Tron Isis New
indicator are underway (see `docs/runbooks/isis-new-serial-setup.md`) but
the opening-burst/freshness/DGN-status questions aren't resolved yet, so no
real parser has been written (master plan §7). `src/camera/` has the
entrance/exit webhook routes against the **real** Hikvision ANPR
`multipart/form-data` + `anpr.xml` payload (confirmed vendor format,
swapped in from the earlier generic JSON placeholder — master plan §7 item
3, §11). `src/driver-signal/` has a generic HTTP-relay adapter (real relay hardware
still unchosen). `apps/print-bridge` (native, **not** containerized — USB
access from Docker on Windows is unreliable) exposes `POST /print`,
building ESC/POS bytes and sending them through a pluggable
`PrinterTransport` (currently a placeholder that writes jobs to a file — no
printer hardware or `usbipd-win` spike yet). `core-service/src/printing/`
wraps that with a `PrintService` (single-print guarantee via `printed_at`,
manual reprint via `POST /tickets/:id/reprint`). The wire contract between
the two apps lives in `packages/shared`.

**Decision (2026-10-13):** finishing the remaining real hardware
integrations (scale protocol, relay hardware) is deferred to Phase 7
(per-PC deployment), done on-site once we have physical access to the
equipment — see master plan §7. Don't treat the scale placeholder as a bug
to fix now; it's intentionally parked pending the field diagnostics above.
The camera payload item of that same decision is **no longer deferred** —
it was implemented and merged once the real vendor format was confirmed
(PR #5, 2026-10-19), ahead of Phase 7, per the master plan §7 update.

Phase 6 (Admin UI) is fully merged: the **frontend** (`apps/admin-ui`:
React/Vite SPA, auth, dashboard, manual edit/create/reprint flows with
mandatory reason notes, hardware status panel, historical search, i18n
pt-BR/en, PR #3) against Mock Service Worker fixtures, and the **backend
admin API** (`core-service/src/admin/`, PR #4) — see master plan §11 for
the design decisions (bcryptjs + `@fastify/cookie`/`@fastify/session` for
auth, session plugins registered only inside the `/api/admin` encapsulated
context; new repository queries `listTickets`, `listUnresolvedEvents`,
`findAuditLogByTicketId`, `correctExit`, `findLastEventTimestamp`; a
`createdByAdmin` flag on manual ticket creation; `ScaleClient`,
`DriverSignalAdapter`, and `PrintClient` each grew a `getStatus()`/
`checkHealth()` method feeding `GET /api/admin/status`). The Admin UI
needed zero code changes to work against the real backend — just
`VITE_API_MODE=proxy` instead of `mock`. No real hardware to test the
Admin UI's own integration page against yet (that's Phase 7, on-site).

`npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all
passed from the repo root as of the last phases merged; re-verify rather
than trusting this note once new work lands.

Before doing any work here, read the latest file in `docs/plans/` (currently
`docs/plans/2026-09-29-tare-weight-ticket-plan.md`) in full — it is the
single source of truth for scope, architecture, data model, business rules,
and the phase-by-phase build order. Do not start implementation ahead of
the phase order documented there without checking with the user first.

## What this system is

A fully automatic truck weighbridge ("tare weight ticket") system. One
instance runs per physical scale, installed independently on its own PC —
no multi-tenant/multi-company support, no central server in scope yet. Flow:
entrance camera reads a plate → scale gives a stable weight → driver is
signaled to move on → same happens on exit → once both weights exist, a
ticket is printed automatically with plate, entry/exit time, entry/exit
weight, and net weight. An Admin UI exists only for manual correction when
the automatic flow fails (misread plate, hardware timeout, etc.) — the
system must otherwise require zero human interaction.

The product name is **EixoLink**. Use it in docs and user-facing text (the
printed ticket and the Admin UI, when they exist), but don't rename the
repo, the `@tare/*` packages, file paths, or Docker images to match.

## Decided architecture (see the plan doc for full rationale)

- **Stack**: Node.js/TypeScript, Fastify API, SQLite via Drizzle ORM,
  React + Vite admin UI, npm workspaces monorepo, Docker (Linux containers
  via Docker Desktop's WSL2 backend on Windows balance PCs).
- **Repo layout** (per the plan; create to match when scaffolding):
  `apps/core-service` (Fastify API, scale/camera integration, session state
  machine, serves the admin UI build), `apps/admin-ui` (React/Vite SPA),
  `apps/print-bridge` (native Windows process for the USB thermal printer —
  kept outside Docker because USB passthrough on Windows is unreliable;
  see the plan's risk section before changing this), `packages/shared`
  (shared TS types/schemas), `docker/`, `docs/plans/`, `docs/runbooks/`.
- **Hardware integration boundaries**: camera events arrive as HTTP
  webhooks (entrance/exit are distinguished by which endpoint/camera
  fired); the scale (Digi-Tron Isis New) is read over TCP/IP and the code
  must wait for its stable/settled flag before accepting a weight, never
  an instant snapshot; the driver "move on" signal goes through a pluggable
  adapter interface (default: HTTP call to a network relay) so the actual
  relay hardware can change without touching business logic; printing goes
  through the Print Bridge, not directly from the Core Service.
- **Core business rule**: net weight is always
  `abs(entry_weight - exit_weight)`, valid whether the truck arrives empty
  and leaves loaded or the reverse. A misread/unreadable plate is never
  auto-corrected — it requires an admin. A repeated entrance read for an
  already-open ticket overwrites that ticket's entry data (last-write-wins,
  intentional). An exit read with no matching open ticket is flagged as an
  anomaly, never guessed at or auto-closed.

## Working in this repo

- Treat `docs/plans/*.md` as living specs, not historical notes — when an
  implementation decision in this plan turns out to be wrong once real
  hardware/vendor docs are available (scale protocol, camera payload
  format, printer USB approach, relay hardware), update the plan doc itself
  rather than letting the code silently diverge from it.
- The plan's "Explicit non-goals" section is intentional scope control for
  a low-volume (~200 trucks/day), single-balance-per-install system — don't
  introduce message queues, multi-tenant support, or a central
  aggregation service unless the user asks for the Phase 9 (future) work.

## Development workflow

- Before starting any new feature or non-trivial code change, write a
  development plan divided into implementation steps and save it as its own
  file in `docs/plans/` (this is separate from the overarching project plan
  described above — it's a smaller, per-feature/change plan). This exists
  so the plan survives a lost session and so progress can be tracked against
  it, so keep it updated as steps complete.
- Once that plan's work is fully implemented and merged, delete its plan
  file from `docs/plans/` — it's a working document, not permanent
  documentation. (The overarching project plan referenced earlier in this
  file is the exception: it stays until the project itself is fully built.)
- Track progress inside the plan file itself: mark each step done as it's
  finished, and clearly mark which single step is currently in development
  (e.g. a `Status` line per step, or a "Currently in progress" marker) so
  the plan reflects real state if the session is lost.
- Work one step at a time. After finishing a step, stop and wait for the
  user to review and explicitly say to continue before starting the next
  step — never chain multiple steps together without that check-in.
- The user handles all commits and PRs themselves — never run `git commit`
  or open a PR. Instead, after each deliverable, suggest a small commit
  message and a PR description for the user to use.
- **Local `npm install`/`npm run build|test|lint|typecheck` do not work
  directly on this Windows dev machine**: there's no working Python
  toolchain for node-gyp, which `better-sqlite3`'s native build needs (and
  would need for any other native dependency — avoid adding one; prefer a
  pure-JS alternative as was done for password hashing, `bcryptjs` instead
  of `bcrypt`). Verify changes instead via a throwaway Linux container,
  matching how `docker/Dockerfile.core-service` already handles this native
  build: `docker run --rm -v "$(pwd):/app" -w /app node:24-alpine sh -c
  "apk add --no-cache python3 make g++ && npm install && <command>"` (on
  Windows Git Bash, prefix with `MSYS_NO_PATHCONV=1` so `-w /app` isn't
  mangled into a Windows path). This also regenerates `package-lock.json`
  correctly when dependencies change.
