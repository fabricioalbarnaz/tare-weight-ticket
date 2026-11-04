# Withhold the driver signal on an unreadable plate

Status: **Done, pending commit.**
Created: 2026-11-03

## Context

Current behavior (`apps/core-service/src/camera/routes.ts`): the driver
signal is decided purely from the scale read outcome
(`weightCaptureFailed`), before the plate is even checked. A plate that
comes back unreadable (`normalizeCameraPayload` already applies the
confidence/length check and returns `rawPlate: ''` — see
`camera/normalize.ts`'s `isReliablePlateRead`) still gets the driver
signaled and the truck released, as long as the scale read itself
succeeded.

**User-identified problem (2026-11-03):** once the truck is released with
no readable plate, there is no way to attribute the captured weight to a
specific truck later — the ticket this produces (`plate_unreadable`, no
ticket created, only a `raw_events` row — master plan §5) can never be
matched to the right vehicle after the fact. Since this system's tickets
drive payment on the receiving end, an unreadable-plate release silently
blocks that payment. An operator must intervene before the truck leaves —
even though there's no Admin UI screen for that specific intervention yet
(acknowledged and accepted by the user; out of scope here).

## Decision

Withhold the driver signal whenever the plate is unreadable, in addition
to the existing weight-capture-failure case (2026-10-27) — regardless of
whether the scale read succeeded. The truck stays physically on the scale;
an operator resolves it on-site (no software action to build for this yet,
same "deferred" status as the physical manual-release button for a failed
capture).

## Step 1 — `camera/routes.ts`

Status: **done.**

- Both webhook handlers: check `event.rawPlate === ''` (plate unreadable,
  as already computed by `normalizeCameraPayload`) alongside
  `weightCaptureFailed` before deciding to call
  `driverSignalAdapter.signalDriver(...)`. Either condition withholds the
  signal; only a readable plate *and* a successful capture releases the
  truck.
- Two distinct `request.log.warn(...)` messages (plate-unreadable vs.
  capture-failed) instead of collapsing both into one, so the hardware/ops
  logs make the actual cause greppable.
- `camera/routes.test.ts`: new tests confirming the signal is withheld on
  an unreadable plate on both entrance and exit, even when the scale read
  succeeds — and that it still fires normally when both the plate is
  readable and the capture succeeds (regression coverage for the existing
  case).

## Step 2 — Update documentation

Status: **done.**

- Master plan (`docs/plans/2026-09-29-tare-weight-ticket-plan.md`) §5: the
  "Plate unreadable" bullets never said what happens to the driver signal
  — added an explicit decision note (2026-11-03) next to the existing
  2026-10-27 weight-capture-failure one, same section, citing the payment
  attribution risk as the reason.
- §11: short implementation note alongside the existing "Driver signal
  fires right after the scale read..." entry.
- `CLAUDE.md`: no change yet — its "Project status" note only gets this
  once merged, per this file's own workflow convention.

## Step 3 — Verify

Status: **done.**

- `core-service`: native `vitest run src/camera/routes.test.ts` plus
  `typecheck` clean. Full container-Alpine lint/typecheck/test/build left
  for the next full verification pass (same as the previous plan,
  commit is up to the user).
