# Phase 6 — Admin backend API — Development Plan

Status: **Done — all 9 steps complete, pending user review before commit/PR**
Created: 2026-10-13

## Scope

The Phase 6 Admin UI frontend (`apps/admin-ui`) is already merged but was
built entirely against Mock Service Worker fixtures — there is no real
`/api/admin/*` implementation in `core-service` yet. This plan implements
that backend so the Admin UI can run against real data (`VITE_API_MODE=proxy`
instead of `mock`).

Hardware integrations (real scale protocol, camera payload, relay) stay
out of scope here — deferred to Phase 7 per the master plan's §7 decision
(2026-10-13). This plan only touches `core-service` (and, where the
contract needs a tiny adjustment, `apps/admin-ui`'s API client config /
`packages/shared` if we decide to move the shared types there — see Step 2).

## API contract (authoritative; supersedes the draft in the now-deleted
`2026-10-10-phase6-admin-ui-frontend-plan.md`, which the frontend was built
against)

All routes under `/api/admin`, session-cookie auth (httpOnly), matching
`apps/admin-ui/src/api/types.ts` field-for-field:

- `POST /api/admin/auth/login` `{ username, password }` → `200 { username }` or `401`
- `POST /api/admin/auth/logout` → `204`
- `GET /api/admin/auth/me` → `200 { username }` or `401`
- `GET /api/admin/tickets?status=&search=&from=&to=&page=&pageSize=` → `{ items: Ticket[], total, page, pageSize }`
- `GET /api/admin/tickets/:id` → `{ ticket: Ticket, auditLog: AuditLogEntry[] }`
- `POST /api/admin/tickets` (manual creation) `{ plate, entryAt, entryWeightKg, reason }` → `201 { ticket }`
- `PATCH /api/admin/tickets/:id/entry` `{ entryAt, entryWeightKg, cameraId?, reason }` → `200 { ticket }`
- `PATCH /api/admin/tickets/:id/exit` `{ exitAt, exitWeightKg, cameraId?, reason }` → `200 { ticket }` (closes the ticket)
- `POST /api/admin/tickets/:id/reprint` `{ reason? }` → `202 { ticket }`
- `GET /api/admin/unresolved-events?source=&page=&pageSize=` → `{ items: RawEvent[], total }`
- `GET /api/admin/status` → `{ cameraEntrance, cameraExit, scale, printBridge, relay }`, each `{ reachable: boolean, lastSeenAt: string | null }`

`Ticket`/`AuditLogEntry`/`RawEvent` are the Drizzle schema rows
(`apps/core-service/src/db/schema.ts`), serialized as ISO date strings over
JSON, camelCase, same field names — already true of the schema, so no
mapping layer is needed for those three shapes.

## Design decisions

- **Auth**: `bcryptjs` password hash (`adminUsers.passwordHash`, already in
  the schema) + server-side session. Use `@fastify/cookie` + `@fastify/session`
  (in-memory session store is fine — single process, single PC, no need for
  Redis). Seed the first admin user via a one-off script/CLI flag rather
  than a signup endpoint (no self-registration in scope).
- **Audit trail**: every mutating admin route (`PATCH .../entry`,
  `PATCH .../exit`, `POST /tickets`, `POST .../reprint`) must call
  `repo.appendAuditLog(ticketId, actor, action, payload)` with `actor` =
  the logged-in admin's username and `payload` including the mandatory
  `reason` plus the before/after values, inside the same transaction as the
  mutation (matches the existing transactional pattern from Phases 1–5).
- **Hardware status**: no existing code tracks "reachability" for most
  components, so each needs a small, targeted addition rather than a new
  subsystem:
  - `cameraEntrance` / `cameraExit`: derive from the most recent
    `rawEvents` row per source (`MAX(receivedAt)` where
    `source IN ('camera_entrance', 'camera_exit')`); `reachable` = a row
    exists within a configurable staleness window (default 24h).
  - `scale`: add a `getStatus(): { connected: boolean; lastSeenAt: Date | null }`
    method to `ScaleClient` (and its mock), backed by the TCP client's
    existing socket state + timestamp of the last successful read.
  - `printBridge`: `GET` the print bridge's existing `/health` route
    through `PrintClient`; reachable = 200 response, `lastSeenAt` = time of
    that successful check (polled on-demand when `/api/admin/status` is
    called, not a background poller — simplest option, fine at this
    traffic volume).
  - `relay`: add a `getStatus(): { lastSuccessAt: Date | null; lastFailureAt: Date | null }`
    to `DriverSignalAdapter` (and its implementation), updated on every
    `signalDriver()` call; `reachable` = last call succeeded.
