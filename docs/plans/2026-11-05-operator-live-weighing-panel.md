# Operator screen — live weighing panel

Status: **Done, pending commit/PR/merge by the user.**
Created: 2026-11-05

**Note (2026-11-05): user approved proceeding through all steps without a
stop-and-review checkpoint after each one — will review/commit everything
at the end.** Status markers below are still kept up to date as work
lands, per `CLAUDE.md`.

## Purpose

On the "Operação" screen (`OperationPage.tsx`), add a fixed, always-present
panel that narrates each truck weighing as it happens, so the operator sees
it without needing to read the ticket listing:

1. A plate is detected (entrance or exit camera) → show the direction and
   the plate.
2. While the scale is being read → show a "reading weight" indicator (same
   card, no plate/weight values yet known beyond step 1).
3. Once the weight is captured → show the weight read.
4. If this reading **closes** a ticket (exit, or an internal truck closing
   on its single entrance event via fixed tare) → show both legs' weights
   (entry + exit) and the net weight, clearly marked as a closing, not just
   an entry capture.
5. If either leg of a closed ticket came from a registered internal truck's
   fixed tare (not a real scale reading) → label that leg accordingly.
6. If anything failed (weight capture timeout, unreadable plate, exit with
   no matching open ticket → anomaly, exit capture failure leaving the
   ticket OPEN) → show an alert state with the reason, since these are
   exactly the cases where the driver signal is withheld and the truck is
   stuck pending manual action.
7. A few seconds after showing the outcome (success or alert), the panel
   clears itself back to a neutral "waiting for next weighing" state. The
   existing ticket listing on the same screen already refreshes live via
   the existing `ticket-changed` SSE event — unaffected by this feature.

Decisions confirmed with user (2026-11-05):
- Fixed panel on the Operação screen (not a modal) — doesn't block the
  listing underneath.
