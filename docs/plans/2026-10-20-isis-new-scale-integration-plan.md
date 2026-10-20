# Isis New scale integration — first real version

Status: **All 6 steps done. Verified green (build/typecheck/lint/test) via
the `node:24-alpine` Docker one-liner. Not yet committed — pending user
review.**
Created: 2026-10-20

## Scope

Replace the TCP placeholder scale integration (`src/scale/placeholder-frame-parser.ts`,
`src/scale/mock-scale-server.ts`) with a first real version based on the
field-validated Isis New serial findings
(`docs/runbooks/isis-new-serial-setup.md`). Everything here is an explicit,
documented **provisional assumption**, not a vendor-confirmed protocol or a
production sign-off — see that runbook's still-open validation checklist
(cold boot, PC reboot, known-good adapter comparison, DIGI-TRON's own DGN
spec) before treating this as final.

## Design decisions (confirmed with the user, 2026-10-19/20)

1. **State-byte semantics (provisional):** `D` and `F` are candidate-stable
   readings; `@` is explicitly unstable (oscillating); **any other/unknown
   byte (`B`, `H`, or anything not yet seen) is treated as not-stable**,
   fail-safe by default — never auto-accepted.
2. **Stability/freshness rule (replaces the open-ended "5 second window"
   idea in the runbook):** a weight is accepted only once 3 consecutive
   matching candidate readings (same status class, same weight) have been
   observed, each at least 2000ms after the previously counted one — this
   single rule doubles as both the per-truck stability wait **and** the
   post-(re)connect burst guard, since the first countable sample can't
   happen until ≥2000ms after the connection opens. Configurable
   (`SCALE_STABILITY_READING_COUNT` default 3,
   `SCALE_STABILITY_SAMPLE_INTERVAL_MS` default 2000ms), not hard-coded.
   - Rationale this solves the opening burst specifically: every capture in
     the runbook measured the anomalous volume as concentrated in the
     first ~1 second after opening; a 2000ms minimum spacing between
     *counted* readings means the thousands of rapid, syntactically-valid
     repeated frames seen in the burst (e.g. `D059040.` × 7330) cannot
     satisfy 3 counted matches within that first second — only genuinely
     time-separated, post-burst readings can.
   - Known limitation, documented not silently assumed: only tested against
     ≤60-second idle intervals; cold boot / PC reboot / longer outages are
     unvalidated and could in principle produce a longer burst. Flag this
     explicitly in the runbook's still-open checklist, don't claim it's
     closed.
3. **Persistent connection** (already the existing `ScaleClient`/
   `tcp-client.ts` design — not changing) confines burst exposure to
   connection open/reconnect only, not every truck read.
