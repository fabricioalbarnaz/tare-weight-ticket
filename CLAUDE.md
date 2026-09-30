# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phase 0 (scaffolding) is complete and verified end-to-end. npm workspaces,
TS/ESLint/Prettier, and a minimal `@tare/core-service` Fastify app (with a
`/health` route) exist; `docker build -f docker/Dockerfile.core-service .`
builds and runs successfully (verified `GET /health` from inside the
running container).

Phase 1 (domain core) is complete — see
`docs/plans/2026-09-29-phase-1-domain-core-plan.md` for the full
step-by-step history and the design decisions made along the way (most
notably: `entryAt` is nullable to support `ANOMALY` tickets created from an
exit-without-entrance event, and scale timeouts are handled by the same
entrance/exit handlers rather than a separate code path). `core-service`
now has: a Drizzle/SQLite schema and migrations (`src/db/`), a ticket
repository (`src/tickets/repository.ts`), and a session service
(`src/tickets/session-service.ts`) implementing every business rule from
the master plan's §5, all backed by real temp-file SQLite DBs in tests (no
mocking the DB). `npm run lint`, `npm run typecheck`, `npm run test` (31
tests), and `npm run build` all pass from the repo root under Node 24.
Nothing is wired into HTTP routes yet — that starts in Phase 3.
Awaiting user review before starting Phase 2 (scale integration).

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
