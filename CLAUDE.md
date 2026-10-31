# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phases 0–6 are complete and merged into `main`: PR #1 (Phase 0 scaffolding +
Phase 1 domain core), PR #2 (Phases 2–5 together: scale TCP integration,
camera webhooks, driver-signal relay adapter, and the print bridge), PR #3
(Phase 6 Admin UI frontend), PR #4 (Phase 6 admin backend API), PR #5
(real Hikvision ANPR camera payload + Isis New scale serial field
diagnostics/docs), a first provisional Isis New DGN scale integration, and
the software-only half of Phase 7 packaging prep — all three committed
directly to `main` (2026-10-20, no PR). See the
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
TCP client with stability-wait logic now against a **real** (but explicitly
provisional) `dgn-frame-parser.ts` for the Digi-Tron Isis New's DGN serial
protocol — see `docs/runbooks/isis-new-serial-setup.md` and the master
plan's §11; the state-byte
semantics and the stability/burst-guard rule are documented assumptions,
not a vendor-confirmed spec (master plan §7, §11). A new native
`apps/scale-bridge` app (outside Docker, same placement as `print-bridge`)
owns the physical COM port and relays it to `core-service` over TCP via
the `serialport` package — `core-service`'s TCP client/`SCALE_HOST`/
`SCALE_PORT` just point at it, unchanged structurally. `src/camera/` has the
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
integrations (relay hardware) is deferred to Phase 7 (per-PC deployment),
done on-site once we have physical access to the equipment — see master
plan §7. The camera payload and scale protocol items of that same decision
are **no longer deferred** — camera was implemented and merged once the
real vendor format was confirmed (PR #5, 2026-10-19); the scale protocol
now has a first provisional implementation (2026-10-20, merged into
`main`), both ahead of Phase 7, per the master plan §7 update. The
scale work is explicitly **not** a production sign-off (byte semantics
unconfirmed by DIGI-TRON) — the on-site validation checklist in the
runbook is still open.

**Phase 7 packaging prep (2026-10-20):** the half of Phase 7 that doesn't
need the definitive PC is also done ahead of schedule — Core Service now
actually serves the Admin UI static build (it never did before, despite
that being the documented architecture since Phase 0), `docker/docker-compose.yml`
is finalized for production (`restart: always`, a healthcheck, a required
`.env`), `scripts/windows-service-*.ps1` register `print-bridge`/
`scale-bridge` as auto-starting/auto-restarting Windows services via NSSM,
and `docs/runbooks/per-pc-deployment.md` walks through the install with
every still-hardware-dependent value (COM port, camera IPs, relay
hardware) flagged as an explicit on-site placeholder. See master plan §9
and §11.

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

**Incident & fix (2026-10-31): SQLite writes silently stopped reaching
disk after a routine container restart.** On this install, a `docker
compose up -d core-service` done the night before (2026-10-29, to pick up
PR #6's migration) left the running container's SQLite connection unable
to durably persist any further write — `core-service` kept responding
`200 OK` to every camera/scale webhook and the Admin UI kept showing
correct data (served from that same live connection's own view), but
`data/tare.sqlite` on disk hadn't gained a single new row in ~35 hours
(52 tickets' worth of real truck traffic, discovered while investigating
why one specific ticket was missing its entrance weighing). Root cause:
`src/db/client.ts` had `journal_mode = WAL`, which requires shared-memory
(mmap) coordination between SQLite connections — **this specific
install's** `docker/docker-compose.yml` bind-mounts a Windows host folder
(`../data`) into the Linux container, and that bind-mount boundary (Docker
Desktop on Windows, WSL2 backend) doesn't reliably support WAL's
shared-memory requirement. A fresh connection opened from a second
process could reproduce the failure on demand (`SQLITE_IOERR_SHORT_READ`)
while the original long-lived connection kept working from its own
in-process view. Fix: switched to `journal_mode = DELETE` (plain
file-lock-based journal, no shared-memory requirement) — one-line change,
test updated in `db/client.test.ts`. The 52 in-flight tickets were
recovered by exporting them live via the Admin API (the only remaining
copy) before restarting, then inserted directly into the SQLite file
while the container was stopped (bypassing business-logic side effects
like re-printing already-printed tickets), each tagged with a
`reconstructed_after_wal_incident` audit log entry. **This is a property
of how *this* install's `docker-compose.yml` mounts the data volume, not
an inherent SQLite/WAL limitation** — per the master plan's architecture,
every per-PC install uses this same Windows-bind-mount structure today, so
the fix is in the shared code and applies to all of them, but an install
that someday used a Docker named volume or a non-Windows host for this
file would not have hit this and could reasonably re-enable WAL for its
better write concurrency. See master plan §11 for more detail.

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
- **Verify each workspace in the environment it actually runs in
  production, not uniformly** (updated 2026-10-21 — a native, non-container
  `npm install` now works on Windows dev machines, confirmed on more than
  one, resolving `@serialport/bindings-cpp` via its bundled prebuilt
  binary with no toolchain needed; the previous blanket "local install
  doesn't work" note is outdated. **Correction (2026-10-24, confirmed
  on-site on the first definitive production PC):** `better-sqlite3` is
  *not* toolchain-free like `@serialport/bindings-cpp` — its own `install`
  script always runs `node-gyp rebuild` from source regardless of the
  prebuilt binaries it ships in its npm package, so a clean Windows
  machine still needs Python 3.x and a C++ build toolchain (Visual Studio
  Build Tools, "Desktop development with C++") before the root
  `npm install` succeeds at all. The 2026-10-21 dev machines evidently
  already had that toolchain installed for an unrelated reason, which is
  why it looked toolchain-free from there. See
  `docs/runbooks/per-pc-deployment.md` prerequisites.):
  - **`core-service` and `admin-ui` ship inside the Docker image**
    (`docker/Dockerfile.core-service` builds both and the container serves
    the result) — the Linux Alpine container is still the *authoritative*
    verification for these two, since that's literally the artifact that
    runs in production. Native Windows runs of their lint/typecheck/test
    are a fine quick sanity check, but verify any change touching them
    (and always re-verify before considering packaging/Docker work done)
    via: `docker run --rm -v "$(pwd):/app" -w /app node:24-alpine sh -c
    "apk add --no-cache python3 make g++ && npm install && <command>"` (on
    Windows Git Bash, prefix with `MSYS_NO_PATHCONV=1` so `-w /app` isn't
    mangled into a Windows path). This also regenerates `package-lock.json`
    correctly when dependencies change. Still prefer a pure-JS dependency
    over a native one for these two apps where reasonable (as was done for
    password hashing, `bcryptjs` instead of `bcrypt`) — a native dep adds
    an Alpine toolchain requirement to the image build, not because local
    verification is blocked anymore.
  - **`print-bridge` and `scale-bridge` are native Windows processes**,
    installed via NSSM and never containerized (USB/COM-port access from
    Docker on Windows is unreliable — see master plan §4.5/§11). For these
    two, verify natively on Windows directly (`npm install`, then
    `npm run build|test --workspace=@tare/print-bridge` /
    `@tare/scale-bridge`) — that now matches their real production runtime
    better than the Alpine container ever did, since the container's
    `serialport` binary is a Linux/musl build that's never the one actually
    shipped.
  - **Don't mix the two without a clean reinstall**: switching a shared
    root `node_modules` between a native Windows install and a container
    install corrupts `node_modules/.bin/*` shims for the other environment
    (symptom: `node.exe: not found` inside the container, or
    `'<tool>' não é reconhecido` natively). If you've just run one and need
    the other, delete `node_modules` everywhere first and reinstall clean
    in the target environment.
