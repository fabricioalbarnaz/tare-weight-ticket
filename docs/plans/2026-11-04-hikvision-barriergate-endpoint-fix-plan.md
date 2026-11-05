# Fix Hikvision driver-signal adapter: switch to the `barrierGate` endpoint

**Status: step 1 done, awaiting user review before any further step.**

## Background

Live on-site testing (2026-11-04, cameras reachable at
`192.168.29.66:222` entrance / `192.168.29.65:221` exit) found that the
currently-implemented endpoint, `PUT /ISAPI/System/IO/outputs/<ID>/trigger`
(`hikvision-isapi-adapter.ts`), is **the wrong output** on this camera
model/firmware:

- `GET /ISAPI/System/IO/outputs/capabilities` shows exactly **one** generic
  output (`id=1`), and its `IOUseType` only accepts `disable`/`whiteLight`
  — this is the camera's own supplemental illuminator, unrelated to the
  barrier/siren relay. `id=2` returns `notSupport`.
- The real relay channels live in a separate registry,
  `GET /ISAPI/ITC/Entrance/entranceParam`'s `relayList`: **2 channels**,
  `relayNum=1` → `relayFunction=1` ("open barrier gate"),
  `relayNum=2` → `relayFunction=2` ("close barrier gate") — on both
  cameras. Neither is assigned `relayFunction=4` ("alarm signal"); the
  one-time on-site config step the original plan called for was never
  actually done (or isn't needed — see below).
- The dedicated endpoint `PUT /ISAPI/Parking/channels/1/barrierGate` **is
  supported** or this camera/firmware (`capabilities` and
  `barrierGateStatus` both read back cleanly) and is the call that
  actually operates relay 1 (`ctrlMode=open`) / relay 2 (`ctrlMode=close`)
  — confirmed by firing it live (`HTTP 200`/`OK` both times).
- **Audible result inconclusive**: all 4 combinations (entrance ch1 open,
  entrance ch2 close, exit ch1 open, exit ch2 close) returned `OK` but the
  user did not hear the siren on any of them. This needs a physical
  presence at the install (multimeter on the relay contacts, confirm siren
  power/wiring) to resolve — tracked as a follow-up, not blocking this
  code fix.

This reverses the previous plan's premise
(`docs/plans/2026-10-31-hikvision-isapi-driver-signal-plan.md`), which
assumed the generic `IO/outputs` endpoint was relay-channel-agnostic and
that the dedicated `barrierGate`/`barrierGateCtrl` endpoints didn't apply
because the relay would be assigned `relayFunction=4`. Neither holds up
against the real device: the generic endpoint hits an unrelated output,
and the relay channels are still at their gate-control defaults (1/2).
Regardless of what the channel is *wired to*, the way to fire it over
ISAPI on this device is the dedicated `barrierGate` call — per the master
plan's living-spec convention (`CLAUDE.md`), the code should follow the
real hardware, not the earlier desk-research assumption.

## Decision

Switch the adapter to call `PUT /ISAPI/Parking/channels/<channelId>/barrierGate`
with `<ctrlMode>` set to a configured value (default `open`, i.e. relay 1
— the channel/mode is configurable per direction since which channel is
actually wired to the siren is still unconfirmed on-site). One call, no
high/low pulse pair — the camera's own `relayOutTime` (7000ms on both
cameras, from `entranceParam`) auto-resets the contact; there is no
`low`-equivalent `ctrlMode` to send even if we wanted to.

## Step 1 — adapter + config + docs (done, this session)

- `hikvision-isapi-adapter.ts`: replace the `outputId`/`pulseMs`/high-low
  trigger logic with a single `PUT .../barrierGate` call using
  `channelId` (default `"1"`) and `ctrlMode` (default `"open"`).
- `config.ts`: replace `DRIVER_SIGNAL_HIKVISION_{ENTRANCE,EXIT}_OUTPUT_ID`
  with `..._CHANNEL_ID` (default `"1"`) and `..._CTRL_MODE` (default
  `"open"`, validated against `open|close|lock|unlock`). Drop
  `DRIVER_SIGNAL_HIKVISION_PULSE_MS` (no longer meaningful).
- `server.ts`: stop passing `pulseMs` to the adapter factory.
- Tests rewritten for the new endpoint/body/config shape.
- `.env` / `.env.example` / `docs/runbooks/per-pc-deployment.md` updated.
- `docs/runbooks/hikvision-tcg406-relay-findings.md` gets a new dated
  section recording the live findings above.
- Master plan §11 entry amended in place (not a new entry — it's a
  correction of the same decision, dated 2026-11-04 same day).

## Step 2 — on-site audible confirmation (not started, blocked on physical presence)

Once someone is physically at the install: fire `ctrlMode=open` and
`ctrlMode=close` on each camera (already possible via the adapter once
step 1's code is running, or directly via `curl --digest`) while checking
the relay contacts with a multimeter and confirming the siren is actually
wired and powered. Record the result (which channel, if any, drives the
siren) in the runbook and set `DRIVER_SIGNAL_HIKVISION_{ENTRANCE,EXIT}_CTRL_MODE`
accordingly — defaulting to `open` (channel 1) until then, same
placeholder-until-confirmed treatment as every other hardware value in
`per-pc-deployment.md`.

**Delete this plan file once step 2 is done and the user has validated/committed
the work**, per `CLAUDE.md`'s working-document convention.