- **Pagination/search**: `listTickets`/`listUnresolvedEvents` are new
  repository methods (today only `findOpenByPlate`/`findById` exist) using
  Drizzle `limit`/`offset` + `like()` on `plate` for search + date range on
  `entryAt`/`exitAt`.
- **Where the contract types live**: keep them in `apps/admin-ui/src/api/types.ts`
  as the source of truth for now (per the frontend plan's original call) —
  duplicating a handful of interfaces into core-service's route layer is
  cheaper right now than untangling a cross-app shared-types migration.
  Flag as a follow-up for Phase 8 hardening if duplication becomes painful.

## Steps

1. **Repository + schema additions** — `listTickets(query)`,
   `listUnresolvedEvents(query)`, `findAuditLogByTicketId(ticketId)`,
   `findAdminUserByUsername(username)` added to `repository.ts`; a seed
   library (`src/db/seed-admin.ts`: `parseArgs`/`seedAdminUser`) plus a thin
   CLI entrypoint (`src/db/seed-admin-cli.ts`, run via
   `npm run db:seed-admin --workspace=@tare/core-service -- --username=<u> --password=<p>`)
   to create/reset the first admin user. Password hashing uses **`bcryptjs`**
   (pure-JS), not `bcrypt` — chosen specifically to avoid a second
   node-gyp/native-build dependency on top of `better-sqlite3` (this dev
   machine has no working Python toolchain for node-gyp; verification ran
   via a throwaway `node:24-alpine` Docker container with
   `apk add python3 make g++`, matching how the project already handles
   `better-sqlite3`'s native build in `docker/Dockerfile.core-service`).
   Unit tests against a real temp-file SQLite DB (existing convention — no
   mocking the DB): 13 new tests (9 repository + 4 seed-admin), all passing;
   typecheck and lint clean.
   Status: **done**

2. **Auth routes + session plumbing** — `@fastify/cookie` +
   `@fastify/session` registered only inside the `/api/admin` encapsulated
   plugin context (camera/print routes untouched); `src/admin/auth-service.ts`
   (`bcryptjs` compare); `POST /api/admin/auth/login`, `POST .../logout`,
   `GET .../me`; a `requireAuth` preHandler applied per-route to everything
   else under `/api/admin`. Session cookie: `httpOnly: true, secure: false,
   sameSite: 'lax'` (plain HTTP on a closed LAN — no TLS to require `secure`
   for). `src/admin/config.ts` (`loadAdminConfig`) requires `ADMIN_SESSION_SECRET`
   (≥32 chars) via a new `parseRequiredSecret` helper in `config/env.ts`.
   Status: **done**

3. **Ticket read routes** — `GET /api/admin/tickets` (list/filter/paginate),
   `GET /api/admin/tickets/:id` (ticket + audit log). `src/admin/serialize.ts`
   converts repository rows (Dates) to the wire shape (ISO strings) matching
   `apps/admin-ui/src/api/types.ts`.
   Status: **done**

4. **Ticket write routes + audit trail** — `POST /api/admin/tickets`
   (manual create, `createdByAdmin: true` — required a new optional field on
   `CreateTicketInput`/`repo.create()`), `PATCH .../entry` (OPEN tickets only,
   409 otherwise), `PATCH .../exit` (closes an OPEN ticket **or** corrects an
   already-CLOSED one via a new `repo.correctExit()` — 409 for ANOMALY
   tickets, whose documented correction path is creating a new ticket from
   the Admin UI's "unresolved events" view, not editing this one), `POST
   .../reprint` reusing the existing `PrintService.reprint()`. Every mutation
   writes an audit log entry in the same transaction. `printIfNeeded()` is
   called after a successful exit edit — a no-op if the ticket was already
   printed, so the OPEN→CLOSE path auto-prints but a correction-after-print
   doesn't silently reprint. Tests cover the master plan's §8 critical flow
   (edit a weight → audit log entry appears → reprint succeeds) plus the
   validation/conflict branches (missing reason → 400, wrong status → 409,
   print bridge failure → 502).
   Status: **done**

5. **Unresolved events route** — `GET /api/admin/unresolved-events`
   (raw_events with no `linkedTicketId`, filterable by source, paginated;
   `repo.listUnresolvedEvents()`). Returns the full `Paginated<RawEvent>`
   shape (`items/total/page/pageSize`), matching `admin-ui`'s `client.ts`
   (not the slightly looser `{items, total}` this plan originally sketched).
   Status: **done**

6. **Hardware status route** — `GET /api/admin/status`
   (`src/admin/hardware-status.ts`). Required small, targeted additions:
   `ScaleClient.getStatus()` (tcp-client now tracks `lastSeenAt` on every
   stable frame), `DriverSignalAdapter.getStatus()` (http-relay-adapter now
   tracks `lastSuccessAt`/`lastFailureAt` per attempt; reachable = most
   recent attempt succeeded), `PrintClient.checkHealth()` (GETs the print
   bridge's existing `/health`), and `repo.findLastEventTimestamp(source)`
   for camera staleness (default 24h window). Every existing fake
   implementing these three interfaces across other test files had to grow
   the new methods too (mechanical, not behavioral).
   Status: **done**

7. **Wire into `buildApp()` / `server.ts`** — `registerAdminRoutes(app, {...})`
   added to `BuildAppOptions` (new required `adminSessionSecret` field, so
   every existing `buildApp()` call site in tests needed it added too);
   `server.ts` calls `loadAdminConfig()` and passes `sessionSecret` through.
   `ADMIN_SESSION_SECRET` must be set in the environment/`.env` for
   `docker-compose.yml` (already passes through via its existing
   `env_file: ../.env` — no compose changes needed).
   Status: **done**

8. **Point the Admin UI at the real backend** — no code changes needed on
   either side: `apps/admin-ui`'s `vite.config.ts` already proxies `/api` to
   `http://localhost:3000`, and `VITE_API_MODE=proxy` (anything other than
   `mock`) already skips the MSW worker in `main.tsx`. Verified end-to-end
   with both processes actually running (`tsx watch src/server.ts` +
   `vite --host 0.0.0.0`) in a throwaway container, driven with `curl`
   (no GUI browser available in this session — the Claude-in-Chrome
   extension wasn't connected here; a real visual pass through the pages
   is still worth doing by hand when a browser is available): seeded an
   admin user via `db:seed-admin`, logged in through the Vite dev server's
   proxy, got a session cookie back, reused it for `/auth/me`, created a
   ticket via `POST /api/admin/tickets`, listed it back via
   `GET /api/admin/tickets` (shape matches `Paginated<Ticket>` exactly),
   fetched `/api/admin/status`, and confirmed an unauthenticated request
   gets a clean 401. No contract mismatches found — the routes already
   match `apps/admin-ui/src/api/types.ts` and `client.ts` exactly, so no
   frontend changes were needed.
   Status: **done** (API-level integration proven; a hands-on visual pass
   in an actual browser is recommended before considering the UI fully
   signed off, since this session couldn't do one)

9. **Final pass** — ran lint/typecheck/build/test across all four
   workspaces (`@tare/shared`, `@tare/core-service`, `@tare/print-bridge`,
   `@tare/admin-ui`) from the repo root, via the same throwaway Docker
   container as every other step (no working local Python/node-gyp on this
   machine — see the `CLAUDE.md` dev-workflow note added this session).
   - `npx eslint .`: 0 errors (2 pre-existing warnings, unrelated to this
     work — `AuthContext.tsx`/`StatusBadge.tsx` fast-refresh warnings
     already known from the frontend's own plan).
   - Typecheck + build: clean on all four workspaces.
   - Tests: core-service 165/165, admin-ui 11/11 (unchanged, still against
     its MSW mocks), print-bridge 9/10 — the one failure
     (`app.test.ts > GET /health`, a `vitest` `testTimeout` hit) is a
     container-specific artifact, **not a regression**: the *first*
     `app.inject()` call against a freshly built Fastify instance in this
     particular `node:24-alpine` container consistently takes ~8-17s before
     resolving (confirmed by reproducing the identical symptom in
     `core-service`'s own `app.test.ts` and `admin/routes.test.ts`, neither
     of which this plan's work should affect either), while every
     subsequent request in the same test file resolves in milliseconds.
     Passes reliably with a bumped `testTimeout`. Root cause not
     investigated further (likely something about this container's
     network/thread setup on first use) since it's orthogonal to this
     plan's scope and doesn't reproduce as a logic bug.
   Status: **done**

## Out of scope for this plan

- Real scale/camera/relay hardware integration (deferred to Phase 7,
  on-site — see master plan §7).
- Packaging/deployment (Phase 7) and hardening (Phase 8), e.g. session
  secrets management, rate limiting, HTTPS — closed-LAN threat model per
  the master plan, revisit if that changes.
- Serving the built `admin-ui` static files from `core-service` (that's a
  Phase 7 packaging concern).
