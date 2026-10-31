# Hikvision DS-TCG406-E(S) — relay/barrier-gate control research findings

Desk research sessions: **2026-10-23** (initial, forum-sourced candidates
only) and **2026-10-31** (follow-up — found and read two actual Hikvision
documents, see "Confirmed from official Hikvision documents" below). No
physical camera available in either session.

This document records what was found (and not found) about using the
Hikvision DS-TCG406-E(S) ANPR camera to drive the driver "move on" signal
(§4.5 of the master plan,
`docs/plans/2026-09-29-tare-weight-ticket-plan.md`), as an alternative or
addition to a separate network relay module (Shelly/Tasmota-style). Treat
everything below as **unconfirmed against the real device** — no camera,
no firmware version, and no vendor-restricted ISAPI developer manual were
available during this session. Do not implement against the candidate
endpoints below without first verifying them against the real unit.

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
3. **`PUT /ISAPI/Parking/channels/1/barrierGate`** with an XML body setting
   `ctrlMode` to `open` — reported as working by a different user, on a
   different device/firmware than (2). May be model/firmware-specific.

All three use HTTP Basic or Digest authentication against the camera's own
admin credentials. None of this was tested against a real unit in this
session.

Sources (community forums, not official — verify before trusting):
- [IPCamTalk — "How to open control barrier using Hikvision Camera?"](https://ipcamtalk.com/threads/how-to-open-control-barrier-using-hikvision-camera.62002/post-645612)
- [IPCamTalk — "Record start or alarm trigger with an http command?"](https://ipcamtalk.com/goto/post?id=32080)

## Recommended next step before writing any code

Three ways to get a fully confirmed endpoint, in order of preference:

1. **Once a physical unit is available** (still the most reliable, and now
   a short task given the confirmed background above): configure
   `Configuration > Capture > Entrance and Exit > Barrier Gate` with
   Control Mode `By Platform` and a Relay Function assignment, then either
   (a) just call `PUT /ISAPI/System/IO/outputs/<ID>/trigger` directly with
   `outputState: high` and confirm the physical gate moves, which would be
   sufficient to ship against — no further research needed; or (b), for
   extra confidence, open the web admin UI's own "Barrier Gate Remote
   Control" panel and capture the exact HTTP request its Open/Close
   buttons issue (browser dev tools or a proxy), to see whether Hikvision
   itself uses the generic IO trigger or a dedicated endpoint.
2. Ask Hikvision support/distributor for the ISAPI developer manual
   specifically for the **DS-TCG406-E(S)** model/firmware that will ship
   (resolves the open question about a possible dedicated barrier-gate
   endpoint, see above).
3. Sign up for Hikvision's Technology Partner Portal
   (`tpp.hikvision.com`) and request the gated ANPR/Entrance ISAPI
   developer guide — confirmed to exist and be downloadable once a
   partner account/license agreement is in place (not attempted this
   session; requires a business decision, not just research).

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
