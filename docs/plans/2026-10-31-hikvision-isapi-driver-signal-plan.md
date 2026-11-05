# Hikvision ISAPI driver-signal adapter — implementation plan

**Status: all 4 steps implemented, awaiting user validation before
commit.** Research was done and implementation deliberately paused until
2026-11-04, when the user gave the explicit go-ahead to implement the
whole plan in one pass ("a configuração acontecerá depois in loco, mas
temos que deixar tudo pronto") and said they'll validate and commit
everything together at the end — see the per-step status markers below
for what that implementation covers. History: the gated ANPR/Entrance
ISAPI developer guide (Hikvision TPP, Materials License Agreement signed
2026-10-31) cleared and was read 2026-11-04 morning (see
`docs/runbooks/hikvision-tcg406-relay-findings.md`'s "Confirmed from the
gated ISAPI_Vehicle Access Control Management_ANPR Cameras guide"
section), then later the same day the user clarified this install's
camera relay is wired to an audible siren, not a barrier gate (see that
runbook's "Correction" section) — which is why the chosen endpoint below
is the generic `IO/outputs/<ID>/trigger`, not the dedicated
`barrierGate`/`barrierGateCtrl` endpoints the morning update had
confirmed.

## Background

The driver "move on" signal (master plan §4.5) currently only has one
adapter: `createHttpRelayDriverSignalAdapter`
(`apps/core-service/src/driver-signal/http-relay-adapter.ts`), a bare
HTTP GET to a to-be-chosen network relay (Shelly/Tasmota-style). The user
asked (2026-10-31) to investigate whether the Hikvision ANPR camera
itself (DS-TCG406-E(S), confirmed model) can be used as that relay instead
of/alongside a separate relay box, since the camera has its own
2-channel relay output built in.

Research findings are recorded in
`docs/runbooks/hikvision-tcg406-relay-findings.md` (sessions 2026-10-23,
2026-10-31, and 2026-11-04 — two updates the latter day). The
model-family-specific "ISAPI_Vehicle Access Control Management_ANPR
Cameras" gated guide confirmed dedicated barrier-gate endpoints, but the
user then clarified this install's relay is wired to a **siren**, not a
gate — those dedicated endpoints are scoped to a relay channel assigned
the gate-control function and don't apply here. Summary of what's
actually relevant for this install:

- **Chosen endpoint** (back to the generic trigger, per the "Correction"
  section in the runbook): `PUT /ISAPI/System/IO/outputs/<ID>/trigger`
  with an `IOPortData` XML body (`outputState: high` then `low`, or rely
  on the port's own `pulse` config if set up on-site so only `high` is
  ever needed). This is relay-channel-agnostic — it works regardless of
  which `relayFunction` the channel is assigned, unlike `barrierGate`/
  `barrierGateCtrl` which are scoped to the gate entity specifically.
- **One-time on-site config step**: assign `relayFunction: 4` ("alarm
  signal") — not `1` ("open barrier gate") — to the relay channel wired to
  the siren, via `PUT /ISAPI/ITC/Entrance/entranceParam` or the camera's
  web UI. `ctrlMode` (platform vs. camera control) is a barrier-gate-only
  concept per the guide and likely doesn't apply to an alarm-signal relay
  — to be confirmed on-site.
- HTTP Digest auth against the camera's admin credentials (confirmed in
  both the general ISAPI guide and the ANPR-specific guide's
  request-examples chapter).
- **No status read-back exists for this path** (unlike `barrierGate`'s
  `barrierGateStatus`) — the generic `IO/outputs/<ID>/status` endpoint
  only reports the raw electrical level, not any siren-specific state.
  `getStatus()` stays limited to `lastSuccessAt`/`lastFailureAt`, same as
  the existing `http-relay-adapter.ts`.
- **Not tested against a real unit.** Per the runbook, on-site
  verification (Phase 7, per-PC deployment) must confirm the output `<ID>`
  (and that it maps to the same relay channel numbering used by
  `relayNum`/`relayFunction` in `entranceParam`) and that the trigger call
  actually sounds the siren, before this adapter can be considered
  production-ready — same caveat level already applied to the scale
  protocol (master plan §11).
- The dedicated `barrierGate`/`barrierGateCtrl` endpoints found in the
  gated guide remain documented in the runbook for a possible future
  install that does use an actual gate on this relay output, but are out
  of scope for this adapter.

## Why a new adapter, not a new interface

No change to `DriverSignalAdapter`
(`apps/core-service/src/driver-signal/types.ts`). This is a second
implementation of the same interface, selected by config — same pattern
as how `ScaleClient`/`PrintClient` are each a single concrete
implementation behind an interface.

## Steps

### Step 1 — Digest-auth HTTP helper (no new dependency)

**Status: done.** `apps/core-service/src/driver-signal/isapi-digest-auth.ts`
+ `isapi-digest-auth.test.ts`. Verified: typecheck, lint, and the new
tests pass natively and inside the `node:24-alpine` container (the
authoritative environment for this workspace per CLAUDE.md). One
unrelated, pre-existing flake was observed only inside the container
(`src/app.test.ts`'s `GET /health` test timing out at the default 5s on a
cold run, likely slow native `better-sqlite3` init under this machine's
Alpine emulation) — it passes consistently natively and doesn't touch any
file this step changed; not investigated further here since it's outside
this plan's scope.

Add `apps/core-service/src/driver-signal/isapi-digest-auth.ts`: a small
pure-JS HTTP Digest auth helper (RFC 7616-style, MD5 — ISAPI devices use
MD5 digest) using Node's built-in `crypto` module, not a new npm
dependency (matches the existing preference for pure-JS deps in
core-service, since it ships inside the Alpine Docker image). Flow: issue
the request once; on a `401` with a `WWW-Authenticate: Digest ...`
header, parse `realm`/`nonce`/`qop`/`opaque`, compute the digest response,
and retry once with an `Authorization: Digest ...` header. Unit-test
against a fake HTTP server that issues a real digest challenge (no
mocking the challenge/response math itself).

### Step 2 — `hikvision-isapi-adapter.ts`

**Status: done.** `apps/core-service/src/driver-signal/hikvision-isapi-adapter.ts`
+ `hikvision-isapi-adapter.test.ts` (7 tests: high-then-low sequence with
real digest auth against a test server, entrance vs. exit output
targeting, no-op when a direction has no configured camera, non-2xx
response, timeout, and `getStatus()`). All pass natively; container
verification done together with Steps 1–3 below.

Add `apps/core-service/src/driver-signal/hikvision-isapi-adapter.ts`
implementing `DriverSignalAdapter`:
- Options per direction (`in`/`out`): camera base URL, output `<ID>`,
  username/password, timeout — entrance and exit are very likely two
  separate physical cameras/lanes, each with their own siren relay, so
  this mirrors `HttpRelayDriverSignalOptions`'s existing `entranceUrl`/
  `exitUrl` split rather than assuming one shared camera.
  - `pulseMs` (default e.g. 1000): `signalDriver` sends `PUT
    /ISAPI/System/IO/outputs/<ID>/trigger` with `outputState: high`, waits
    `pulseMs`, then sends `outputState: low` — matches the existing
    `http-relay-adapter.ts`'s own documented pulse pattern, since we
    cannot assume the camera's own port-level `pulse` config has been set
    up on-site.
  - Same never-throws contract as the existing adapter (`signalDriver`
    must not reject — a hardware hiccup must never block ticket
    processing, master plan §5): catch all errors, update
    `lastFailureAt`, call `onError`, and return.
- `getStatus()` returning `lastSuccessAt`/`lastFailureAt`, same shape as
  today — no richer status is available for this endpoint (see Background
  above).
- Unit tests with a mock HTTP server emulating the ISAPI digest challenge
  and the trigger endpoint: assert the exact XML body, the high-then-low
  sequence, and that a camera error/timeout resolves rather than rejects.

### Step 3 — config + adapter selection

**Status: done.** `driver-signal/config.ts` extended with
`DRIVER_SIGNAL_ADAPTER` (default `http-relay`) and the per-direction
`DRIVER_SIGNAL_HIKVISION_{ENTRANCE,EXIT}_{URL,OUTPUT_ID,USERNAME,PASSWORD}`
+ `DRIVER_SIGNAL_HIKVISION_PULSE_MS` vars; `server.ts` now picks the
adapter factory based on `driverSignalConfig.adapter`. `config.test.ts`
extended accordingly (adapter default/override/invalid-value, camera
group loading per direction, and the "URL set but a sibling field
missing" misconfiguration throwing a descriptive error per field).

Extend `apps/core-service/src/driver-signal/config.ts` with a
`DRIVER_SIGNAL_ADAPTER` env var (`http-relay` default | `hikvision-isapi`)
and, when `hikvision-isapi`, the per-direction camera URL/output-`<ID>`/
credentials/pulse env vars. Update `server.ts` to pick the adapter
factory based on that config instead of hardcoding
`createHttpRelayDriverSignalAdapter`. Default stays `http-relay` so
behavior is unchanged until explicitly opted in on-site.

### Step 4 — docs

**Status: done.** `.env.example` and
`docs/runbooks/per-pc-deployment.md`'s `.env` checklist table both updated
with `DRIVER_SIGNAL_ADAPTER` and the `hikvision-isapi`-only vars, flagged
as on-site hardware placeholders (output ID + the one-time
`relayFunction: 4` camera-side config step). Master plan §11 got a new
"Hikvision ISAPI driver-signal adapter (2026-11-04)" entry, explicitly not
a production sign-off, mirroring the scale-protocol note's caveat level.

**This plan file is intentionally kept (not deleted yet)** — per
CLAUDE.md, per-feature plan files are deleted once their work is "fully
implemented and merged"; the user has not yet validated or committed this
work (see Status at top), so deletion is premature. Delete it once this
lands on `main`.

## Explicitly out of scope

- Automating the one-time `entranceParam` `relayFunction` setup from the
  adapter itself — this is a one-time on-site configuration step (ISAPI
  call or web UI), not something `signalDriver` needs to redo on every
  signal. Document it as a deployment prerequisite instead.
- Any dedicated barrier-gate-specific ISAPI endpoint
  (`ITC/Entrance/barrierGateCtrl`, `Parking/channels/<id>/barrierGate`) —
  confirmed to exist (gated guide, 2026-11-04) but confirmed not
  applicable to this install's relay, which is assigned the "alarm
  signal" function, not "open barrier gate". Kept documented in the
  runbook for a possible future install with an actual gate.
- Removing/deprecating `http-relay-adapter.ts` — the master plan's
  default assumption (a separate Shelly/Tasmota-style relay as fallback)
  stays until the camera path is validated on-site.
