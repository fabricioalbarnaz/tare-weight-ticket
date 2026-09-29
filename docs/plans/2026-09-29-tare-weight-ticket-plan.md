# Tare Weight Ticket System — Development Plan

Status: **Draft — awaiting review, not yet implemented.**
Created: 2026-09-29

## 1. Purpose

Fully automatic weighbridge ("balance") system. One installation runs
independently per physical scale/PC. For each truck it must:

1. Detect arrival via an entrance camera reading the plate.
2. Read weight from the scale indicator and store it as the entrance weight.
3. Signal the driver they can move on.
4. Detect departure via an exit camera reading the plate.
5. Read weight again and store it as the exit weight.
6. Signal the driver they can move on.
7. Once both weights exist, compute the net (absolute difference) and print a
   ticket automatically — no human interaction required in the normal path.
8. Provide a local Admin UI for manual correction when hardware/automation
   fails (misread plate, missed weight, printer jam, etc.).

Scale: ~200+ trucks/day per balance, one balance = one PC = one independent
install. No multi-tenant/multi-company requirement. Not expected to grow into
a larger platform — optimize for simplicity and reliability, not scale-out.

## 2. Confirmed decisions (from requirements Q&A)

| Topic | Decision |
|---|---|
| Balance PC OS | Windows |
| Camera → plate | Camera pushes an HTTP/webhook event with the plate read (ANPR camera, e.g. Hikvision/Dahua-style LPR channel) |
| Scale → weight | Digi-Tron Isis New indicator communicates over **TCP/IP** |
| Printer | Thermal receipt printer, **ESC/POS over USB** |
| Weight capture | Must wait for the indicator's **stable/settled** weight signal, not an instant snapshot |
| Driver "go" signal | Not decided by stakeholder — system will define a **pluggable signal adapter**, defaulting to a network-triggered relay (see §4.5) |
| Connectivity | Balance PC **has internet access** (not a hard offline requirement, but system must not depend on it for core flow) |
| Admin UI access | Local web app, reachable from **other PCs on the same LAN**, not just the balance PC itself |
| Duplicate/misread handling | A misread/unreadable plate can **only** be fixed by an admin. A **re-trigger of the same open entrance** replaces the record with the most recent reading (last-write-wins for the entrance leg only) |
| Ticket fields | Plate, entry date/time, exit date/time, entry weight, exit weight, net weight difference — nothing else |
| Central reporting | Not needed now. Each balance stays independent, but design should leave room for a **future** central admin UI aggregating multiple balances (not built in this phase) |
| Backend stack | Node.js / TypeScript (stakeholder preference) |

## 3. High-level architecture

Each balance PC runs one self-contained stack:

```
                 ┌─────────────────────────────────────────────┐
                 │                Balance PC (Windows)          │
                 │                                               │
  Entrance cam ──┼─▶  HTTP webhook  ─┐                           │
  Exit cam     ──┼─▶  HTTP webhook  ─┤                           │
                 │                   ▼                           │
                 │           ┌───────────────┐                   │
  Scale (TCP)  ──┼──────────▶│  Core Service  │──▶ SQLite (WAL)  │
                 │           │ (Docker, Node/ │                   │
                 │           │  TypeScript)   │──▶ Admin UI (web) │
                 │           └───────┬────────┘                   │
                 │                   │                             │
                 │      print job    │      driver signal          │
                 │                   ▼                             │
                 │           ┌───────────────┐        ┌──────────┐│
                 │           │ Print Bridge  │        │  Relay/  ││
                 │           │ (native, USB) │──USB──▶│ light    ││
                 │           └───────────────┘        │ (HTTP)   ││
                 │                                     └──────────┘│
                 └─────────────────────────────────────────────┘
```

### Components

1. **Core Service** (Docker container, Linux container via Docker Desktop
   WSL2 backend — much lighter than Windows containers, and nothing in this
   design needs Windows-native APIs inside the container):
   - HTTP endpoint(s) receiving camera webhook events (entrance/exit,
     identified by which camera/endpoint fired).
   - TCP client to the Digi-Tron Isis New indicator, with a stability wait
     (poll/parse until the "stable" flag is set, with a bounded timeout and
     retry).
   - Session/domain logic: opens a ticket on entrance, closes it on exit,
     computes net weight, flags anomalies.
   - SQLite database (durable local storage).
   - REST API backing the Admin UI.
   - Dispatches print jobs (to the Print Bridge) and driver-signal calls (to
     the relay).
   - Serves the Admin UI (static build).

