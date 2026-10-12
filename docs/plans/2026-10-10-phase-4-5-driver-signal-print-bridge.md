# Phase 4 + 5 — Driver signal & Print bridge

Status: **In progress**
Created: 2026-10-10

Per the user's standing instruction for this kind of session (same as the
Phase 2/3 session): both phases are implemented back-to-back without
pausing for review between steps. Pause only happens at the end of
Phase 5, before any commit/PR (the user handles commits/PRs themselves).
Questions can still be asked mid-flight if genuinely blocked.

Per master plan §7 risk #4: the driver-signal relay hardware isn't chosen
yet, so Phase 4 implements a generic HTTP-relay adapter behind the
pluggable `DriverSignalAdapter` interface (same placeholder-until-hardware
pattern as Phases 2/3). Per master plan §7 risk #1: the `usbipd-win` vs.
native-process spike for the print bridge hasn't happened (no USB printer
hardware available), so Phase 5 implements the **documented fallback**
approach (a native, non-Dockerized process with a localhost HTTP endpoint)
behind a pluggable `PrinterTransport`, so the plumbing can be built and
tested now and the real USB transport swapped in once hardware/the spike
resolves.

## Phase 4 — Driver signal

- [x] Step 1: `src/config/env.ts` — extract the
      `parsePositiveInt` helper already duplicated in `scale/config.ts`
      into a shared spot, and refactor `scale/config.ts` to use it.
      Also added `parseOptionalUrl` for the driver-signal relay URLs.
- [x] Step 2: `src/driver-signal/types.ts` — `DriverSignalDirection`
      (`'in' | 'out'`), `DriverSignalAdapter` interface per master plan §3.
- [x] Step 3: `src/driver-signal/http-relay-adapter.ts` — default HTTP
      relay implementation (plain `fetch`, bounded timeout, never
      rejects — a relay failure must never block ticket processing).
      Documented as a generic placeholder pending the real relay hardware.
- [x] Step 4: `src/driver-signal/config.ts` — env-based config
      (`DRIVER_SIGNAL_URL_ENTRANCE`/`_EXIT`, optional — unset means
      disabled/no-op for that direction — `DRIVER_SIGNAL_TIMEOUT_MS`).
- [x] Step 5: wire into `camera/routes.ts`: call
      `driverSignalAdapter.signalDriver('in'|'out')` right after the scale
      read resolves (success or capture-failed — the truck must never be
      stuck on the scale because of a software/business outcome, matching
      master plan §5's explicit timeout rule), before calling the session
      service. Update `app.ts`/`server.ts` wiring and `.env.example`.
- [x] Step 6: unit + integration tests; update `app.test.ts`/
      `routes.test.ts` fakes. 87 tests passing (up from 67).

## Phase 5 — Print bridge & ticket printing

- [x] Step 7: fix root `package.json` workspaces order
      (`packages/*` before `apps/*`) so `npm run build`/`typecheck`
      build `@tare/shared` before anything that depends on it — verified
      empirically (build order flips when the array order flips).
- [x] Step 8: `packages/shared/src/printing.ts` — `PrintTicketRequest`/
      `PrintTicketResponse`, the wire contract between `core-service` and
      `print-bridge`.
- [x] Step 9: new workspace `apps/print-bridge` (package.json, tsconfig,
      vitest.config, matching `core-service` conventions) — explicitly
      **not** containerized (master plan: USB access from Docker on
      Windows is unreliable; this is a native process).
      - `src/escpos.ts`: pure ESC/POS ticket-template builder (plate,
        ticket number, entry/exit date-time, entry/exit/net weight —
        exactly the fields from master plan §2, nothing else).
      - `src/printer-transport.ts`: pluggable `PrinterTransport`; default
        implementation writes the job to a local file (placeholder —
        no real printer hardware/spike yet, per §7 risk #1).
      - `src/app.ts` + `src/server.ts`: Fastify app, `POST /print`
        validates the shared contract, builds ESC/POS, sends via the
        transport, responds `{ success, error? }`.
- [x] Step 10: `core-service/src/printing/print-client.ts` — HTTP client
      to the print bridge; never throws (printing failures must not break
      ticket processing — matches the "no human interaction in the normal
      path, Admin UI only for manual correction" principle).
- [x] Step 11: `core-service/src/tickets/repository.ts` — add
      `markPrinted(ticketId, printedAt)`, guarded to `status = 'CLOSED'`
      rows only (same guard style as `updateEntry`/`close`).
- [x] Step 12: `core-service/src/printing/print-service.ts` — wraps the
      print client + repository: `printIfNeeded(ticket)` (auto, no-op if
      `printedAt` already set — the single-print-per-ticket guarantee from
      master plan §5) and `reprint(ticketId)` (manual, forces a reprint
      regardless of `printedAt`, for the eventual Admin UI button). Both
      append a `ticket_audit_log` row (`ticket_printed` /
      `ticket_reprinted` / `ticket_print_failed`).
- [x] Step 13: wire `printIfNeeded` into the exit webhook route right
      after a successful `ticket_closed` outcome; add
      `POST /tickets/:id/reprint` (printing-specific route file) backing
      the "manual reprint support" deliverable ahead of the Phase 6 UI
      that will call it.
- [x] Step 14: tests for all of the above (`escpos.test.ts`,
      `printer-transport.test.ts`, print-bridge `app.test.ts`,
      `print-client.test.ts`, `print-service.test.ts`, repository test
      additions, camera routes test additions, reprint route test). 104
      core-service tests + 10 print-bridge tests, all passing.
- [x] Step 15: `.env.example` additions (`PRINT_BRIDGE_URL` for
      core-service, `PRINT_BRIDGE_PORT`/`PRINT_BRIDGE_OUTPUT_DIR` for the
      bridge itself); `server.ts` wiring for both apps.
- [x] Step 16: docs — updated master plan status/§11, updated
      `CLAUDE.md` project status.
- [x] Step 17: `npm run lint`, `npm run typecheck`, `npm run test`,
      `npm run build` all green from repo root. `docker build -f
      docker/Dockerfile.core-service .` succeeded; full container smoke
      test (health → entrance → exit with print bridge unreachable →
      reprint) worked end-to-end with no crashes, printing failure handled
      gracefully as designed. Also ran `apps/print-bridge` standalone
      (outside Docker, matching its native-process design) and confirmed
      `/print` writes correct ESC/POS bytes to a file.

All steps complete. Pausing here per the user's instruction, before any
commit/PR.

Delete this plan file once this work is merged (per `CLAUDE.md`).
