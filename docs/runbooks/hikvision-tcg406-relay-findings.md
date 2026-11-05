# Hikvision DS-TCG406-E(S) — relay/barrier-gate control research findings

Desk research sessions: **2026-10-23** (initial, forum-sourced candidates
only), **2026-10-31** (follow-up — found and read two actual Hikvision
documents, see "Confirmed from official Hikvision documents" below),
**2026-11-04 morning** (the gated TPP partner guide cleared — see
"Confirmed from the gated ISAPI_Vehicle Access Control Management_ANPR
Cameras guide" below), and **2026-11-04 later the same day** (the user
clarified the camera's relay is actually wired to an audible siren, not a
barrier gate — see "Correction" section below, which changes the chosen
endpoint back to the generic IO trigger). No physical camera available in
any session yet.

This document records what was found (and not found) about using the
Hikvision DS-TCG406-E(S) ANPR camera to drive the driver "move on" signal
(§4.5 of the master plan,
`docs/plans/2026-09-29-tare-weight-ticket-plan.md`), as an alternative or
addition to a separate network relay module (Shelly/Tasmota-style). **This
install's camera relay is wired to an audible siren, not a barrier gate**
(confirmed 2026-11-04) — read the "Correction" section before the
barrier-gate-specific sections below; they document real Hikvision APIs
but the gate-specific ones (`barrierGate`, `barrierGateCtrl`) are the
wrong tool for this install's actual wiring. Treat everything below as
**unconfirmed against the real device** — no camera, no firmware version
were available during any session. Do not implement against the
candidate endpoints below without first verifying them against the real
unit.

## Why this was investigated

The camera brand/model was confirmed by the user as Hikvision
**DS-TCG406-E(S)**. The user had been told it has a way to remotely trigger
its own relay output, which would mean the driver-signal adapter
(`apps/core-service/src/driver-signal/`) could point at the camera itself
instead of requiring a separate relay box.

## Confirmed (from Hikvision's own datasheet/product page)

