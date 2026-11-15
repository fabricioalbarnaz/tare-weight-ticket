# Let the operator edit tickets, reusing the admin's ticket detail screen

**Status:** All steps implemented and verified. Pending user review before
deleting this plan file per `CLAUDE.md`'s workflow.

## Decision (requested by user, 2026-11-14)

Today an `operator` login can only see the Operação screen
(`/operation`) — a read-only ticket table plus the live weighing panel —
and every ticket-editing route is `admin`-only, both in the UI (route
guard) and server-side (`requireAdmin` preHandler), per the 2026-11-09
user-management decision (master plan §11).

New behavior: an operator can open a ticket from the Operação screen and
edit its entry/exit leg, reprint it, and see its audit trail — **the
exact same `TicketDetailPage` component the admin dashboard already
uses**, not a copy. No new component is built; the existing one is
reached from one more place and allowed for one more role.

**Explicitly unchanged** (confirm before Step 1 if this is wrong):
- Manually **creating** a ticket (`/tickets/new`, `POST /tickets`) stays
  admin-only — the user asked to free up *editing*, not creation.
- Every other admin-only screen (dashboard, history, unresolved events,
  internal trucks, hardware status, users) stays admin-only.
- No change to what an operator can see in the ticket list itself (same
  columns, same data) — only that the ticket number becomes a link.

## Why

Operationally the balance operator is the one physically present when a
weighing goes wrong (misread plate, wrong weight typed by a previous
manual entry, truck that needs a re-print) and currently has to find an
admin to fix it from the one screen operators can't reach. Reusing the
admin's screen as-is avoids building and maintaining a second edit UI.

## Risk / tradeoff to flag before starting

This removes the one access control the 2026-11-09 decision put in
place: any operator will be able to rewrite a ticket's recorded
entry/exit weight and timestamp (with a mandatory reason note, still
audited under their own username) without an admin. If that's broader
than intended, the alternative is a narrower change (e.g. a new
`requireAuth`-but-not-`requireAdmin` check still restricted to tickets
from the current day, or still admin-only for reprint). Flagging this
once, in writing, before Step 1 — proceeding as scoped above unless told
otherwise.

## Steps

### Step 1 — Backend authorization (`core-service`)

`apps/core-service/src/admin/routes.ts`: change `preHandler` from
`requireAdmin` to `requireAuth` on exactly these four routes (leave every
other route, including `POST /tickets`, untouched):
- `GET /tickets/:id` (~line 259)
- `PATCH /tickets/:id/entry` (~line 303)
- `PATCH /tickets/:id/exit` (~line 340)
- `POST /tickets/:id/reprint` (~line 388)

`apps/core-service/src/admin/routes.test.ts`: extend the existing
`'lets an operator list tickets but rejects admin-only routes with 403'`
test (~line 807) with a new one (or an addition to it) asserting an
operator **can** now: `GET /tickets/:id` (200), `PATCH .../entry` (200,
ticket still `OPEN`), `PATCH .../exit` (200), `POST .../reprint` (202/200
per current contract) — and that `POST /tickets` (creation) still 403s
for the same operator. Also check the audit log row created by an
operator's edit records their username as `actor` (already true by
construction — `request.adminUser!.username` — but worth one explicit
assertion since it's the whole point of keeping edits attributable).

### Step 2 — Frontend route guard (`admin-ui`)

`apps/admin-ui/src/AppRoutes.tsx`: move the single line
`<Route path="/tickets/:id" element={<TicketDetailPage />} />` out of
the `<RequireAdmin />` block (~line 38) into the "Open to every profile"
section above it (next to `/operation` and `/account/password`, ~line
27). `/tickets/new` and everything else stay inside `<RequireAdmin />`.

### Step 3 — Make the ticket actually reachable from the Operação screen

Both of these currently pass `readOnly` to `TicketTable` specifically
*because* operators couldn't open the detail page — now they can:
- `apps/admin-ui/src/pages/OperationPage.tsx` (~line 50): drop the
  `readOnly` prop. Also update the stale doc comment above the component
  (~line 16-20: "No create/edit/detail actions... view only").
- `apps/admin-ui/src/components/operation/LiveWeighingPanel.tsx`: drop
  `readOnly` from both `<TicketTable>` usages (~line 143 and ~line 166).

`apps/admin-ui/src/components/tickets/TicketTable.tsx` (~line 12): update
the prop doc comment — it no longer links to an "(admin-only)" page.

### Step 4 — Role-aware way back out of the ticket screen

