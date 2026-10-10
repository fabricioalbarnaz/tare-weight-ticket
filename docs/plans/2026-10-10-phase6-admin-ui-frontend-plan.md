# Phase 6 — Admin UI (frontend only) — Development Plan

Status: **Done — awaiting user review before commit/PR**
Created: 2026-10-10
Scope note: this worktree (`feat/admin-ui`) builds **only** `apps/admin-ui`
(the React/Vite SPA). Backend work (Phases 2–5 and the Phase 6 server-side
admin API routes) is being developed in parallel in another worktree
(`feat/backend-initial-structure`). This plan treats the admin REST API as
a contract to build against, not something to implement here.

Per the master plan (`docs/plans/2026-09-29-tare-weight-ticket-plan.md`
§3.4, §9 Phase 6), the Admin UI must provide: auth, a dashboard of today's
tickets, manual edit/create/reprint flows with mandatory reason notes (audit
trail), a hardware status panel, and a historical ticket list/search. §5
also implies a way to see unresolved camera events (unreadable plate) that
need a manually created ticket.

## Assumed API contract (for backend to implement; documented so the two
worktrees can reconcile at merge time)

All routes under `/api/admin`, session-cookie auth (httpOnly, matches
master plan §3.4). Shapes below are written in TS for clarity; real
contract types live in `apps/admin-ui/src/api/types.ts` (kept local to this
app, not `packages/shared`, to avoid colliding with concurrent backend work
on that package — flagged as an integration follow-up, not merged in).

- `POST /api/admin/auth/login` `{ username, password }` → `200 { username }` or `401`
- `POST /api/admin/auth/logout` → `204`
- `GET /api/admin/auth/me` → `200 { username }` or `401`
- `GET /api/admin/tickets?status=&search=&from=&to=&page=&pageSize=` → `{ items: Ticket[], total, page, pageSize }`
- `GET /api/admin/tickets/:id` → `{ ticket: Ticket, auditLog: AuditLogEntry[] }`
- `POST /api/admin/tickets` (manual creation) `{ plate, entryAt, entryWeightKg, reason }` → `201 { ticket }`
- `PATCH /api/admin/tickets/:id/entry` `{ entryAt, entryWeightKg, cameraId?, reason }` → `200 { ticket }`
- `PATCH /api/admin/tickets/:id/exit` `{ exitAt, exitWeightKg, cameraId?, reason }` → `200 { ticket }` (closes the ticket)
- `POST /api/admin/tickets/:id/reprint` `{ reason? }` → `202 { ticket }`
- `GET /api/admin/unresolved-events?source=&page=&pageSize=` → `{ items: RawEvent[], total }` (raw_events with no linked ticket)
- `GET /api/admin/status` → `{ cameraEntrance, cameraExit, scale, printBridge, relay }`, each `{ reachable: boolean, lastSeenAt: string | null }`

`Ticket` mirrors `apps/core-service/src/db/schema.ts` fields, serialized as
ISO date strings over JSON (camelCase, same field names as the Drizzle
schema minus DB-only concerns).

## Decisions made to unblock frontend-only work (no real backend yet)

- **Mock Service Worker (MSW)** provides a full fake implementation of the
  contract above, used in dev (`npm run dev`) and in tests. A `VITE_API_MODE`
  env var (`mock` default, `proxy` to hit a real core-service) switches
  behavior; Vite dev server also proxies `/api` to `http://localhost:3000`
  for when `proxy` mode is used against the other worktree's running
  backend.
- **Data fetching**: TanStack Query (`@tanstack/react-query`) — not
  mandated by the master plan, but the plan leaves this unspecified and it
  fits a small CRUD-heavy SPA well (cache, mutations, invalidation).
- **Routing**: `react-router` (SPA, client-side only — served as a static
  build per master plan §3.4).