- The DS-TCG406-E series has a **built-in 2-channel relay output**,
  specifically meant for opening/closing a vehicle barrier gate ("Relay
  Output: 2-ch relay output, supporting opening and closing of barrier
  gates").
- It supports **three barrier-gate control modes**: `By Camera` /
  `By Platform` / `Mixed`. `By Platform` is the relevant one — it means an
  external system (our Core Service) is meant to be able to command the
  gate/relay over the network, not just the camera deciding on its own.
- It exposes **ISAPI** (Hikvision's HTTP-based device API), plus SDK and
  ISUP, as its network interfaces.
- It reports barrier gate status (closed / open / "remote control open in
  place").
- Electrical contact ratings for the relay (voltage/current limits) were
  **not found** in the excerpts retrieved — only that the unit itself runs
  on 12–24V DC or PoE, ~10W max.

Sources:
- [DS-TCG406-E datasheet (PDF)](https://assets.hikvision.com/prd/normal/all/doc/m000078840/DS-TCG406-E_Datasheet_20260811.pdf)
- [DS-TCG406-E(S) datasheet (PDF)](https://assets.hikvision.com/prd/normal/all/doc/m000174828/DS-TCG406-ES_Datasheet_20260401.pdf)
- [Hikvision product page](https://www.hikvision.com/en/products/parking-management/vehicle-access-control-management/anpr-cameras/ds-tcg406-e)
- [ISAPI Service (official Hikvision doc)](https://enpinfo.hikvision.com/hkwsen/unzip/20230410194813_20373_doc/GUID-32DED0BA-F218-4F6D-BC9F-525FFAB4BDE0.html)
  — confirms ISAPI is a real, documented, HTTP-based protocol, and that it
  must be turned on per-device: `System > System Service > Enable ISAPI`.
  This page does **not** itself document any relay/barrier-gate endpoints.

**Caveat**: Hikvision's English product page marks the plain `DS-TCG406-E`
as discontinued. Confirm the `-E(S)` variant's current datasheet/firmware
line before relying on any of this.

## Confirmed from official Hikvision documents (2026-10-31 session)

Two actual Hikvision documents were located and read in full this session
(previous session only had datasheets + forum posts). Both are genuine
Hikvision documents, not forum hearsay, though neither is the
model-specific, partner-gated ISAPI guide ideal for 100% certainty.

**1. "Intelligent Security API (General Application) Developer Guide"**
(general ISAPI protocol reference, applies across the Hikvision device
line, not ANPR-specific) — a community-hosted copy was read; the official
copy lives behind the gated Hikvision partner portal (see below). It
documents a **generic alarm/IO output** family of endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/ISAPI/System/IO/outputs/capabilities` | output capability |
| GET | `/ISAPI/System/IO/outputs` | all output ports |
| GET/PUT | `/ISAPI/System/IO/outputs/<ID>` | one port's config |
| GET | `/ISAPI/System/IO/outputs/<ID>/status` | one port's status |
| **PUT** | **`/ISAPI/System/IO/outputs/<ID>/trigger`** | **manually trigger one output** |

The trigger call's body is `XML_IOPortData` (`ver20` namespace):
```xml
<IOPortData xmlns="http://www.isapi.org/ver20/XMLSchema">
  <outputState><!--req, xs:string, "high, low"--></outputState>
</IOPortData>
```
A port's own config (`XML_IOOutputPort`) additionally supports an
`outputState` of `"pulse"` with a `pulseDuration` (ms) — i.e. the port can
be configured to self-reset after a fixed pulse, which would mean we only
ever send `high` and never need a follow-up `low` call. This upgrades
candidate (1) from the 2026-10-23 list (previously forum-sourced only) to
**confirmed against an actual Hikvision developer guide** — still not
tested against the real DS-TCG406-E(S) unit, but no longer just a forum
guess.

**2. "Intelligent ANPR Camera User Manual" V5.4.4 (2025-09-23)** — the
official, model-family user manual (hosted at
`enpinfo.hikvision.com`/`pinfo.hikvision.com`, the same official doc
domain already cited for the ISAPI Service page). It is a web-UI manual
(screenshots of the admin page, not raw HTTP calls), but it confirms the
architecture:
- §4.1 "Set Barrier Gate Linkage" / §4.1.2 "Control Barrier Gate"
  (`Configuration > Capture > Entrance and Exit > Barrier Gate`):
  - **Control Mode: "By Platform"** — "Select this mode in the scene in
    which the entry permissions are controlled by the software." This is
    our case (Core Service decides, not the camera). The alternative,
    "By Camera", is for standalone allowlist use with no control
    software — not applicable to us.
  - *"Connect the barrier gate to the relay output interface of the
    device."* The gate is wired to the camera's own generic relay output
    — the same relay hardware the ISAPI `IO/outputs` endpoints above
    control, not a separate gate-specific circuit.
  - **Relay Function**: "Select the functions of corresponding relays.
    Relay 1 corresponds to the 1A and 1B of the terminal. Relay 2
    corresponds to the 2A and 2B of the terminal." — i.e. during on-site
    setup, one of the camera's 2 physical relay channels must be assigned
    the barrier-gate function in the web UI before any ISAPI trigger call
    against that `<ID>` will actually move the gate.
  - The web UI itself has a **"Barrier Gate Remote Control"** panel with
    Close/Open/Unlock/Lock buttons — i.e. Hikvision's own admin page
    opens/closes the gate by calling *some* HTTP API under the hood. This
    manual doesn't show which call (it's a UI manual), but it's strong
    evidence that a working remote-open path exists on this exact device
    family.

**What's still not nailed down**: whether the "Barrier Gate Remote
Control" buttons in the web UI call the generic `IO/outputs/<ID>/trigger`
endpoint above, or a dedicated barrier/entrance-specific endpoint (like
candidates 2/3 below) that additionally understands gate-specific logic
("Keep Barrier Open for Following Vehicle", "Lock for Large-Sized
Vehicle", distinct open/closed/locked status reporting). Both would
physically open the same gate since it's wired to a generic relay either
way, but a dedicated endpoint would be preferable if it exists and is
simple to use (e.g. one call that also reports a real barrier state
instead of a raw relay level).

The partner-gated **ANPR/Entrance-specific ISAPI developer guide** (which
would resolve this) was located at Hikvision's Technology Partner Portal
(`https://tpp.hikvision.com/download/ISAPI_OTAP`) but downloading it
requires a signed partner account — `tpp.hikvision.com` showed "Download
Restricted ... integration documentation downloads are not available for
internal accounts. To obtain these resources, please contact your
regional integration support team." Not pursued further in the
2026-10-23/10-31 sessions.

**Update 2026-10-31 (later same day):** the user has their own TPP
partner account and is logged in. Searching `ISAPI_OTAP` by model number
(`TCG406`) required signing Hikvision's Materials License Agreement
first, which the user did — **but the portal states approval takes a few
days**, so the gated guide isn't available yet. The user also checked
`tpp.hikvision.com/tpp/EE-Integration` (Products > Hardware >
Intelligent Traffic > Entrance & Exit Management, the category page for
ANPR/entrance cameras) and found no direct download link there either.
**Action item once the agreement clears (check back in a few days):**
retry the `ISAPI_OTAP` search for `TCG406`/`ANPR`/`Entrance` — that
should be the actual unlock point, not the `EE-Integration` category
page. Until then, this plan proceeds on the confirmed generic
`IO/outputs/<ID>/trigger` path above; the dedicated endpoint (if any)
can be swapped in later without changing the adapter's public shape.

Sources (this session):
- "Intelligent Security API (General Application) Developer Guide" (via
  community mirror: [GitHub attachment](https://github.com/Supergiovane/node-red-contrib-hikvision-ultimate/files/7725696/doku.pub_hikvision-isapi-core-protocolpdf.pdf))
- [Intelligent ANPR Camera User Manual V5.4.4, 2025-09-23](https://enpinfo.hikvision.com/hkwsen/unzip/20250923194804_01508_doc/Intelligent%20ANPR%20Camera_User%20Manual_V5.4.4_20250923.pdf)
- [Hikvision Technology Partner Portal — ISAPI/OTAP developer guides (gated)](https://tpp.hikvision.com/download/ISAPI_OTAP)

## Confirmed from the gated ISAPI_Vehicle Access Control Management_ANPR Cameras guide (2026-11-04 session)

The user's Hikvision TPP partner account cleared and they downloaded the
gated, model-family-specific developer guide: **"ISAPI_Vehicle Access
Control Management_ANPR Cameras"** (local copy under
`ISAPI_Vehicle Access Control Management_ANPR Cameras/ISAPI_Vehicle
Access Control Management_ANPR Cameras.pdf`, plus supporting
`Access Control Event Types and Event Linkage Types.pdf`,
`Field Dictionary.xlsx`, `ErrorCode.xlsx` — not itself in the repo, kept
locally). This is the official ANPR/Entrance-specific guide referenced as
still-pending in the 2026-10-31 session above, and it resolves the open
question of whether a dedicated barrier-gate endpoint exists (it does —
two, in fact) rather than only the generic `IO/outputs/<ID>/trigger`.

**§10.2 "Entrance and Exit Barrier Control" — official API calling flow**:
1. `GET /ISAPI/Traffic/capabilities` — check plate-list support.
2. `GET /ISAPI/ITC/Entrance/capabilities` — check
   `$.EntranceCap.supportEntrance` / `supportBarrierGateNum`.
3. `GET /ISAPI/ITC/Entrance/entranceParam/capabilities`.
4. `PUT /ISAPI/ITC/Entrance/entranceParam` — set
   `$.EntranceParamList.EntranceParam.ctrlMode`: **`0` = camera control
   (automatic), `1` = platform control (manual — our case), `2` = both**.
   This same call's `relayList[].relayFunction` is where a physical relay
   channel is assigned a function: `0`-none, `1`-open barrier gate,
   `2`-close barrier gate, `3`-stop barrier gate, `4`-alarm signal,
   `5`-solid light. This is the documented equivalent of the on-site "Relay
   Function" web-UI step already noted above, now with the exact field
   name/enum for doing it over ISAPI instead of the admin page.
5. **Manual control**: `PUT /ISAPI/Parking/channels/<channelID>/barrierGate`.

**§11.6.3 — `Parking/channels` barrier-gate endpoints (primary candidate,
dedicated and gate-aware, not generic IO)**:

| Method | Path | Body / notes |
|---|---|---|
| PUT | `/ISAPI/Parking/channels/<channelID>/barrierGate` | `<BarrierGate version="2.0"><ctrlMode opt="open,close,lock,unlock">open</ctrlMode></BarrierGate>` — one call, no separate high/low pulse needed |
| GET | `/ISAPI/Parking/channels/<channelID>/barrierGate/barrierGateStatus` | returns `<barrierGateStatus>`: `0` no signal, `1` closed, `2` open |
| GET | `/ISAPI/Parking/channels/<channelID>/barrierGate/capabilities` | returns supported `ctrlMode` values + `isSupportBarrierGateStatus` |

**§11.6.4 — `ITC/Entrance/barrierGateCtrl` (alternate dedicated endpoint,
same device family)**:

| Method | Path | Body / notes |
|---|---|---|
| PUT | `/ISAPI/ITC/Entrance/barrierGateCtrl` | `<BarrierGateCtrl version="2.0"><BarrierGateCtrlList><barrietGateOper>on</barrietGateOper></BarrierGateCtrlList></BarrierGateCtrl>` (sic — `barrietGateOper`/`barrietGateNum` typos are in the vendor XML itself); `barrietGateOper` enum: `"off"`-fall, `"on"`-rise, `"stop"`, `"locked"` |
| GET | `/ISAPI/ITC/Entrance/capabilities` | `supportEntrance`, `supportBarrierGateNum`, `supportAlarmINNum`, `supportRelayNum` |
| GET/PUT | `/ISAPI/ITC/Entrance/entranceParam[/capabilities]` | the `ctrlMode`/`relayFunction` config from the flow above |

**Still open**: the guide documents both `Parking/channels/.../barrierGate`
and `ITC/Entrance/barrierGateCtrl` as separate, fully-specified endpoints
on the same device family, but doesn't say which one (if not both) the
DS-TCG406-E(S) web UI's own "Barrier Gate Remote Control" panel calls, or
whether both are simultaneously supported on that exact model/firmware.
`Parking/channels/.../barrierGate` is the simpler contract (single
`ctrlMode` string, explicit status enum) and reads as the more
general-purpose "parking facility" API; `ITC/Entrance/barrierGateCtrl` is
named for the entrance/traffic-camera product line the TCG406 belongs to
and exposes `off`/`on`/`stop`/`locked` instead. **Recommendation once a
physical unit is available**: try `Parking/channels/.../barrierGate` first
(simpler, has a real status read-back) and fall back to
`ITC/Entrance/barrierGateCtrl` only if the first returns an error on this
model. No further desk research planned — this needs the real device to
resolve, per the "Recommended next step" section below (now narrowed from
three options to just option 1, since options 2/3 are superseded by this
guide).

**Auth**: confirmed HTTP Digest against the camera's admin credentials
(same as already assumed) — the guide's own request-examples chapter
(§4.1.4) shows `requests.auth.HTTPDigestAuth('admin', 'admin12345')` in
Python as the reference pattern.

## Correction (2026-11-04, later update): the relay drives a siren, not a barrier gate

The user clarified that **this install's camera relay output is wired to
an audible siren** (sinal sonoro) for the driver "move on" signal, not to
a physical barrier gate. This was not previously stated — all research
above (the official ANPR user manual's §4.1 "Barrier Gate Linkage", and
the gated guide's §10.2/§11.6 `barrierGate`/`barrierGateCtrl` endpoints)
assumed the relay opened a gate, because that's the only use case the
vendor documentation frames for this relay output.

**Why this matters, not just terminology**: the dedicated endpoints found
in the gated guide (`PUT /ISAPI/Parking/channels/<channelID>/barrierGate`
and `PUT /ISAPI/ITC/Entrance/barrierGateCtrl`) are **gate-aware, not
generic relay triggers**. Per §10.2.2 step 6/§11.6.3's own config model,
they act on whichever relay channel has
`entranceParam.relayList[].relayFunction` set to `1` ("open barrier
gate")/`2`/`3` — a *different* value than what a siren needs. The same
`relayFunction` enum documented in that guide (§11.6.4.1/§11.6.4.5) also
includes `4` = **"alarm signal"**, which is the function this install's
relay channel should actually be assigned on-site. There is no
dedicated "fire the alarm signal relay" business endpoint in the gated
ANPR/Vehicle-Access-Control guide — it only documents the gate-control
APIs; a relay assigned function `4` is not addressable through
`barrierGate`/`barrierGateCtrl` at all (those calls are scoped to the
gate entity, not an arbitrary relay channel).

**Net effect: this reverts the chosen endpoint back to the generic I/O
output trigger** from the 2026-10-31 session's "Intelligent Security API
(General Application) Developer Guide" finding, which is relay-channel-
agnostic and works regardless of what the channel is wired to or which
`relayFunction` it's assigned:

```
PUT /ISAPI/System/IO/outputs/<ID>/trigger
<IOPortData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <outputState>high</outputState>
</IOPortData>
```
Send `high` then `low` to pulse the siren on and back off (or configure
`outputState: pulse` with a `pulseDuration` on the port itself, so a
single `high` call is enough — same option noted in the 2026-10-31
section above). This was searched for specifically in the newly-downloaded
gated ANPR guide (terms: `audioAlarm`, `acousticAndLight`, `soundAlarm`,
`siren`, `buzzer`) — no dedicated siren-trigger business endpoint exists
in that guide; the closest hit, `/ISAPI/System/syncSignalOutput/<alarmOutID>`
(§11.1.3), is for strobe/supplement-light synchronization
(`flashLight`/`polarizer`/`continuousLight` modes), not an audible alarm,
so it does not apply either.

**On-site config step changes accordingly**: assign
`relayFunction = 4` ("alarm signal") to the relay channel wired to the
siren in `entranceParam` (via `PUT /ISAPI/ITC/Entrance/entranceParam` or
the camera's own web UI), not `1` ("open barrier gate"). The `<ID>` used
in the generic `IO/outputs/<ID>/trigger` call is still assumed (not yet
confirmed) to correspond to the same physical relay channel numbering as
`relayNum` in `entranceParam` — on-site verification must confirm this
mapping along with everything else in this document.

The gate-specific sections above (`Parking/channels/.../barrierGate`,
`ITC/Entrance/barrierGateCtrl`, and the §10.2 `ctrlMode`/`relayFunction=1`
flow) remain accurate documentation of those real Hikvision APIs — they're
just not the ones this install needs, and are kept here in case a future
install on this same system does use an actual barrier gate on this
relay output.

## Not confirmed — candidate ISAPI endpoints (forum-sourced, unverified)

The full ISAPI developer manual with endpoint-level detail is not publicly
posted; it's distributed to Hikvision partners/developers. Three candidate
HTTP calls turned up in integrator forum threads, none confirmed against
this exact model/firmware:

1. **`PUT /ISAPI/System/IO/outputs/<id>/trigger`** — generic "alarm output"
   trigger present on most Hikvision cameras (not ANPR/entrance-specific).
   Body is XML, e.g.:
   ```xml
   <IOPortData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
     <outputState>high</outputState>
   </IOPortData>
   ```
   Send `high` then `low` to pulse the output (open the circuit, then
   close it). One forum poster hit a "device error" until a firmware
   update; the namespace/version (`ver10` vs `ver20`) varied between
   reports. **Update 2026-10-31: this path is now confirmed against an
   actual Hikvision developer guide**, not just forum reports — see
   "Confirmed from official Hikvision documents" above. It's still generic
   alarm I/O rather than a gate-aware API, but the ANPR camera's own
   official user manual confirms the barrier gate is wired to exactly this
   generic relay output, making this the **primary candidate**.
2. **`PUT /ISAPI/ITC/Entrance/barrierGateCtrl`** — reported as coming from
   an official Hikvision integration guide for ITC (Intelligent Traffic
   Camera) / entrance-series devices, which TCG406 plausibly belongs to.
   One user following this got a "device error" response on their unit.
   **Update 2026-11-04: now confirmed** against the official gated ANPR
   guide — see "Confirmed from the gated ISAPI_Vehicle Access Control
   Management_ANPR Cameras guide" above. The prior "device error" report
   may have been a different firmware or a missing `entranceParam`
   `ctrlMode=1` (platform control) setup step, not a wrong endpoint.
3. **`PUT /ISAPI/Parking/channels/1/barrierGate`** with an XML body setting
   `ctrlMode` to `open` — reported as working by a different user, on a
   different device/firmware than (2). May be model/firmware-specific.
   **Update 2026-11-04: now confirmed** against the same gated guide, with
   full request/response schema (status enum, capabilities endpoint) — see
   above. This is the recommended endpoint to try first.

All three use HTTP Basic or Digest authentication against the camera's own
admin credentials. None of this was tested against a real unit in this
session.

Sources (community forums, not official — verify before trusting):
- [IPCamTalk — "How to open control barrier using Hikvision Camera?"](https://ipcamtalk.com/threads/how-to-open-control-barrier-using-hikvision-camera.62002/post-645612)
- [IPCamTalk — "Record start or alarm trigger with an http command?"](https://ipcamtalk.com/goto/post?id=32080)

## Recommended next step before writing any code

**Update 2026-11-04 (later update)**: per the "Correction" section above,
this install's relay drives a siren, not a gate, so the gated guide's
dedicated `barrierGate`/`barrierGateCtrl` endpoints don't apply. The
gated-guide research itself is still done (options 2/3 from the original
three-option list below are resolved, just not in the direction originally
expected) — what's left is on-site verification of the generic I/O trigger
path:

1. **Once a physical unit is available** (the only remaining step): assign
   `relayFunction = 4` ("alarm signal") to the relay channel wired to the
   siren — either via ISAPI (`PUT /ISAPI/ITC/Entrance/entranceParam`,
   `relayList[].relayFunction: 4`) or the camera's own web UI equivalent.
   Then call `PUT /ISAPI/System/IO/outputs/<ID>/trigger` with
   `outputState: high` (for whichever `<ID>` corresponds to that relay
   channel) and confirm the siren actually sounds; send `outputState: low`
   afterwards (or pre-configure `pulse` mode on the port, per the
   2026-10-31 finding above) to turn it back off.
2. ~~Ask Hikvision support/distributor for the ISAPI developer manual~~ —
   superseded, done via the TPP download instead (even though the
   resulting gate-specific endpoints turned out not to be the ones needed
   here).
3. ~~Sign up for Hikvision's Technology Partner Portal~~ — done; guide
   downloaded 2026-11-04.

## Impact on the current architecture if this pans out

No structural change — this still slots into the existing pluggable
`DriverSignalAdapter` interface
(`apps/core-service/src/driver-signal/types.ts`). It would be a new
implementation (e.g. `hikvision-isapi-adapter.ts`) alongside
`http-relay-adapter.ts`, not a replacement of the interface. The current
`http-relay-adapter.ts` sends a bare `GET`/configurable-method request with
no body and no auth — it would need to grow support for a request body
(XML) and HTTP Digest/Basic auth before it could target the camera's ISAPI
endpoint directly; whether that's a new adapter or an extension of the
existing one is a decision for once the real endpoint is confirmed.

This does not change the default assumption already in the master plan
(§4.5): a separate network relay (Shelly/Tasmota-style) is still the
documented fallback if the camera's own relay/ISAPI path doesn't pan out
or isn't accessible in time.