`TicketDetailPage.tsx`'s top-left link (~line 44) always points to `/`
(`common.backToDashboard`), which is the admin dashboard — for an
operator this would silently bounce them to `/operation` via
`RequireAdmin`'s redirect, which reads as a broken link. Make it
role-aware:
- Read `user` from `useAuth()`.
- Admin → `to="/"`, label `t('common.backToDashboard')` (unchanged).
- Operator → `to="/operation"`, label a new `t('common.backToOperation')`.
- Add `backToOperation` next to the existing `backToDashboard` key in
  both `apps/admin-ui/src/i18n/locales/en.json` and `pt-BR.json`
  (`pt-BR.json` ~line 7: `"← Voltar ao painel"` → add e.g.
  `"backToOperation": "← Voltar à Operação"`; mirror in English).

### Step 5 — Tests

- `apps/admin-ui/src/api/mocks/fixtures.ts` already defines
  `MOCK_OPERATOR_CREDENTIALS` (~line 395) but
  `apps/admin-ui/src/test-helpers.ts` only has `loginAsAdmin`. Add
  `loginAsOperator` there, mirroring `loginAsAdmin`, for this and future
  operator-permission tests to use.
- New test (in `TicketDetailPage.test.tsx` or `AppRoutes`-level, whichever
  the existing test style favors): logging in as the operator fixture and
  navigating to `/tickets/:id` renders the page instead of redirecting to
  `/operation`, and the edit form submits successfully (mock handlers for
  `/tickets/:id/entry`/`/exit`/`/reprint` already have no admin check —
  confirmed while investigating, no mock-side change needed).
- New test: on the Operação screen, a ticket number in the table is now a
  link to `/tickets/:id` (currently only implicitly covered — `OperationPage.test.tsx`
  and `LiveWeighingPanel.test.tsx` assert the text `#<number>` appears,
  which stays true whether it's a link or plain text, so this needs an
  explicit `getByRole('link', ...)` assertion to actually catch a
  regression).
- Re-run the full `admin-ui` test suite to confirm nothing else assumed
  `readOnly` tables for the operator role.

### Step 6 — Docs

`docs/plans/2026-09-29-tare-weight-ticket-plan.md`:
- §11 "User management" section (~line 1398-1405): add a new dated
  sub-entry (2026-11-14) narrowing the 2026-11-09 decision — list the
  four newly-`requireAuth` routes, and restate the operator's route list
  since "only `GET /tickets`, `GET /tickets/stream`, plus auth routes" is
  no longer accurate.
- §3 capability bullets (~line 115-117): "`operator` (only the read-only
  Operação screen)" is no longer accurate — reword to reflect that the
  operator can edit/reprint a ticket from there too.

## Verification

Per `CLAUDE.md`'s per-workspace rule:
- `core-service` (Step 1): verify via the Alpine Docker one-liner
  (`lint`, `typecheck`, `test`) — this is the authoritative environment
  for this workspace.
- `admin-ui` (Steps 2-5): native is fine (`npm run typecheck|test
  --workspace=@tare/admin-ui`); confirmed earlier in this session that
  `vite`/`vitest` run natively once the missing
  `@rolldown/binding-win32-x64-msvc` optional dependency is present.
- Manual check in the browser (mock mode, `VITE_API_MODE=mock`): log in
  as the operator fixture, open a ticket from `/operation`, edit a leg,
  reprint, confirm the back-link returns to `/operation`.

## Progress

- [x] Step 1 — backend authorization + tests (verified: Alpine Docker
      lint/typecheck/test, 383 tests passing)
- [x] Step 2 — frontend route guard (`/tickets/:id` moved out of
      `<RequireAdmin />`)
- [x] Step 3 — reachable from Operação screen (`readOnly` dropped from both
      `TicketTable` usages; stale doc comments updated)
- [x] Step 4 — role-aware back link (`TicketDetailPage` reads `useAuth()`;
      new `backToOperation` i18n key in both locales)
- [x] Step 5 — tests (`loginAsOperator` added to `test-helpers.ts`; new
      operator tests in `OperationPage.test.tsx` and
      `TicketDetailPage.test.tsx`; old read-only assertion in
      `OperationPage.test.tsx` updated to assert the link instead — verified
      native: `npm run typecheck|test --workspace=@tare/admin-ui`, 47 tests
      passing, plus a targeted `eslint` run on every changed file)
- [x] Step 6 — docs (`docs/plans/2026-09-29-tare-weight-ticket-plan.md` §3
      and §11 updated)
