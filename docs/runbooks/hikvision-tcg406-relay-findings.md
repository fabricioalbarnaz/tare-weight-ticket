# Hikvision DS-TCG406-E(S) — relay/barrier-gate control research findings

Desk research session: **2026-10-23**, no physical camera available yet.

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
   reports. This is the **most likely candidate to work**, since it's the
   most widely supported Hikvision ISAPI path, but it is generic alarm I/O,
   not the gate-specific API the datasheet alludes to.
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

Two ways to get a confirmed endpoint, both more reliable than the forum
threads above:

1. Ask Hikvision support/distributor for the ISAPI developer manual
   specifically for the **DS-TCG406-E(S)** model/firmware that will ship.
2. Once a physical unit is available: log into its web admin UI, find the
   control that manually fires the relay/opens the gate, and capture the
   exact HTTP request it issues (browser dev tools or a proxy). Integrators
   in the threads above report this as the most reliable way to get a
   working call, more so than the public guide excerpts.

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
