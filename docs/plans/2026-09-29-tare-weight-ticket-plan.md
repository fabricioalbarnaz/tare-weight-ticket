# EixoLink — Tare Weight Ticket System — Development Plan

Product name: EixoLink (chosen 2026-10-10; INPI/domain not yet checked).

Status: **Approved — Phases 0–6 merged (PR #1–#4): domain core, scale/camera integration, driver-signal relay, print bridge, and the Admin UI (frontend + backend admin API). The real Hikvision ANPR camera payload (§7 item 3) is also implemented and merged (PR #5). A first provisional version of the real Digi-Tron Isis New scale integration (§7 item 2) is implemented and merged into `main` — see §11; it is not a production sign-off (byte semantics unconfirmed by the vendor). Printer transport (`usbipd-win` spike) and driver-signal relay hardware remain deferred to the on-site deployment phase — see §7. The software-only half of Phase 7 (packaging/deployment prep that doesn't depend on the definitive PC) is also done — see §9 and §11.**
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
| entry_at | timestamp, **nullable** — an `ANOMALY` ticket created from an exit-without-entrance event (§5) has no entry data at all |
| entry_weight_kg | nullable until captured |
| entry_camera_id | which camera fired |
| entry_capture_failed | bool, set when the scale read timeout in §5 hits on the entrance leg (added during Phase 1 implementation to represent that rule in the data model) |
| exit_at | timestamp, nullable |
| exit_weight_kg | nullable |
| exit_camera_id | nullable |
| exit_capture_failed | bool, same as `entry_capture_failed` but for the exit leg |
| net_weight_kg | computed on close = `abs(entry - exit)`; left `null` if either weight is missing (e.g. an `entry_capture_failed` ticket) — a `CLOSED` ticket with `net_weight_kg: null` is the signal for the admin UI to surface it as needing attention |
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
| Scale integration | `core-service`: custom TCP client (`net` module) + DGN frame parser. `apps/scale-bridge`: native process (outside Docker, like the print bridge) using `serialport` to own the physical COM port, relaying raw bytes to `core-service` over TCP | Keeps `core-service`'s TCP-client abstraction unchanged; isolates the one native serial dependency in a small native process, same tradeoff already accepted for the print bridge's USB access |
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
    scale-bridge/          # native Windows process relaying the Isis New COM port over TCP (added 2026-10-20)
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
flagging them now so they're deliberate decisions, not surprises mid-build.

**Decision (2026-10-13):** items 2–4 below (scale protocol, camera payload,
driver signal hardware) require physical access to equipment we don't have
yet in this development environment. Rather than block on vendor manuals
that may never arrive before install day, these are explicitly deferred:
the pluggable interfaces/placeholders built in Phases 2–4 stay as-is, and
finishing them (real frame parser, real payload adapter, confirmed relay
hardware) is in-scope for Phase 7 (Packaging & per-PC deployment), done
on-site against the real equipment. Everything else (domain core, admin
backend/frontend, print bridge against the placeholder transport) proceeds
now without waiting on hardware.

**Update (2026-10-15):** item 3 (camera payload) no longer needs to wait
for on-site hardware access — the real camera model and webhook payload
format are now confirmed from a vendor-accurate capture (see the updated
item 3 below), so the adjustments it describes can be scheduled as their
own change ahead of Phase 7 once the user decides to prioritize it. Items
2 and 4 (scale protocol, driver-signal relay hardware) are unaffected and
remain deferred to Phase 7 — no equivalent findings exist for those yet.

1. **USB printer inside Docker on Windows.** Needs a Phase 6 spike to
   confirm `usbipd-win` works reliably unattended (survives reboot, printer
   power-cycle, USB replug) before committing to it over the native print
   bridge fallback.
   **Resolved on-site (2026-10-24), moot:** the first definitive PC's
   printer turned out to be network-attached (Windows `Get-Printer` showed
   a `POS80 Ticket` printer with its `PortName` as an IP), not USB — see
   §11. Neither `usbipd-win` nor the native-fallback question applies to
   this install; a `PrinterTransport` sending raw ESC/POS bytes over TCP to
   the printer's raw/JetDirect port was built instead. Future PCs should
   still check `Get-Printer` first rather than assuming USB.
2. **Exact Digi-Tron Isis New TCP protocol.** Need the vendor's
   communication protocol manual (frame format, stability flag, unit,
   polling vs. push) to write the real parser. Phase 2 starts with a spike:
   capture raw TCP traffic against the actual indicator (or its simulator)
   before finalizing the parser.
   **As of 2026-10-10:** neither the vendor manual nor access to the
   indicator/simulator is available yet. Phase 2 should therefore start
   with a pluggable frame-parser interface plus a mock TCP scale server,
   so the stability-wait logic and session wiring can be built and tested
   now; the real Isis New parser and captured-frame fixtures are added
   once the manual or hardware access arrives.
   **Field update (2026-10-17):** a supplied Isis New user manual and live
   RS-232 access are now available. Standalone Windows captures using an FTDI
   USB-RS-232 adapter matched the indicator at 9600 8N1 with DTR enabled.
   Serial DGN continuous acquisition is the field-tested direction for this
   installation. Opening bursts, fresh-sample guarantees, exact DGN status
   flags, and the Windows/Docker deployment boundary remain unresolved. See
   [the setup and field findings runbook](../runbooks/isis-new-serial-setup.md).
   This update supersedes the earlier statement that no scale manual or
   hardware access is available, but does not establish a vendor-confirmed
   TCP/serial protocol.
   **Implemented as a provisional first version (2026-10-20):** the
   placeholder TCP parser is replaced by a real `dgn-frame-parser.ts`, and a
   new native `apps/scale-bridge` app (same outside-Docker placement as
   `apps/print-bridge`, for the same USB/COM-port-from-Docker-on-Windows
   reason) relays the physical COM port to `core-service` over TCP — see
   §11 for the decisions made. This closes the "introduce a serial transport"
   requirement from the runbook, but the state-byte semantics and the
   burst-guard timing remain explicit **provisional assumptions**, not a
   vendor-confirmed DGN spec — the runbook's on-site validation checklist
   (cold boot, PC reboot, known-good adapter, DIGI-TRON's own spec) is still
   open. Do not treat this as production acceptance for unattended ticket
   issuance.
3. **Camera model/webhook payload format — confirmed 2026-10-15.** The
   camera hardware is a Hikvision ANPR unit (`iDS-2CD7A46G0/P-IZHS` family)
   pushing events via the ISAPI `Event/notification/httpHosts` mechanism.
   These findings were captured against a different project
   (`truck-load-queue`, same camera hardware) and are recorded in full at
   `C:\Users\fabri\Documents\Sites\truck-load-queue\docs\anpr-event-payload-findings.md`
   — only the camera-specific parts of that analysis apply here; its
   app-specific conclusions (Rails controller names, `Event#payload`, etc.)
   don't. Confirmed shape, which **supersedes** the generic
   `{ plate, cameraId, timestamp }` JSON placeholder currently implemented
   in `src/camera/payload-schema.ts`/`normalize.ts` (built per the Phase
   2–3 note in §11 before any real camera info was available):
   - **Transport is `multipart/form-data`, not JSON** — this is the
     camera's fixed behavior for ANPR events, not a configuration option.
     Parts: `anpr.xml` (`Content-Type: application/xml`, the event
     metadata) plus three JPEGs (`detectionPicture`, `featurePicture`,
     `licensePlatePicture`) identified by their `Content-ID` header, not
     by form field name or their GUID-looking filenames.
   - **`anpr.xml` root** is
     `<EventNotificationAlert version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">`,
     with `ipAddress`, `macAddress`, `dateTime`, `eventType`, `eventState`,
     `deviceID`, `UUID`, `picNum`, `deviceUUID` at the top level, and the
     plate data nested under `<ANPR>`: `licensePlate`,
     `originalLicensePlate` (agreed with `licensePlate` in every capture
     seen so far — redundant), `confidenceLevel`, `plateCharBelieve` (one
     confidence value per character of `licensePlate` — a built-in,
     per-character read-quality signal), `direction`, `country`,
     `plateType`, `plateColor`, `vehicleType`, `vehicleInfo`. The plate and
     confidence repeat a third time under `PlateInfoList > PlateInfo`. The
     payload also carries a lot of AI-cabin/driver-feature fields
     (`pilotsafebelt`, `smoking`, `helmet`, etc., all `unknown` on the
     captured config) and picture bounding-box fields (`plateRect`,
     `vehicelRect`) that are not relevant to this system.
   - **Implemented and merged (2026-10-19, PR #5)** — see §11 for the
     decisions made while implementing. The adjustments made:
     - Webhook routes must accept `multipart/form-data` (e.g. via
       `@fastify/multipart`) instead of a JSON body with Fastify schema
       validation; the route needs to pull `anpr.xml` and the three JPEG
       parts out of the multipart stream by `Content-ID`.
     - Add an XML parser (e.g. `fast-xml-parser`) to extract
       `licensePlate` (either `ANPR > licensePlate` or
       `PlateInfoList > PlateInfo > licensePlate` — pick one as canonical
       since both have agreed in every capture so far), `confidenceLevel`,
       `dateTime`, `deviceID`.
     - Decide a minimum `confidenceLevel`/character-count threshold before
       treating a plate read as reliable enough to auto-act on, vs. routing
       it to the existing `plate_unreadable`/`raw_events`-only outcome from
       §5. Per the truck-load-queue findings, a short `licensePlate` (fewer
       characters than the expected Mercosul 7-character format) should be
       treated with suspicion even when every individual
       `plateCharBelieve` value is high (95–99%) — a real capture there
       produced a 5-character read that was likely a truncated 7-character
       plate despite high per-character confidence, so character *count*
       needs its own check independent of `confidenceLevel`.
     - Decide whether entrance vs. exit continues to be determined by which
       webhook URL/camera fired (current §5/§9 approach — each physical
       camera configured with its own `httpHosts` target), or by the
       payload's own `<ANPR><direction>` field now that it's confirmed to
       exist. Leaning toward keeping the current per-endpoint approach — it
       doesn't depend on trusting the camera's own direction
       classification — unless a reason to change surfaces.
     - **Decided (2026-10-21): images are not stored at all** — only the
       plate value (plus `cameraId`/`timestamp`) is kept. This matches
       what was already implemented: `readAnprXmlPart` in
       `src/camera/routes.ts` drains and discards the three JPEG parts,
       and `recordRawEvent` only ever persists
       `{ rawPlate, plate, cameraId, timestamp }` to `raw_events.raw_payload`
       — never the full `anpr.xml` or any image bytes. No code change was
       needed to close this decision, only confirming it as intentional.
     - `src/camera/payload-schema.ts`/`normalize.ts` stays the isolation
       boundary (per the existing Phase 2–3 design note in §11): only those
       files plus the route's content-type/parsing handling should need to
       change; the session service keeps consuming the same normalized
       `{ plate, cameraId, timestamp }` shape it does today.
   - **Still not known for this project specifically** (the findings above
     are camera-hardware-only, carried over from `truck-load-queue`, and
     need confirming against this project's actual two cameras once
     reachable): the real IP/hostnames, which `deviceID` maps to entrance
     vs. exit, and TLS/auth configuration for the `httpHosts` push target.
   - **Scale integration (§7.2) remains fully unconfirmed** — no equivalent
     real-protocol findings exist yet for the Digi-Tron Isis New indicator.
4. **Driver signal hardware** is not chosen yet. Default network relay
   assumption should be confirmed or replaced before Phase 5.
5. **Admin auth strength**: username/password + session cookie is proposed
   as "enough" for a closed LAN. Confirm no stronger requirement (e.g. AD
   integration) exists. **Confirmed (2026-10-21):** username/password +
   session cookie is sufficient for now — no AD/SSO integration planned.
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
  E2E coverage. **Done (2026-10-21)**: `apps/admin-ui/e2e/manual-correction.spec.ts`
  (against the MSW mock fixtures, same as local dev), wired into CI.
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
  flows, hardware status panel, audit trail view. **Merged** — frontend
  (PR #3) and backend admin API (PR #4); see §11 for implementation
  decisions.
- **Phase 7 — Packaging & per-PC deployment**: finalize docker-compose for
  production, Windows auto-start configuration, `.env`-based per-balance
  config, written install runbook for replicating to the 3 PCs. **Also
  where the deferred real hardware integrations (§7 decision above) get
  finished, on-site against the actual scale, camera, and relay.**
  **The software/packaging half that doesn't depend on the definitive PC
  is done (2026-10-20, see §11): Core Service now serves the Admin UI
  static build, production `docker-compose.yml` is finalized, NSSM-based
  Windows service scripts exist for the native apps, and
  `docs/runbooks/per-pc-deployment.md` covers the install.** The hardware
  half (real COM port, camera IPs, relay/printer hardware selection,
  on-site validation) is still open and happens once the PC is available.
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

## 11. Implementation notes from completed phases

Decisions and lessons from Phases 0–1 that are not obvious from the code
alone (the per-phase working plans were deleted after merge, per
`CLAUDE.md`):

- **Node 24** is the pinned runtime (Active LTS; `.nvmrc`, `engines`,
  Docker base image). A project-level `.npmrc` pins the public npm
  registry so a personal/corporate `~/.npmrc` can't leak authenticated
  proxy URLs into `package-lock.json`.
- **`entry_at` is nullable** (see §4): an `ANOMALY` ticket created from an
  exit-without-entrance event has no entrance data at all.
- **Scale timeout is not a separate code path**: the same entrance/exit
  handlers in `session-service.ts` are called with `weightKg: null,
  weightCaptureFailed: true`. A timeout changes whether a weight was
  recorded, not which ticket operation happens.
- **No `updateExit`**: closing a ticket always sets the exit fields and
  moves it to `CLOSED` in one step. A `CLOSED` ticket with
  `net_weight_kg: null` (a leg failed to capture) is how the admin UI
  will find tickets that need attention, so no 4th status was added.
- **Repository guards**: `updateEntry`/`close` only touch rows with
  `status = 'OPEN'` and throw if nothing matched, so terminal tickets
  can't be silently mutated.
- **Transactions**: `TicketRepository.transaction(fn)` wraps Drizzle's
  synchronous better-sqlite3 transaction. Each session handler runs its
  whole find → write → audit-log → raw-event sequence inside one
  transaction, so a crash mid-sequence can't leave a ticket without its
  audit trail.
- **Re-run `docker build` whenever a native dependency is added or
  changed**, not just `npm run build`/`test` on the host. `better-sqlite3`
  needs `python3 make g++` in the Alpine `deps` stage; this only showed up
  in CI because local builds used a prebuilt binary.

Decisions and lessons from Phases 2–3 (not obvious from the code alone;
the per-feature working plan is deleted after merge, per `CLAUDE.md`):

- **Scale protocol is still a placeholder.** `src/scale/placeholder-frame-parser.ts`
  implements a made-up ASCII line format (`<ST|US>,<weightKg>`) explicitly
  documented as NOT the real Digi-Tron Isis New wire format — it exists so
  `ScaleFrameParser`/`ScaleClient` and the stability-wait logic could be
  built and tested now (master plan §7.2). Swapping in the real parser once
  the vendor manual/hardware arrives means writing a new
  `ScaleFrameParser` implementation and changing one `createParser` call
  in `server.ts`; nothing else (TCP client, webhook routes, session
  service) needs to change.
- **`ScaleClient.readStableWeight()` keeps one persistent TCP connection**
  open across calls rather than reconnecting per read (an indicator
  streams continuously; reconnecting per truck would be wasteful and
  slower). Connection failures and stability timeouts both resolve the
  same way — `{ weightKg: null, weightCaptureFailed: true }` — matching
  the master plan §5 rule that a scale hiccup must never block the driver
  signal. Reconnect/retry *resilience* (vs. just not crashing) is
  Phase 8 (Hardening) scope, not Phase 2.
- **Camera payload shape is also a placeholder**, for the same reason as
  the scale protocol: the real camera model isn't chosen yet (master plan
  §7.3). `src/camera/payload-schema.ts` + `normalize.ts` isolate the
  generic `{ plate, cameraId, timestamp }` shape from the routes and
  session service, so only those two files change once the real vendor
  payload is known.
- **Webhook routes return HTTP 200 for every business-level outcome**
  (`ticket_opened`, `ticket_retriggered`, `ticket_closed`,
  `anomaly_flagged`, `plate_unreadable`) — only a malformed request body
  (missing `cameraId`) is a 400. An unreadable plate or an exit-without-
  entrance anomaly are expected, handled outcomes per master plan §5, not
  errors.
- **`buildApp()` now takes `{ db, scaleClient }`** instead of building its
  own dependencies, so tests can inject a real temp-file SQLite db (same
  "no mocking the DB" approach as Phase 1) alongside a fake `ScaleClient`.
  `server.ts` is the only place that builds the real `Db` (from `DB_PATH`)
  and the real `createTcpScaleClient` (from `SCALE_*` env vars) for
  production.
- **`ScaleClient.readStableWeight()` serializes reads** behind an internal
  promise queue. The scale is one physical resource shared by both the
  entrance and exit routes; without serialization, two concurrent webhook
  requests could both be resolved by the same incoming stable frame
  (PR review feedback). On a stability timeout, the client also tears the
  connection down (instead of just resolving the pending read), so a frame
  that settles just after the timeout can never be mistaken for a later,
  unrelated read — the cost (one extra reconnect) is paid only on the rare
  timeout path, not on every read.
- **`loadScaleConfig` rejects malformed `SCALE_*` env vars at startup**
  (non-integer, zero/negative, or an empty string) instead of letting
  `Number()` silently coerce them to `0`/`NaN` (PR review feedback) — on a
  PC installed without a developer nearby, a bad `.env` value should fail
  loudly on boot, not cause a silent, confusing scale read failure later.
- **The TCP client re-attaches a no-op `'error'` listener during
  teardown**, after `removeAllListeners()` and before `destroy()` (PR
  review feedback): an `'error'` event with zero listeners crashes the
  Node process, and `removeAllListeners()` would otherwise leave exactly
  that gap for the remainder of `destroy()`. Keep-alive
  (`socket.setKeepAlive`) was also added so a silent half-open disconnect
  (e.g. the indicator loses power without a clean TCP close) is eventually
  detected and reconnected, instead of leaving every future read timing
  out forever until the service is restarted.

Decisions and lessons from Phases 4–5:

- **Driver signal fires right after the scale read, before the session
  service is even called** — for *every* outcome (ticket opened/
  retriggered/closed, anomaly, capture-failed, even a currently-unreadable
  plate once the scale read already happened). The truck is physically on
  the scale regardless of what the software decides about the ticket, so
  it must never be left stuck there (same principle as the §5 timeout
  rule, generalized to the whole entrance/exit flow).
- **The print bridge implements the master plan's documented *fallback*
  approach** (native process, localhost HTTP, outside Docker), not
  `usbipd-win` — that spike (§7 risk #1) hasn't happened and there's no
  USB printer hardware to test against. Per the plan's own wording for
  that fallback ("the Core Service calls it with ticket data, and it
  [the bridge] sends raw ESC/POS bytes to the printer"), ESC/POS
  generation lives in `apps/print-bridge`, not `core-service` —
  core-service only sends plain ticket data over the shared
  `PrintTicketRequest` contract. The bridge's `PrinterTransport` is
  pluggable; the only implementation today writes jobs to a file, since
  there's no printer to send real bytes to yet.
- **`packages/shared` got its first real consumer** (the print wire
  contract) in this phase, which surfaced a latent build-order problem:
  the root `package.json`'s `workspaces` array had `apps/*` before
  `packages/*`, so `npm run build`/`typecheck --workspaces` built
  `core-service`/`print-bridge` *before* `@tare/shared`, which would fail
  once those apps actually import shared types (previously harmless
  since nothing used `@tare/shared`). Fixed by reordering the array;
  verified empirically that npm's `--workspaces` execution order follows
  that array. The Dockerfile was never affected — it already built
  `@tare/shared` explicitly first.
- **`printed_at` (Phase 1 schema) is the single-print guarantee**:
  `PrintService.printIfNeeded` no-ops if it's already set, and only the
  explicit `POST /tickets/:id/reprint` (manual reprint, ahead of the
  Phase 6 Admin UI button that will call it) bypasses that check. Both
  paths share one `print()` helper so the DB write (mark printed +
  append `ticket_audit_log`) happens in one transaction, distinguishing
  `ticket_printed` (automatic) from `ticket_reprinted` (manual) by actor.
- **Printing failures never throw** — `PrintClient.printTicket` always
  resolves (`{ success: false, error }` on any network/HTTP failure), and
  the reprint route returns 200 with `{ success: false }` for business-
  level failures (ticket not found, not yet `CLOSED`, bridge down),
  matching the camera webhook routes' convention of only using HTTP error
  codes for malformed requests. A print failure is never a reason to fail
  ticket processing — the system has no human in the loop by design.

Decisions and lessons from Phase 6 — Admin backend API (merged PR #4; the
per-feature plan, `docs/plans/2026-10-13-phase6-admin-backend-api-plan.md`,
is deleted after merge per `CLAUDE.md`):

- **`bcryptjs`, not `bcrypt`**, for password hashing — avoids a second
  node-gyp/native-build dependency on top of `better-sqlite3` on a dev
  machine with no working Python toolchain for node-gyp.
- **`@fastify/cookie`/`@fastify/session` are registered only inside the
  `/api/admin` encapsulated plugin context**, not on the whole app, so the
  camera/print routes are untouched by session plumbing. An in-memory
  session store is enough — single process, single PC, no Redis needed.
- **Every mutating admin route writes an audit log entry in the same
  transaction as the mutation** (actor = logged-in username, payload
  includes the mandatory `reason` plus before/after values) — same
  transactional pattern as Phases 1–5.
- **Hardware "reachability" needed small, targeted additions, not a new
  subsystem**: `ScaleClient.getStatus()` and `DriverSignalAdapter.getStatus()`
  track state already available on the TCP client/relay adapter;
  `PrintClient.checkHealth()` reuses the print bridge's existing `/health`
  route; camera reachability derives from the most recent `rawEvents` row
  per source (`findLastEventTimestamp`), with a default 24h staleness
  window.
- **Contract types stay in `apps/admin-ui/src/api/types.ts`** as the single
  source of truth for now, duplicated by hand into the backend route layer
  rather than extracted into `packages/shared` — revisit only if the
  duplication becomes painful (flagged as a Phase 8 hardening follow-up).
- The Admin UI needed **zero code changes** to run against the real
  backend — only `VITE_API_MODE=proxy` instead of `mock` — because the
  backend routes were built to match `apps/admin-ui/src/api/types.ts` and
  `client.ts` field-for-field.

Decisions and lessons from the real Hikvision ANPR camera payload swap
(merged PR #5; the per-feature plan,
`docs/plans/2026-10-15-camera-anpr-integration-plan.md`, is deleted after
merge per `CLAUDE.md`):

- **JPEGs are drained and discarded, not stored** — no object storage
  exists in this stack, and nothing in the ticket flow needs the images.
- **The `anpr.xml` multipart part is located by its field name** (literally
  `"anpr.xml"`), not by the `Content-ID` header the three JPEG parts use —
  since the JPEGs are discarded anyway, the two never need distinguishing
  any other way.
- **Canonical plate field is `ANPR > licensePlate`** (agrees with
  `originalLicensePlate` and `PlateInfoList > PlateInfo > licensePlate` in
  every real capture seen).
- **`cameraId` now comes from the payload's `deviceID`** instead of being
  caller-supplied; entrance vs. exit is still decided by which webhook URL
  received the POST (unchanged design) — `deviceID` is stored only for
  display/audit.
- **A plate read is accepted only if `confidenceLevel >= 80` and the
  normalized plate is exactly 7 characters** (both Brazilian plate formats
  are 7 chars); anything failing either check reaches the existing
  `plate_unreadable` path with an empty `rawPlate`, rather than being
  guessed at. Both thresholds are starting points, flagged for tuning once
  there's real field data.
- **The `payload-schema.ts`/`normalize.ts` isolation boundary deliberately
  built in Phases 2–3 held exactly as intended** — `session-service.ts`
  needed zero changes; only the camera-specific files and the webhook
  routes' multipart handling changed.

Decisions and lessons from the Isis New scale integration, first
provisional version (committed directly to `main`, 2026-10-20, no PR; the
per-feature plan, `docs/plans/2026-10-20-isis-new-scale-integration-plan.md`,
is deleted after merge per `CLAUDE.md`):

- **State-byte semantics are a documented provisional assumption, not a
  vendor-confirmed DGN spec**: `D`/`F` are treated as candidate-stable,
  `@` as explicitly unstable, and **any other/unrecognized byte as
  not-stable (fail-safe)** — never guessed at. See the runbook for the full
  rationale and the still-open validation checklist.
- **One rule does double duty as both the per-truck stability wait and the
  opening-burst guard**: a weight counts only once 3 consecutive matching
  candidate readings have been seen, each spaced >= 2000ms apart from the
  previously counted one (configurable). Because every opening-burst
  capture in the runbook measured its anomalous volume as concentrated
  within the first ~1 second, this single spacing rule keeps the burst's
  thousands of rapid, syntactically-valid repeated frames from ever
  satisfying the match count — no separate "discard window" logic was
  needed. All of this lives in the new `dgn-frame-parser.ts`; per the
  existing Phase 2–3 design note, swapping the real parser in required
  zero changes to `tcp-client.ts` or anything downstream of it.
- **The transport-boundary decision mirrors the print bridge exactly**: a
  new native `apps/scale-bridge` app (outside Docker, same reason — USB/
  COM-port access from Docker on Windows is unreliable) owns the physical
  COM port via the `serialport` package (the one realistic way to reach a
  real serial port from Node; no pure-JS alternative exists, a deliberate
  exception to the "prefer pure-JS" guidance, same category as
  `better-sqlite3`) and relays raw bytes verbatim over a plain TCP socket.
  `core-service`'s `SCALE_HOST`/`SCALE_PORT` just point at the bridge
  instead of a mock — no structural change to `ScaleClient`.
- **Hardware status needed no new wiring**: `ScaleClient.getStatus()`
  already reflected the TCP connection state to whatever `SCALE_HOST`/
  `SCALE_PORT` point at, so `GET /api/admin/status`'s `scale` field now
  correctly reflects the bridge connection with zero changes. Distinguishing
  "bridge unreachable" from "bridge up but COM port/indicator not
  responding" (the bridge's own `/health` carries `serialOpen` for this)
  was deliberately left out of this first version — flagged as a Phase 8
  hardening follow-up, not implemented now.

Decisions and lessons from Phase 7 packaging prep, the software-only half
done ahead of the definitive PC (committed directly to `main`, 2026-10-20,
no PR; the per-feature plan,
`docs/plans/2026-10-20-phase7-packaging-prep-plan.md`, is deleted after
merge per `CLAUDE.md`):

- **Core Service never actually served the Admin UI build, despite that
  being the documented architecture from Phase 0** — `Dockerfile.core-service`
  never built or copied `apps/admin-ui`, and nothing registered static
  file serving. This was a real gap, not a hardware unknown, closed now:
  `@fastify/static` + a `setNotFoundHandler` SPA fallback in `app.ts`
  (registered after every API route, so it only ever catches genuinely
  unmatched GET requests — never `/api/*`), wired through an optional
  `adminUiDir` that `server.ts` only enables if a real build is present
  (keeps `npm run dev` working without one).
- **`vite build`'s `VITE_API_MODE` is inlined at build time, not read at
  runtime** — the admin-ui's own default (`mock`, MSW fixtures) would have
  silently shipped as the production bundle if the Docker build hadn't
  pinned `ENV VITE_API_MODE=proxy` before `vite build`. Caught and fixed
  by actually building the image and inspecting the served bundle, not by
  typecheck/lint alone.
- **`ADMIN_SESSION_SECRET` was a required, no-default env var that
  `.env.example` never documented** — anyone following the documented
  setup (`cp .env.example .env`) would hit a startup crash with no clue
  why. Caught the same way: running `docker compose up` for real, not just
  validating `docker compose config`.
- **`docker-compose.yml`'s healthcheck using `localhost` silently never
  passed** — Alpine resolves `localhost` to `::1` first, and the app only
  binds `0.0.0.0` (IPv4), so `wget` got "connection refused" and the
  container sat in `starting` forever. Fixed by pointing the healthcheck
  at `127.0.0.1` explicitly. Another case a syntax/config check alone
  would have missed — only running the real container surfaced it.
- **`restart: always` (not `unless-stopped`) and `env_file: required: true`
  were both deliberate**: the former per the risk list's item 6 (must come
  back up unattended even after an observed "stopped" state from a
  power-cycle); the latter because `ADMIN_SESSION_SECRET` has no safe
  default, so failing `docker compose up` immediately with a clear error
  is better than a crash-looping container.
- **`print-bridge`/`scale-bridge` read `process.env` directly, with no
  `.env`-file loader of their own** — Windows-service env vars for them
  are passed through NSSM's `AppEnvironmentExtra` (see
  `scripts/windows-service-install.ps1`'s `-EnvVar` parameter), not via a
  `.env` file like `core-service`'s Docker container uses. Two different
  mechanisms for two different process models, both ending at the same
  `process.env` contract the apps already expected.
- **What still needs the real PC, left as explicit placeholders in
  `docs/runbooks/per-pc-deployment.md`** rather than guessed at: the COM
  port name, camera IP/admin access (their entrance/exit push targets are
  configured on the cameras themselves, not in this repo's `.env`), and
  driver-signal relay hardware (still unchosen). Actually registering the
  NSSM services and Docker Desktop's sign-in behavior are on-site actions
  too — the scripts were only syntax-checked (PowerShell AST parse), never
  run, since that needs Administrator rights and a real machine.
- **The "local npm install doesn't work" note was stale, and the fix is to
  verify each workspace in its own production environment, not to pick one
  environment for everything** (2026-10-21, confirmed reproducible on more
  than one Windows machine, not a one-off): `@serialport/bindings-cpp`
  resolves via its own bundled prebuilt binary on a native Windows
  `npm install`, no toolchain needed. **Correction (2026-10-24, confirmed
  on-site on the first definitive production PC):** `better-sqlite3` is
  *not* the same — its `install` script always runs `node-gyp rebuild`
  from source regardless of the prebuilt binaries it ships in its npm
  package, so a genuinely clean Windows machine still needs Python 3.x and
  a C++ build toolchain (Visual Studio Build Tools, "Desktop development
  with C++") before `npm install` succeeds at all; see
  `docs/runbooks/per-pc-deployment.md` prerequisites. The 2026-10-21
  machines evidently already had that toolchain for an unrelated reason.
  Native Windows installs are still viable and still the *more* correct
  choice for `print-bridge`/`scale-bridge` specifically (they never run in
  Docker — the container's `serialport` binary was always a Linux/musl
  build, never the one actually shipped), but "no toolchain needed" was
  only ever true for `@serialport/bindings-cpp`. See `CLAUDE.md`'s updated
  development-workflow section. Mixing a native install and a container
  install on one shared root `node_modules` without a clean reinstall
  corrupts `node_modules/.bin/*` shims for whichever environment ran
  second (caught when a native install broke the following container-based
  `build`/`typecheck`/`lint` run with `node.exe: not found`; fixed by
  wiping `node_modules` and reinstalling clean inside the container).

### First on-site install (2026-10-24, first definitive PC)

- **`SCALE_HOST`/`PRINT_BRIDGE_URL` must be `host.docker.internal`, not
  `127.0.0.1`.** `core-service` runs inside the Docker container;
  `127.0.0.1` there is the container's own loopback, not the Windows host
  where `scale-bridge`/`print-bridge` actually listen. This affects every
  PC with this topology, not just this one — `127.0.0.1` looked like a
  reasonable same-machine default but silently made the scale and print
  bridge permanently "unreachable" in the admin status panel even with
  real hardware wired up and both bridges running. Fixed in `.env.example`
  and `docs/runbooks/per-pc-deployment.md`.
- **The scale's actual COM port must be confirmed by capturing real bytes
  and matching the indicator's display, not assumed from the serial
  runbook's example.** This PC's COM3/COM4 came from a PCI multiport card
  (not a USB-RS-232 adapter like the original diagnostic session), and
  opening a port successfully (`serialOpen: true`) only proves the OS
  could open it — not that it's wired to the scale. Confirmed COM3 by
  capturing raw bytes matching the operator-confirmed empty-platform
  display (`F000000.`) and showing COM4 was silent.
- **The printer turned out to be network-attached, not USB** — see §7
  item 1's resolution above. A real `PrinterTransport` (TCP to the
  printer's raw/JetDirect port, conventionally 9100) was built in
  `apps/print-bridge/src/printer-transport.ts`, selected via
  `PRINTER_TRANSPORT=network` (vs. the pre-existing `file` placeholder).
- **ESC/POS cut-margin bug found and fixed**: `buildTicketEscPos` fed only
  2 blank lines before the cut command, which on the installed POS80
  printer cut through the last line of printed text. Fixed to 5 blank
  lines (`FEED_LINES_BEFORE_CUT` in `escpos.ts`), confirmed by physical
  reprint on-site. This was invisible in any test that only inspects the
  generated bytes — it only showed up printing to the real printer.
- **Seeding the admin user into an already-running container's database
  needs a container restart to take effect.** Both `core-service`
  (containerized) and the seed CLI (run natively, pointed at the same
  bind-mounted SQLite file) use WAL mode, but the already-running
  container's connection didn't pick up the externally-inserted row —
  login kept failing with "Invalid credentials" against a password
  confirmed correct by hashing it directly — until the container was
  restarted. Documented in the per-pc-deployment runbook; seeding before
  first `docker compose up` avoids the issue entirely.
- **`print-bridge`/`scale-bridge` were registered as NSSM Windows
  services for the first time against a real machine** (prior phases only
  syntax-checked the install script). Required an elevated/Administrator
  PowerShell — plain `nssm install`/`nssm restart` from a non-elevated
  session fails with "Access denied" opening the service manager.
- A full entrance → real scale read → exit → real physical print smoke
  test passed end-to-end through the complete system path (camera webhook
  → scale-bridge → core-service → print-bridge → printer) — one
  successful run on one PC, not production sign-off. The serial runbook's
  on-site validation checklist (cold boot, reboot, vendor DGN spec) is
  still open.