- **Forms**: `react-hook-form` + `zod` for the manual entry/exit/create
  forms (mandatory reason field validation, weight/timestamp validation).
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`), per master plan §6.
- Not touching `docker/`, `packages/shared`, or `apps/core-service` in this
  worktree.

## Steps

1. **Scaffold `apps/admin-ui`** — Vite + React + TS app wired into the npm
   workspace, Tailwind v4, ESLint/Prettier using the root configs,
   `tsconfig` extending `tsconfig.base.json`, Vitest + React Testing
   Library, Playwright for smoke tests, `npm run dev/build/lint/typecheck/test`
   all working from repo root.
   Status: done
2. **API contract types + client + MSW mocks** — `src/api/types.ts`,
   a small typed fetch client (`src/api/client.ts`), MSW handlers
   implementing the contract above with believable in-memory fixture data
   (several tickets in OPEN/CLOSED/ANOMALY, a couple of unresolved events,
   plausible hardware status), MSW wired into both `npm run dev` and the
   Vitest setup.
   Status: done
3. **Auth** — login page, `AuthProvider`/`useAuth` (checks `/auth/me` on
   load), route guard redirecting to `/login` when unauthenticated, logout
   action.
   Status: done
4. **App shell** — top nav (Dashboard, History, Unresolved Events,
   Hardware Status, logout), hardware-status summary indicator always
   visible in the header.
   Status: done
5. **Dashboard** — today's tickets, filterable by status
   (OPEN/CLOSED/ANOMALY/all), table with plate, times, weights, net
   weight, status badge, row actions (edit, reprint where applicable).
   Status: done
6. **Ticket detail + manual edit/create flows** — view full ticket +
   audit trail; forms to edit entry leg / edit exit leg (mandatory reason,
   zod-validated) and to manually create a new ticket from scratch; reprint
   action with confirmation.
   Status: done
7. **Unresolved events view** — list of raw camera events with no linked
   ticket, action to open the "create ticket" flow pre-filled from one.
   Status: done
8. **Hardware status page** — camera/scale/print-bridge/relay reachability
   and last-seen, polling refresh.
   Status: done
9. **Historical tickets search** — separate view (or dashboard mode) for
   searching by plate/date range across all history, paginated.
   Status: done
10. **Tests** — component tests (login, dashboard table/filters, ticket
    detail deep-link, edit entry/exit forms + audit trail appearing after
    edit, reprint action, manual create flow, unresolved events, hardware
    status, history search), all against the MSW mocks, covering the exact
    critical flow called out in the master plan (edit a weight → audit log
    entry appears → reprint succeeds).
    Status: done — 7 files / 10 tests, all passing. Playwright
    (`playwright.config.ts`, `test:e2e` script) is scaffolded but no spec
    was written yet: a browser-driven e2e test is far more valuable once
    there's a real backend to run against end-to-end (this session's MSW
    mocks make it largely redundant with the component tests above), and
    this session also hit a serious host memory shortage (see Notes below)
    that made spinning up a real Chromium instance an avoidable risk.
    Revisit once Phase 2–5 land and a real core-service is available to
    point the admin UI at.
11. **Final pass** — `npm run lint`, `npm run typecheck`, `npm run test`,
    `npm run build` green from repo root; update this plan's statuses;
    write the commit message / PR description for the user; stop for
    review (per session instructions, no commit).
    Status: done — lint (0 errors, 2 pre-existing fast-refresh warnings on
    files that intentionally export a hook/helper alongside a component),
    typecheck, test (10/10), and build are all green.

## Notes from this run

- Two real bugs were found and fixed while writing the component tests:
  `vitest.config.ts` has `globals: false`, which means
  `@testing-library/react`'s automatic `afterEach(cleanup)` never
  registers (it only self-installs when it detects a *global* `afterEach`),
  so renders from one test were leaking into the next. Fixed by calling
  `cleanup()` explicitly in `src/setup-tests.ts`. Also, `AuthContext`'s
  `login()` re-threw on failure, which `LoginPage`'s `handleSubmit` doesn't
  catch, producing an unhandled rejection on every failed-login test; fixed
  by swallowing the error in `login()` since the failure is already
  surfaced via `loginError` state.
- Unrelated to the code: this session hit severe, misleading flakiness
  (tests timing out after 20s+ despite a 5s timeout, background test runs
  getting killed) that turned out to be the host machine running critically
  low on free memory (0.77 GB free of 15.73 GB at the worst point), not an
  application bug. Confirmed fixed once memory freed up — full suite passes
  in ~4s.

## Out of scope for this worktree

- Serving the built admin-ui from `apps/core-service` (static file serving
  wiring is a backend concern / Phase 7 packaging).
- Implementing the actual `/api/admin/*` routes, bcrypt auth, or session
  cookies server-side.
- `packages/shared` changes.
- Print Bridge / relay / scale / camera integration code.
