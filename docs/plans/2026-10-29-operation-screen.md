# Operation screen (read-only ticket listing with live updates)

Status: **In progress**
Created: 2026-10-29

## Purpose

Add a new "Operação" screen to the Admin UI: a read-only listing of truck
tickets (same data as today's dashboard listing) intended for a future
"operador" profile. That profile doesn't exist yet, so for now the screen
is reachable by the existing (only) admin login, with no write actions and
no navigation to the ticket detail/edit page.

The listing must update automatically when a ticket is created or updated
(camera/scale events, or an admin correction), without a manual refresh.
Decision (confirmed with user 2026-10-29): use a real-time push (SSE) from
`core-service`, not polling — the only precedent in the codebase so far
(`HardwareStatusBadge`) uses `refetchInterval` polling, but the user asked
for a genuine push mechanism here.

## Design

- **Transport**: Server-Sent Events (SSE), not WebSocket — one-directional
  (server → browser) is all this needs, it rides on plain HTTP/fetch
  infrastructure already in place (no new dependency), and the browser's
  native `EventSource` handles reconnection for us. A WebSocket would add
  a second protocol to operate/secure for no benefit here.
- **Backend**: a small in-process event emitter
  (`core-service/src/tickets/ticket-events.ts`) that `repository.ts` calls
  into from every mutating method (`create`, `updateEntry`, `close`,
  `correctExit`, `markPrinted`, `flagAnomaly`). A new authenticated route
  `GET /api/admin/tickets/stream` subscribes to it and writes an SSE
  `ticket-changed` event per mutation, plus a periodic comment-line
  heartbeat so idle LAN connections/proxies don't time out. Payload is
  empty — the event is just a "something changed, refetch" signal, which
  keeps the server stateless about what each client has already seen and
  avoids building a diffing/replay protocol for a ~200-trucks/day system.
- **Frontend**: a `useTicketEvents` hook wrapping `EventSource`, used by
  the new `OperationPage` to call `queryClient.invalidateQueries` on the
  tickets query whenever an event arrives. `TicketTable` gets a `readOnly`
  prop (default `false`, no behavior change for existing callers) that
  renders the ticket number as plain text instead of a `Link` to the
  detail page, per the "view only, no edit/detail access" decision.
- **Testing SSE**: jsdom has no built-in `EventSource`, and MSW does not
  intercept it. Backend route tests will spin up a real listening server
  (not `app.inject`, which can't stream) and read chunks off the response
  body. Frontend tests will install a minimal fake `EventSource` on
  `global` for the one test that exercises live-update behavior; the
  initial-render test keeps using the existing MSW fixtures/handlers.

## Steps

### Step 1 — Backend: event bus + SSE endpoint
Status: Done — `src/tickets/ticket-events.ts` added; `repository.ts`'s six
mutating methods emit on it; `app.ts` wires one shared instance into both
the repository and `registerAdminRoutes`; new `GET
/api/admin/tickets/stream` route (auth-protected, `reply.hijack()` +
heartbeat). Backend test suite: 216/216 passing, including the new
repository event-emission test and the two new SSE route tests
(`admin/ticket-stream.test.ts`, using a real listening server + native
`fetch` streaming reader since `app.inject` can't exercise a hijacked
streaming response and jsdom/MSW can't either).

- `apps/core-service/src/tickets/ticket-events.ts`: tiny typed wrapper
  around Node's `EventEmitter` exposing `onTicketChanged`/`emitTicketChanged`.
- Wire `emitTicketChanged(ticket)` into every mutating method in
  `repository.ts` (`create`, `updateEntry`, `close`, `correctExit`,
  `markPrinted`, `flagAnomaly`).
- New route in `admin/routes.ts`: `GET /tickets/stream` (→
  `/api/admin/tickets/stream`), inside the existing authenticated context
  (reuse the `requireAuth` preHandler already used by the other `/tickets`
  routes). Sets SSE headers, writes a `ticket-changed` event on each bus
  emission, heartbeats every ~25s, cleans up the listener on client
  disconnect (`request.raw.on('close', ...)`).
- Tests: repository test(s) asserting each mutating method emits;
  route test(s) asserting the stream requires auth (401 without a session)
  and emits an event after a ticket mutation, using a real listening
  server instance rather than `app.inject`.

### Step 2 — Frontend: Operation page wired to live updates
Status: Done — `TicketTable` got a `readOnly` prop (plain text ticket
number, no link); `src/lib/useTicketEvents.ts` wraps `EventSource` and
invalidates the `['tickets']` query cache on `ticket-changed`;
`OperationPage.tsx` mirrors `DashboardPage` (status/search filters, no
"new ticket" button, `readOnly` table) and calls the hook; wired into
`AppRoutes.tsx` (`/operation`) and `AppShell.tsx` nav, with `nav.operation`
+ `operation.*` i18n keys in both locales. Tests in
`OperationPage.test.tsx` stub `global.EventSource` with a small fake (jsdom
has none, MSW can't intercept it) to verify both the read-only rendering
and that a pushed event triggers a refetch.

- `TicketTable`: add `readOnly` prop; when true, render ticket number as
  plain text (no `Link`, no navigation to `/tickets/:id`).
- `useTicketEvents` hook (e.g. `src/lib/useTicketEvents.ts`): opens an
  `EventSource` to `/api/admin/tickets/stream`, invalidates the `['tickets']`
  query cache on `ticket-changed`, closes the connection on unmount.
- `OperationPage.tsx`: same filters/listing as `DashboardPage` (status +
  search, `TicketTable` with `readOnly`), no "new ticket" button, calls
  `useTicketEvents`.
- Routing/nav: add `/operation` to `AppRoutes.tsx`, add a nav link in
  `AppShell.tsx`, add `nav.operation` + `operation.*` i18n keys to both
  `pt-BR.json` and `en.json`.
- Tests: `OperationPage.test.tsx` — initial listing renders via existing
  MSW fixtures (like `DashboardPage.test.tsx`), plus one test that installs
  a fake `EventSource` to confirm a pushed event triggers a refetch/table
  update, and a check that ticket numbers are plain text (no link).

### Step 3 — Verification + cleanup
Status: Done.

- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`
  all pass from the repo root (native Windows), across every workspace
  (`shared`, `core-service`, `admin-ui`, `print-bridge`, `scale-bridge`).
- Re-verified `core-service` + `admin-ui` via the Alpine container per
  CLAUDE.md (clean `npm install` inside `node:24-alpine` with
  `python3 make g++`, then typecheck/test/build) — all green there too.
- Side effect encountered and resolved: verifying via the container
  required deleting the shared root `node_modules` for a clean container
  install (per CLAUDE.md's "don't mix native and container installs"
  rule), and this machine turned out to have neither Python nor a C++
  toolchain for the native reinstall afterward (needed by
  `better-sqlite3`'s forced `node-gyp rebuild`) — a gap in exactly the
  spot CLAUDE.md's 2026-10-24 correction already flagged as a risk on a
  "clean Windows machine," just not yet hit on this one. Installed Python
  3.12 and VS Build Tools (C++ workload) via `winget` with the user's
  explicit go-ahead, then reinstalled natively — `core-service`,
  `print-bridge`, and `scale-bridge` all build/test clean again natively.
- Also bumped `apps/admin-ui/vitest.config.ts`'s `testTimeout` from 10s to
  20s: with this feature's new test file, the suite reached 9 test files,
  and spinning up that many jsdom environments concurrently under load
  was flakily tripping the old timeout on this machine (confirmed via
  `--no-file-parallelism`, which passed 13/13 deterministically even at
  10s) — not a bug in the new test's logic.
- Plan file left in place for now per CLAUDE.md: it's deleted once this
  work is merged, and merging (commits/PR) is the user's own step, not
  mine. No change needed to the master plan doc — this doesn't alter any
  recorded scope/architecture decision.