4. **Transport boundary:** introduce a new native `apps/scale-bridge` app
   (mirrors `apps/print-bridge`'s placement — native, not containerized,
   same reason: USB/COM-port access from Docker on Windows is unreliable).
   It owns the physical COM port and relays raw bytes verbatim over a
   local TCP listener. `core-service`'s existing `ScaleClient`/
   `tcp-client.ts`/`SCALE_HOST`/`SCALE_PORT` need **no structural change**
   — only point them at the bridge instead of the mock server, and swap
   `createParser` from the placeholder to the new real DGN parser in
   `server.ts`. This matches the isolation boundary already documented in
   the master plan §11 ("real parser means writing a new `ScaleFrameParser`
   implementation... nothing else needs to change").
5. The `serialport` npm package (native binding) is the one realistic way
   to open a COM port from Node — there is no pure-JS alternative for real
   serial hardware access. Flag as a deliberate, necessary exception to the
   "prefer pure-JS" guidance in `CLAUDE.md` (same category as
   `better-sqlite3`), and check during Step 3 whether its prebuilt binary
   covers this Windows/Node combination without needing a local
   node-gyp toolchain (which this dev machine doesn't have).

## Steps

1. **Real DGN frame parser** —
   `apps/core-service/src/scale/dgn-frame-parser.ts`, implementing the
   existing `ScaleFrameParser` interface (zero changes to its shape):
   - CR (`0x0D`)-delimited frame extraction, validating each candidate
     token against the observed `^[A-Za-z]\d{6}\.$` shape; anything that
     doesn't match is discarded and parsing resyncs on the next CR,
     instead of throwing or desyncing permanently (required to survive the
     burst's non-ASCII/malformed bytes).
   - Status-byte classification per decision 1 above.
   - The spaced-N-match state machine per decision 2 above (constructor
     records its own "opened at" timestamp as the anchor for the first
     countable sample).
   - Unit tests (real temp-based/controllable clock, no real timers):
     well-formed `D`/`F` frames accepted after 3 spaced matches; `@` never
     counted; unknown bytes never counted; a simulated burst (thousands of
     rapid identical `D` frames delivered within milliseconds) must **not**
     be accepted; a value change mid-streak resets the match count; frames
     spaced <2000ms apart don't both count.
   Status: **done** — `apps/core-service/src/scale/dgn-frame-parser.ts` +
   `dgn-frame-parser.test.ts`, 11 tests including the simulated-burst case.

2. **Wire the real parser into `server.ts`** — replace the placeholder
   `createParser` call. Decide whether `placeholder-frame-parser.ts` /
   `mock-scale-server.ts` stay (yes — existing tests that don't need real
   DGN fidelity keep using them; this is additive, not a replacement of
   those tests).
   Status: **done** — `server.ts` now builds `createDgnFrameParser` with
   `stabilityReadingCount`/`stabilitySampleIntervalMs` from `ScaleConfig`
   (two new env vars, `SCALE_STABILITY_READING_COUNT`/
   `SCALE_STABILITY_SAMPLE_INTERVAL_MS`, defaults 3/2000ms).
   `placeholder-frame-parser.ts`/`mock-scale-server.ts` kept as-is for the
   existing `tcp-client.test.ts` suite.

3. **New native `apps/scale-bridge` app** — Node process, not
   containerized (same placement as `print-bridge`). Opens the configured
   COM port via `serialport`, listens on a local TCP port, relays raw
   bytes to any connected client, logs connect/disconnect, exposes a
   `/health` route (mirrors `print-bridge`'s pattern, for the Admin UI
   hardware-status panel later). Config via env vars (COM port name, TCP
   listen port, baud/parity/stop-bits/DTR/RTS per the runbook's confirmed
   settings).
   Status: **done** — `apps/scale-bridge`: `config.ts` (+ tests),
   `serial-transport.ts` (real `serialport`-backed transport, untested
   against real hardware — no indicator attached to this dev machine),
   `relay-server.ts` (+ tests against a fake serial source and real TCP
   sockets), `app.ts` (`GET /health`, + tests), `server.ts` entrypoint.

4. **Point `core-service` at the bridge** — update `.env`/docker-compose
   docs so `SCALE_HOST`/`SCALE_PORT` target the bridge instead of a mock;
   update the runbook with the new architecture and native-bridge install
   steps (same pattern as the print bridge's install instructions).
   Status: **done** — `.env.example` adds `SCALE_BRIDGE_*` vars and
   rewrites the `SCALE_*` comment block; README and the runbook's
   "Direction for EixoLink development" section updated.

5. **Hardware status wiring check** — confirm `ScaleClient.getStatus()`
   (already reflecting TCP connection state) correctly reflects the
   bridge's reachability for `GET /api/admin/status`; add the bridge's own
   `/health` if the Admin UI status panel should distinguish "bridge down"
   from "indicator not responding."
   Status: **done** — confirmed `hardware-status.ts`'s `scale` field needs
   no change (it already derives from `ScaleClient.getStatus()`, which now
   reflects the TCP connection to the bridge). Deliberately did **not**
   wire the bridge's own `/health` (`serialOpen`/`relayConnections`) into
   the Admin UI status panel in this first version — flagged as a Phase 8
   follow-up, not a gap being silently dropped.

6. **Final pass** — lint/typecheck/test/build across all workspaces (the
   `node:24-alpine` Docker one-liner per `CLAUDE.md`, plus a native check
   for `apps/scale-bridge` specifically since it isn't containerized).
   Update master plan §7 item 2 and §11 with the decisions made here.
   Update the runbook: mark the byte semantics and burst guard as
   "implemented as a provisional assumption," but leave the on-site
   validation checklist (cold boot, reboot, known-good adapter, vendor
   spec) explicitly open — this is not a production sign-off.
   Status: **done.** Full root-level `npm install`/`build`/`typecheck`/
   `lint`/`test` run in the `node:24-alpine` container (plus a targeted
   re-run of `src/scale` and `scale-bridge` tests with a bumped
   `testTimeout` to rule out container flakiness):
   - **Build/typecheck**: one real bug caught and fixed —
     `noUncheckedIndexedAccess` (already on in `tsconfig.base.json`) flags
     a regex-match array destructure (`const [, statusByte, digits] =
     match`) as possibly `undefined`; added an explicit guard in
     `dgn-frame-parser.ts`. Clean afterward across all 5 workspaces
     (`@tare/shared`, `@tare/admin-ui`, `@tare/core-service`,
     `@tare/print-bridge`, `@tare/scale-bridge`).
   - **Install**: `@serialport/bindings-cpp`'s install script
     (`node-gyp-build`) was blocked by the root `package.json`'s
     `allowScripts` allowlist (same npm-level protection already governing
     `better-sqlite3`/`esbuild`) — added
     `"@serialport/bindings-cpp@12.0.1": true` alongside the existing
     entries so the native binding actually builds, instead of silently
     leaving `serialport` non-functional.
   - **Lint**: clean — same 2 pre-existing `admin-ui` fast-refresh warnings
     as every prior phase's final pass, unrelated to this work.
   - **Test**: `dgn-frame-parser.test.ts` (11/11, including the
     simulated-burst case), `scale/config.test.ts` (6/6),
     `scale-bridge`'s `config.test.ts`/`relay-server.test.ts`/`app.test.ts`
     (10/10) all pass. The full-root run's first pass showed `app.test.ts`
     timing out at the default 5000ms in **three** workspaces
     (`core-service`, `print-bridge`, and now `scale-bridge` too) — this is
     the same pre-existing container-specific artifact already documented
     in the Phase 6 admin-backend plan's final pass (the *first*
     `app.inject()`/Fastify-boot in a freshly started `node:24-alpine`
     container consistently takes several seconds), reproduced here for a
     third, brand-new app, not a regression introduced by this plan's
     code. Confirmed by re-running with a bumped `testTimeout` (20000ms):
     all pass, including `scale-bridge`'s `GET /health` in ~12.7s for its
     first request.
   - **Not verified** (no physical hardware on this dev machine):
     `serial-transport.ts`'s real `createSerialPortTransport` against an
     actual COM port/indicator, and the native (non-Docker) Windows build
     of `apps/scale-bridge` itself — both require on-site hardware access
     per the runbook.

## Out of scope for this plan

- Confirming the DGN semantics with DIGI-TRON directly.
- Cold-boot/PC-reboot burst behavior (unvalidated — see runbook checklist).
- Negative weights, overload, error states, non-whole-kilogram resolutions
  — not observed in any capture yet; `dgn-frame-parser.ts` should discard
  (not guess at) anything not matching the validated shape.
- `usbipd-win`-based containerized access — superseded by the native
  bridge decision (4) above, consistent with the print-bridge precedent.