- Auto-clears a few seconds after showing the outcome (not "stays until
  next event").
- Failure/anomaly cases are shown in the same panel with an alert style,
  not silently omitted.
- Scope is the Operação screen only (the one place "tela do operador"
  maps to today — `docs/plans/2026-10-29-operation-screen.md`). Dashboard
  is unaffected.

Known limitation (flagged to user, accepted): whether a reading will turn
out to involve an internal truck's fixed tare is only known *after* the
scale read and session-service resolution — the "reading weight" stage
only ever shows direction + plate, never a tare hint; the tare label only
appears on the final result card.

## Design

### Backend: a second, richer SSE event type on the existing stream

The existing `GET /api/admin/tickets/stream` (`core-service/src/admin/routes.ts`)
deliberately sends payload-less `ticket-changed` events (just "something
changed, refetch" — see `docs/plans/2026-10-29-operation-screen.md`). This
feature needs an actual payload (plate, direction, weight, outcome), so it
gets its own event names on the **same** stream/connection rather than
overloading `ticket-changed` or opening a second `EventSource`:

- `weighing-plate-received` — `{ direction: 'entrance' | 'exit', rawPlate: string }`
- `weighing-result` — `{ direction, rawPlate, plate: string | null, weightKg: number | null, weightCaptureFailed: boolean, failureReason?: string, outcome: 'ticket_opened' | 'ticket_retriggered' | 'ticket_closed' | 'ticket_closed_via_tare' | 'exit_capture_pending' | 'anomaly_flagged' | 'plate_unreadable', ticket?: { id, status, entryWeightKg, exitWeightKg, netWeightKg, entryCameraId, exitCameraId } }`

`ticket.entryCameraId`/`exitCameraId` being `null` is the existing
convention for "this leg came from a registered tare, not a camera event"
(`docs/plans/2026-10-27-internal-trucks-tare-plan.md`) — the frontend
derives the "fixed tare" badge from that instead of a new field.

New tiny emitter `core-service/src/camera/weighing-events.ts` (same pattern
as `tickets/ticket-events.ts`, just a typed `EventEmitter` wrapper) with
`emitPlateReceived`/`emitWeighingResult`/`onPlateReceived`/`onWeighingResult`.
Wired into `app.ts` alongside the existing `ticketEvents` instance, passed
into both `registerCameraRoutes` (to emit) and `registerAdminRoutes` (to
forward onto the SSE stream).

`camera/routes.ts` changes (both `/webhooks/camera/entrance` and `/exit`):
- Call `weighingEvents.emitPlateReceived({ direction, rawPlate: event.rawPlate })`
  right after `normalizeCameraPayload`, before the `scaleClient.readStableWeight`
  call (this is genuinely the earliest point the plate is known).
- Call `weighingEvents.emitWeighingResult({...})` right after
  `sessionService.handle*Reading` returns, using its `result.kind` as
  `outcome` and `result.ticket` (when present) for the ticket snapshot —
  no new business logic, just assembling what's already in scope.

`admin/routes.ts`'s `/tickets/stream` handler additionally subscribes to
`onPlateReceived`/`onWeighingResult` and writes
`event: weighing-plate-received\ndata: {...}\n\n` /
`event: weighing-result\ndata: {...}\n\n`, cleaning up both listeners on
`request.raw.on('close', ...)` alongside the existing one.

### Frontend: `LiveWeighingPanel` + `useWeighingEvents` hook

- `apps/admin-ui/src/lib/useWeighingEvents.ts`: opens its own `EventSource`
  to `/api/admin/tickets/stream` (same endpoint, mirrors `useTicketEvents`'s
  shape) and takes two callbacks, `onPlateReceived`/`onResult`, invoked on
  the respective SSE event. Kept separate from `useTicketEvents` rather
  than merged into it — different concern (ephemeral narration vs. "refetch
  the list"), and merging would make `useTicketEvents` take on UI state it
  doesn't need. Two `EventSource` connections open on this one page is an
  accepted, intentional tradeoff (low volume, one operator tab) rather than
  building a shared-connection abstraction for it now.
- `apps/admin-ui/src/components/operation/LiveWeighingPanel.tsx`: owns a
  small state machine —
  `idle | reading | result` — plus the direction/plate/outcome payload for
  the current/last reading. On `plate_received`: clears any pending
  auto-reset timer and switches to `reading` immediately (new reading
  always pre-empts whatever was being shown — one physical scale, so only
  one truck is ever actually being weighed). On `result`: switches to
  `result`, renders the outcome (see below), and starts a ~7s timer back
  to `idle`.
- Rendering per `outcome`:
  - `ticket_opened` / `ticket_retriggered` → neutral/success: plate,
    direction "Entrada", weight captured, "aguardando saída".
  - `ticket_closed` / `ticket_closed_via_tare` → success, closing style:
    plate, entry weight, exit weight, net weight; a "tara fixa" badge next
    to whichever leg has a null `entryCameraId`/`exitCameraId` on the
    ticket.
  - `plate_unreadable` → alert: "placa não identificada", direction, raw
    plate value if any; note that the driver signal is withheld.
  - `weightCaptureFailed` true (entrance, or exit via `exit_capture_pending`)
    → alert: capture failed, which leg, ticket stays open/awaiting manual
    correction.
  - `anomaly_flagged` → alert: exit with no matching open ticket.
- i18n: new `operation.panel.*` keys in both `pt-BR.json` and `en.json`
  (idle/reading/each outcome's message templates).
- Wired into `OperationPage.tsx` above the existing filters/table, calling
  `useWeighingEvents` the same way the page already calls `useTicketEvents`.

### Testing

- Backend: extend `admin/ticket-stream.test.ts`'s real-listening-server
  approach to assert `weighing-plate-received`/`weighing-result` are
  emitted with the right payload for: normal entrance, normal exit/close,
  internal-truck tare close (both directions), plate unreadable, capture
  failure on an existing open ticket (`exit_capture_pending`), anomaly.
  Add a unit test for the new `weighing-events.ts` emitter itself (mirrors
  `ticket-events.test.ts` if one exists, else a small direct test).
- Frontend: `LiveWeighingPanel.test.tsx` — a fake `EventSource` (same
  pattern as `OperationPage.test.tsx`) drives each outcome and asserts the
  right text/alert styling renders, and that the panel resets to idle after
  the timer (use fake timers). `OperationPage.test.tsx` gets one smoke test
  that the panel is present.

## Steps

### Step 1 — Backend: weighing event bus + emit from camera routes + extend SSE stream
Status: **Done.** `camera/weighing-events.ts` added (same `EventEmitter`
wrapper pattern as `tickets/ticket-events.ts`, but with a real payload).
`camera/routes.ts`'s entrance/exit handlers emit `plateReceived` right
after `normalizeCameraPayload` (before the scale read) and
`weighingResult` right after `sessionService.handle*Reading` returns,
using `result.kind` as `outcome` and `result.ticket` when present — no new
business logic. `app.ts` creates one `weighingEvents` instance shared into
both `registerCameraRoutes` and `registerAdminRoutes`. The `/tickets/stream`
route in `admin/routes.ts` additionally forwards both as
`weighing-plate-received`/`weighing-result` SSE events (JSON payload,
ticket serialized via the existing `serializeTicket`), cleaned up on
disconnect alongside the existing `ticket-changed` listener. Tests in the
new `admin/weighing-stream.test.ts` (real listening server + native
`fetch`, same approach as `ticket-stream.test.ts`, extended with a small
SSE-frame parser since these events carry actual data) cover: normal
entrance, a normal closing exit (entry+exit+net), an internal-truck
single-event close via tare (asserting the existing `exitCameraId: null`
convention is what the frontend will key off for the "tara fixa" badge),
an exit capture failure leaving the ticket OPEN, an exit anomaly, and an
unreadable plate.

### Step 2 — Frontend: `LiveWeighingPanel` + `useWeighingEvents`, wired into `OperationPage`
Status: **Done.** `lib/useWeighingEvents.ts` mirrors `useTicketEvents`'s
shape but carries the two new event types' payloads (ref-based callback
storage so the `EventSource` connection opens once per mount, not on every
render). `components/operation/LiveWeighingPanel.tsx` is a small state
machine (`idle | reading | result`) rendering: the direction+plate while
reading; the weight (and "aguardando saída") for a plain entry capture;
entry+exit+net plus a "tara fixa" badge (derived from
`ticket.entryCameraId`/`exitCameraId === null`, no new field) for a
closing outcome; and an alert style for `plate_unreadable`,
`anomaly_flagged`, `exit_capture_pending`, any `weightCaptureFailed`
reading, or a closed ticket with no net weight (reusing the existing
`needsAttention` helper from `StatusBadge.tsx` for that last case). Resets
to idle ~7s after a result. Wired into `OperationPage.tsx` above the
filters. i18n: `operation.panel.*` added to both `en.json`/`pt-BR.json`.
Tests: `LiveWeighingPanel.test.tsx` (5 cases: idle, reading→result happy
path, closing with tare badge, plate-unreadable alert, auto-clear via
`vi.useFakeTimers({ shouldAdvanceTime: true })`); one smoke test added to
`OperationPage.test.tsx` confirming the panel is mounted. The pre-existing
`OperationPage.test.tsx` live-update test had to change: with two
`EventSource` connections now open on that page (one from `useTicketEvents`,
one from the panel's `useWeighingEvents`), its old `.find()` for a single
stream instance was ambiguous — fixed to broadcast `ticket-changed` to
every matching fake instance.

### Redesign after manual browser verification (2026-11-05)

Spun up the real stack locally to look at the panel in a browser (not just
automated tests): `core-service` and `admin-ui`'s Vite dev server in two
Docker containers on a shared network, `admin-ui` pointed at the real
backend via `VITE_API_MODE=proxy` (temporary local `.env.local`, gitignored,
removed afterward), and a throwaway `core-service/src/dev-harness.local.ts`
(deleted afterward, never committed) standing in for real scale/camera/
printer hardware — same `buildApp` as production, but with a debug route to
set the next simulated scale reading on demand, so every outcome (open,
close, internal-truck tare close, capture failure, anomaly, unreadable
plate) could be triggered via `curl` while watching the real rendered page.

User feedback from that session, applied:
- The original free-text layout ("Entrada registrada para X — aguardando
  saída", a hand-rolled entry/exit/net summary with a custom "tara fixa"
  badge) was "difícil de entender" — replaced with a minimal fixed form:
  a **Direção** badge, a **Placa pesando:** readonly field, a **Peso**
  readonly field, and a spinner while reading / a ✓ or ⚠ once resolved.
  Direction was first dropped per an even more minimal mockup, then added
  back as its own labeled badge once its absence was noticed live.
- "Caso seja um fechamento de ticket trazer a outra informação e mostrar
  as informações do ticket como aparece na listagem" → for `ticket_closed`/
  `ticket_closed_via_tare`, the closing ticket is now rendered by reusing
  `TicketTable` (`readOnly`, single-row) directly under the fields —
  pixel-identical to the real listing below it — instead of a bespoke
  summary. This also quietly drops the custom "tara fixa" badge (the real
  listing doesn't show that distinction either, so parity with it meant
  dropping it, not re-inventing it elsewhere).
- Caught and fixed along the way, not requested but necessary to get a
  truthful manual check at all: the admin-ui container was initially still
  running in MSW **mock** mode even after setting `VITE_API_MODE=proxy`,
  because a service worker registered during an earlier mock-mode page
  load kept intercepting `/api/*` regardless (service workers outlive a
  plain reload) — resolved by testing from a fresh private window. Separately,
  the Vite dev server's running process didn't pick up later edits to
  `LiveWeighingPanel.tsx` at all (served a stale transform indefinitely,
  confirmed by diffing the file on disk vs. what the dev server returned
  over HTTP) — a container restart was needed after every source edit for
  it to take effect; not something `docker restart` alone always fixed
  instantly either (the harness's own in-container sqlite file, in the
  writable layer rather than a bind mount, also needed an idempotency fix
  so a container stop/start didn't crash re-seeding the same internal
  truck). None of this affects the real dev workflow (`npm run dev`
  natively, no container) — it's specific to verifying through a
  throwaway Docker-based harness on this machine's current toolchain gap.
- `OperationPage.test.tsx`'s pre-existing live-update test needed a second
  look purely because of this feature's own design (two `EventSource`
  connections on one page), covered under Step 2 above — unaffected by
  this redesign round.

Updated `LiveWeighingPanel.test.tsx` (still 5 cases, assertions rewritten
for the new DOM: field values via `getByLabelText`, the closing case via
the rendered `TicketTable` row's own text instead of custom summary text).
Full `en.json`/`pt-BR.json` key set changed accordingly (`plateLabel`,
`weightLabel`, `directionLabel`, `readingSr`/`doneSr`/`alertSr`; dropped
the now-unused `reading`/`result.*`/`tareBadge`/`unknownPlate` keys).

Verified live in the browser, via simulated camera webhooks against the
real backend, for every outcome: normal entrance, normal closing exit (net
weight correct), internal-truck single-event close via tare (twice),
direction badge on both entrance and exit, a 10s-delayed weighing (spinner
holds, then resolves), an anomaly (exit with no matching ticket), and an
exit capture failure (ticket stays OPEN with an alert). User confirmed each
one live before moving to the next.

### Step 3 — Verification + cleanup
Status: **Done.** All verification run via the Docker/Alpine container
per `CLAUDE.md` — this machine's `node_modules` is currently in its
container-install state with no native Python/VS Build Tools toolchain
yet (see the `toolchain-native-install-gap` memory), so native commands
weren't attempted beyond confirming the mismatch.
- `npm run typecheck --workspace=@tare/core-service` and
  `--workspace=@tare/admin-ui` — clean (one real fix needed: `tsc` rejected
  `useRef<ReturnType<typeof setTimeout>>()` with no initial value; fixed
  by widening the type to include `undefined` and passing it explicitly).
- `npm run lint` (root) — clean except the 2 pre-existing unrelated
  `react-refresh` warnings. One real fix needed: the new
  `react-hooks/refs` rule rejected assigning `ref.current` during render in
  `useWeighingEvents` — moved that assignment into its own `useEffect`.
- `core-service` `vitest run`: 297/297 once isolated from a transient
  `GET /health` timeout — confirmed via `git stash` that this specific
  test times out the same way on `main` with none of this feature's
  changes applied, so it's a pre-existing environmental flake on this
  host, not a regression.
- `admin-ui` `vitest run`: 28/28, including the 5 new
  `LiveWeighingPanel.test.tsx` cases and the smoke test.
- `npm run build` for `shared`, `core-service`, and `admin-ui` — all clean
  (admin-ui's existing >500kB chunk-size warning is pre-existing/unrelated).
- Plan file left in place for now per `CLAUDE.md`: deleted once this work
  is merged, and merging (commits/PR) is the user's own step, not mine.
  No change needed to the master plan doc's §11 — this doesn't alter any
  recorded scope/architecture decision, just adds a UI feature on top of
  already-documented mechanisms (SSE stream, the tare-leg `null` camera-id
  convention).
