# Admin UI: top nav → left sidebar nav — Development Plan

Status: **In progress**
Created: 2026-11-10

## 1. Request

The Admin UI's top navigation bar (`AppShell.tsx`) crams 7 page links
(`Dashboard`, `Operation`, `History`, `Unresolved events`,
`Internal trucks`, `Hardware status`, `Users`) plus the language switcher,
hardware badge, username and logout button into one horizontal row. The
user reports it's too tight and wants it changed to a left sidebar menu
instead.

## 2. Design

Single component touched: `apps/admin-ui/src/components/layout/AppShell.tsx`.
No route, API, or test-selector changes — `NAV_LINKS` keeps the same
`labelKey`s and `NavLink` still renders an `<a>` with `aria-current="page"`
when active, so existing tests that do
`screen.getByRole('link', { name: /^users$/i })` keep working regardless of
container markup.

Layout changes from a single top `<header>` to:
- `<aside>` (fixed-width, left, full height, white bg, right border): app
  name at top, then the 7 nav links stacked vertically (same active/hover
  classes as today, just `block` instead of inline pills).
- A slim `<header>` in the remaining flex column, right-aligned, keeping
  exactly what's there today: language switcher, hardware badge
  (admin-only), username/change-password link, logout button.
- `<main>` keeps the existing centered `max-w-6xl` content width, now
  inside the remaining flex column instead of the full viewport width.

No new dependencies, no icons added (text-only links, matching current
style). Not addressing mobile/narrow-viewport collapse — out of scope,
matches the current desktop-only assumption (operator/admin screens run on
a fixed monitor at the scale booth, per the master plan's non-goals).

## 3. Steps

### Step 1 — Rebuild AppShell as a sidebar layout
**Status: in progress**

- Rewrite `AppShell.tsx`'s JSX per the Design section above.
- Keep `NAV_LINKS`, `linkClass` logic (active/inactive colors), the
  `isAdmin` filter, and every existing child component
  (`LanguageSwitcher`, `HardwareStatusBadge`) unchanged.
- Verify: `npm run typecheck --workspace=@tare/admin-ui`,
  `npm run test --workspace=@tare/admin-ui`, then run the Vite dev server
  and look at the result in a browser.

### Step 2 — Docs cleanup (after merge)
**Status: not started**

- Delete this plan file per `CLAUDE.md`'s working-document convention.
