# Hikvision ISAPI driver-signal adapter — implementation plan

**Status: research done, implementation deliberately paused.** The user
decided (2026-10-31) not to start coding yet: they have a Hikvision TPP
(Technology Partner Portal) account and signed the Materials License
Agreement needed to download the gated ANPR/Entrance-specific ISAPI
developer guide, but the portal states approval takes a few days. This
plan is being kept up to date as a record of what's ready to start once
the user says go — see `docs/runbooks/hikvision-tcg406-relay-findings.md`
for the full TPP status note. No step below should be started without an
explicit go-ahead; re-read that runbook's "Update 2026-10-31 (later same
day)" note first, in case the gated guide has cleared and changes the
chosen endpoint before Step 1 begins.

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
`docs/runbooks/hikvision-tcg406-relay-findings.md` (sessions
2026-10-23 and 2026-10-31). Summary of what's now confirmed, from
Hikvision's own general ISAPI developer guide plus the camera's own
official user manual (not forum posts this time):

- `PUT /ISAPI/System/IO/outputs/<ID>/trigger` with an `IOPortData` XML
  body (`{"outputState": "high"|"low"}`) manually fires one relay output.
  HTTP Digest (or Basic) auth against the camera's admin credentials.
- The ANPR camera's barrier gate is physically wired to one of its two
  generic relay outputs (`Relay 1` = terminals `1A`/`1B`, `Relay 2` =
  `2A`/`2B`) — there is no separate gate-specific circuit, so triggering
  the right output ID *is* opening the gate, once that relay channel has
  been assigned the barrier-gate function in the camera's own web UI
  (`Configuration > Capture > Entrance and Exit > Barrier Gate`, with
  Control Mode set to **By Platform**, meaning the camera expects our
  software to decide, matching our architecture).
- **Still unconfirmed**: the exact relay/output `<ID>` to use (depends on
  on-site wiring), and whether a *dedicated* barrier-gate ISAPI endpoint
  also exists (gated behind Hikvision's partner portal) — doesn't block
  implementation, since the generic trigger endpoint is the physical path
  either way.
- **Not tested against a real unit.** Per the runbook, on-site
  verification (Phase 7, per-PC deployment) must confirm the output `<ID>`
  and that the trigger call actually moves the gate before this adapter
  can be considered production-ready — same caveat level already applied
  to the scale protocol (master plan §11).

## Why a new adapter, not a new interface

No change to `DriverSignalAdapter`
(`apps/core-service/src/driver-signal/types.ts`). This is a second
implementation of the same interface, selected by config — same pattern
as how `ScaleClient`/`PrintClient` are each a single concrete
implementation behind an interface.

## Steps

### Step 1 — Digest-auth HTTP helper (no new dependency)

**Status: not started.**

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

**Status: not started.**

Add `apps/core-service/src/driver-signal/hikvision-isapi-adapter.ts`
implementing `DriverSignalAdapter`:
- Options per direction (`in`/`out`): camera base URL, output `<ID>`,
  username/password, timeout — entrance and exit are very likely two
  separate physical cameras/lanes, each with their own relay, so this
  mirrors `HttpRelayDriverSignalOptions`'s existing `entranceUrl`/
  `exitUrl` split rather than assuming one shared camera.
  - `pulseMs` (default e.g. 1000): `signalDriver` sends `outputState:
    high`, waits `pulseMs`, then sends `outputState: low` — matches the
    existing adapter's own documented pulse pattern, since we cannot
    assume the camera's own port-level `pulse` config has been set up
    on-site.
  - Same never-throws contract as the existing adapter (`signalDriver`
    must not reject — a hardware hiccup must never block ticket
    processing, master plan §5): catch all errors, update
    `lastFailureAt`, call `onError`, and return.
- `getStatus()` returning `lastSuccessAt`/`lastFailureAt`, same shape as
  today.
- Unit tests with a mock HTTP server emulating the ISAPI digest challenge
  and the trigger endpoint: assert the exact XML body, the high-then-low
  sequence, and that a camera error/timeout resolves rather than rejects.

### Step 3 — config + adapter selection

**Status: not started.**

Extend `apps/core-service/src/driver-signal/config.ts` with a
`DRIVER_SIGNAL_ADAPTER` env var (`http-relay` default | `hikvision-isapi`)
and, when `hikvision-isapi`, the per-direction camera URL/output-ID/
credentials/pulse env vars. Update `server.ts` to pick the adapter
factory based on that config instead of hardcoding
`createHttpRelayDriverSignalAdapter`. Default stays `http-relay` so
behavior is unchanged until explicitly opted in on-site.

### Step 4 — docs

**Status: not started.**

- `docs/runbooks/per-pc-deployment.md`: add the new env vars as
  on-site placeholders (output `<ID>` and camera admin credentials are
  wiring-dependent, same flagging style already used there for COM port/
  camera IPs).
- Master plan (`docs/plans/2026-09-29-tare-weight-ticket-plan.md`) §11:
  add a short implementation note once this lands, same style as the
  existing scale-protocol note — explicitly **not** a production
  sign-off, on-site validation of the output `<ID>` and digest auth
  against the real unit still required.
- Delete this plan file once Steps 1–4 are merged (per CLAUDE.md's
  working-document rule for per-feature plans).

## Explicitly out of scope

- Any dedicated barrier-gate-specific ISAPI endpoint
  (`ITC/Entrance/barrierGateCtrl`, `Parking/channels/<id>/barrierGate`) —
  still unconfirmed and gated behind Hikvision's partner portal; not
  worth building against until confirmed. The generic `IO/outputs`
  trigger is sufficient since the gate is wired to that same relay.
- Removing/deprecating `http-relay-adapter.ts` — the master plan's
  default assumption (a separate Shelly/Tasmota-style relay as fallback)
  stays until the camera path is validated on-site.