2. **Print Bridge** (small native Windows process, **outside** Docker):
   USB printer access from a container is unreliable long-term on Windows.
   Two viable approaches — pick one during Phase 6, documented as an open
   spike:
   - **Preferred:** [`usbipd-win`](https://github.com/dorssel/usbipd-win)
     to pass the USB printer through into the Docker/WSL2 container, keeping
     everything containerized. Needs validation that it survives reboots and
     printer reconnects reliably in an unattended production setting.
   - **Fallback:** a tiny native Node process running directly on Windows
     (as a Windows service, e.g. via NSSM) that exposes a localhost HTTP
     endpoint; the Core Service calls it with ticket data, and it sends raw
     ESC/POS bytes to the printer.
   This is the single biggest hardware-integration risk in the plan — see
   §7 Risks.

3. **Driver signal adapter**: an interface (`signalDriver(direction: 'in' |
   'out'): Promise<void>`) with a default implementation that calls an
   HTTP-controlled relay (e.g. Shelly/Tasmota-style smart relay on the LAN)
   to trigger a light. Kept pluggable so it can be swapped for a serial/GPIO
   relay board without touching business logic, once the stakeholder
   confirms the actual hardware.

4. **Admin UI**: React + Vite SPA served by the Core Service, reachable on
   the LAN (`http://<balance-pc-ip>:<port>`), behind simple username/password
   auth (bcrypt-hashed password, session cookie — no need for anything
   heavier on a closed LAN). Capabilities:
   - Live table of today's tickets (open / closed / anomaly).
   - Manually create/edit an entrance or exit weight + timestamp for a
     plate, with a mandatory reason note (audit trail).
   - Manually trigger a reprint.
   - Hardware status panel: camera webhook last-seen, scale TCP connection
     state, printer bridge reachability, relay reachability.
   - Basic list/search of historical tickets.

## 4. Data model (SQLite)

`tickets`
| column | notes |
|---|---|
| id | PK |
| plate | normalized plate text |
| status | `OPEN`, `CLOSED`, `ANOMALY` |
| entry_at | timestamp |
| entry_weight_kg | nullable until captured |
| entry_camera_id | which camera fired |
| exit_at | timestamp, nullable |
| exit_weight_kg | nullable |
| exit_camera_id | nullable |
| net_weight_kg | computed on close = `abs(entry - exit)` |
| ticket_number | sequential, human-facing |
| printed_at | nullable |
| created_by_admin | bool, true if manually created/fixed |
| notes | admin free text, nullable |

`ticket_audit_log`
| column | notes |
|---|---|
| id | PK |
| ticket_id | FK |
| actor | `system` or admin username |
| action | e.g. `entry_captured`, `exit_captured`, `manual_edit`, `reprint`, `anomaly_flagged` |
| payload | JSON snapshot of the change |
| created_at | timestamp |

`raw_events` (traceability of every camera/scale event, independent of
whether it resulted in a ticket change — critical for debugging an
automatic, unattended system)
| column | notes |
|---|---|
| id | PK |
| source | `camera_entrance`, `camera_exit`, `scale` |
| raw_payload | JSON/text as received |
| received_at | timestamp |
| linked_ticket_id | nullable FK |

`admin_users`
| column | notes |
|---|---|
| id, username, password_hash, created_at | |

Net weight is always `abs(entry_weight - exit_weight)`, so it's correct
whether the truck arrived empty/left loaded or arrived loaded/left empty —
no need to track load direction explicitly for the ticket, though it can be
inferred (`entry > exit` = unloaded, `entry < exit` = loaded) and shown in
the Admin UI for context.

## 5. Business rules (session state machine)

- **Entrance camera fires** for plate `X`:
  - No open ticket for `X` → create new `OPEN` ticket, start scale read
    (wait for stable weight), fill `entry_weight_kg`/`entry_at`, trigger
    driver signal.
  - Open ticket already exists for `X` → **replace** its entry weight/time
    with the new reading (last-write-wins, per stakeholder decision), log to
    `ticket_audit_log`.
  - Plate unreadable/empty from camera payload → log to `raw_events` only,
    create nothing automatically, surface in Admin UI as an unresolved
    camera event needing manual ticket creation.
- **Exit camera fires** for plate `X`:
  - Open ticket exists for `X` → capture exit weight (stable read), close
    ticket (`CLOSED`), compute net weight, trigger driver signal, enqueue
    print job.
  - No open ticket for `X` → flag as `ANOMALY` raw event (truck leaving
    without a recorded entrance) — do **not** guess; needs admin
    resolution. Do not print automatically.
  - Plate unreadable → same as entrance: logged, no automatic action, needs
    admin.
- **Scale read timeout** (indicator never reports stable weight within a
  bounded time, e.g. 15s): mark the relevant ticket leg with a
  `weight_capture_failed` flag instead of silently storing a bad/unstable
  number; still trigger the driver signal (truck shouldn't be stuck on the
  scale because of a software hiccup) and require admin follow-up to fill
  the weight in.
- **Print** happens automatically exactly once per ticket transition into
  `CLOSED`, tracked via `printed_at` to avoid duplicate prints from retries;
  Admin UI can force a reprint explicitly.

## 6. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language/runtime | Node.js (LTS) + TypeScript, strict mode | Team preference; one language across backend + admin UI; good HTTP/TCP support |
| Web/API framework | Fastify | Lightweight, first-class schema validation (useful for untrusted camera webhook payloads), fast |
| DB | SQLite (`better-sqlite3`) + Drizzle ORM for schema/migrations | Zero ops, single-writer is fine at 200 trucks/day, file-based (trivial backup), typed queries |
| Admin UI | React + Vite + TypeScript, Tailwind for styling | Small SPA is enough; built assets served by the Core Service, no separate hosting |
| Scale integration | Custom TCP client (`net` module) with a parser for the Isis New protocol frames | Direct dependency-free integration; protocol confirmed against vendor manual in Phase 2 spike |
| Camera integration | Fastify HTTP routes + JSON schema validation | Matches "camera pushes webhook" model |
| Printer | ESC/POS raw command generation (`node-thermal-printer` or hand-rolled minimal ESC/POS buffer) via the Print Bridge | Simple, no vendor SDK lock-in |
| Driver signal | Small internal adapter interface, default HTTP relay call | Keeps hardware swap low-risk |
| Testing | Vitest (unit + integration), a mock TCP server for the scale, a mock HTTP client for camera/printer/relay calls | Fast, TS-native, no separate runner needed |
| Lint/format | ESLint + Prettier, TypeScript `strict` | Baseline hygiene |
| Monorepo tooling | npm workspaces (no Nx/Turborepo) | Project is small; extra tooling isn't justified |
| Containerization | Docker + docker-compose, Linux containers via Docker Desktop (WSL2 backend) | Portable, restart policies, consistent runtime across the 3 PCs |
| CI | GitHub Actions (lint → typecheck → unit tests → integration tests → docker build) | Standard, easy to adapt if a different git host is used |

Repo layout (npm workspaces monorepo):

```
tare-weight-ticket/
  apps/
    core-service/        # Fastify API, scale/camera integration, session logic, serves admin UI build
    admin-ui/             # React/Vite SPA
    print-bridge/         # native Windows process (or usbipd-win container variant)
  packages/
    shared/                # shared TS types/schemas (ticket, events, config)
  docker/
    docker-compose.yml
    Dockerfile.core-service
  docs/
    plans/
    runbooks/              # per-PC install/config runbook (Phase 8)
  .github/workflows/
  .env.example
```

## 7. Risks / open items to validate before or during implementation

These are the things this plan cannot fully resolve from a conversation —
flagging them now so they're deliberate decisions, not surprises mid-build:

1. **USB printer inside Docker on Windows.** Needs a Phase 6 spike to
   confirm `usbipd-win` works reliably unattended (survives reboot, printer
   power-cycle, USB replug) before committing to it over the native print
   bridge fallback.
2. **Exact Digi-Tron Isis New TCP protocol.** Need the vendor's
   communication protocol manual (frame format, stability flag, unit,
   polling vs. push) to write the real parser. Phase 2 starts with a spike:
   capture raw TCP traffic against the actual indicator (or its simulator)
   before finalizing the parser.
3. **Exact camera model/webhook payload format.** "Pushes an HTTP webhook"
   covers many ANPR vendors with different JSON/XML shapes and auth
   schemes. Phase 3 needs the actual camera model to build the exact
   payload adapter (kept isolated behind a small normalization layer so
   swapping camera vendors later doesn't touch core logic).
4. **Driver signal hardware** is not chosen yet. Default network relay
   assumption should be confirmed or replaced before Phase 5.
5. **Admin auth strength**: username/password + session cookie is proposed
   as "enough" for a closed LAN. Confirm no stronger requirement (e.g. AD
   integration) exists.
6. **Windows auto-start**: Docker Desktop must be configured to launch on
   boot and containers set to `restart: always`; the print bridge (if kept
   native) needs to run as a Windows service. This needs to be part of the
   per-PC install runbook (Phase 8), not just a docker-compose file.

## 8. Testing strategy

- **Unit tests**: session state machine (all branches in §5), weight
  parser, plate normalization, net-weight calculation, ESC/POS ticket
  formatting — no I/O, pure functions where possible.
- **Integration tests**: spin up the Core Service against a mock TCP scale
  server and mock HTTP endpoints standing in for camera/printer-bridge/relay
  calls; drive full entrance→exit→print flows including anomaly paths
  (misread plate, exit without entrance, retrigger, timeout).
- **Contract fixtures**: once the real camera payload and scale protocol are
  known (see Risks), capture real sample payloads/frames as fixtures so
  tests stay honest to production data.
- **Admin UI**: component tests for the ticket table/edit forms; a handful
  of Playwright smoke tests for the critical manual-fix flow (edit weight →
  audit log entry appears → reprint works) — kept minimal, not exhaustive
  E2E coverage.
- **CI gate**: lint + typecheck + unit + integration tests + docker build,
  required to merge.

## 9. Implementation phases

Each phase should land as its own PR(s) with tests, and the system should be
runnable (even if incomplete) at the end of every phase.

- **Phase 0 — Scaffolding**: repo init, npm workspaces, TS/ESLint/Prettier
  config, empty Fastify app with a health check, Dockerfile +
  docker-compose skeleton, GitHub Actions CI skeleton, this plan committed.
- **Phase 1 — Domain core**: SQLite schema + Drizzle migrations, ticket
  session state machine and all business rules from §5, fully unit tested,
  no real hardware yet (in-memory fakes for scale/camera/printer/relay).
- **Phase 2 — Scale integration**: TCP client for Isis New, stability-wait
  logic, protocol parser (after the vendor-manual/spike from §7.2), mock-TCP
  integration tests.
- **Phase 3 — Camera integration**: webhook endpoints, payload
  normalization for the actual camera model, plate validation, wired into
  the session state machine, integration tests for entrance/exit/misread/
  retrigger paths.
- **Phase 4 — Driver signal**: adapter interface + default relay
  implementation, wired to fire right after each successful weight capture.
- **Phase 5 — Print bridge & ticket printing**: ESC/POS ticket template,
  print bridge service (chosen approach from §7.1), single-print-per-ticket
  guarantee, manual reprint support.
- **Phase 6 — Admin UI**: auth, dashboard, manual edit/create/reprint
  flows, hardware status panel, audit trail view.
- **Phase 7 — Packaging & per-PC deployment**: finalize docker-compose for
  production, Windows auto-start configuration, `.env`-based per-balance
  config, written install runbook for replicating to the 3 PCs.
- **Phase 8 — Hardening**: structured logging + rotation, reconnect/retry
  resilience for scale/camera/printer/relay outages, SQLite backup strategy,
  basic load validation at ~200+ tickets/day, security pass on the Admin UI
  and LAN exposure.
- **Phase 9 — Future/not-in-scope now**: central multi-balance admin UI
  aggregating the 3 independent SQLite stores. Not built in this project
  phase; the data model and a simple export endpoint should just avoid
  making this harder later.

## 10. Explicit non-goals (keeping this simple)

- No multi-tenant/company support.
- No cloud dependency for the core automatic flow.
- No heavyweight message queue/event bus — a single process handling
  webhook + TCP + SQLite is enough at this volume.
- No microservices split beyond Core Service / Print Bridge (split only
  forced by the Windows USB constraint, not by scale).
- No built-in multi-balance aggregation yet (see Phase 9).
