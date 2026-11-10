# User management (admin/operator profiles, own password change) — Development Plan

Status: **Implemented, awaiting commit/merge.** All steps are done;
only deleting this file after merge remains.

**Note (2026-11-09): user approved the plan and asked to execute all steps
without a stop-and-review checkpoint after each one.**
Created: 2026-11-09

## 1. Request

Today `admin_users` has only `username`/`password_hash`/`created_at`, the
only way to create a user is the `db:seed-admin` CLI, and every logged-in
user can do everything. The user asked for a user-management area in the
Admin UI where an admin can create, edit and deactivate users, each with a
profile of either **admin** or **operador**, and where any user can change
their own password (the admin sets an initial one).

## 2. Decisions (confirmed with the user, 2026-11-09)

1. **Operator permissions**: for now, the operator can only use the
   "Operação" screen (read-only ticket list + live weighing panel). Every
   other screen and admin API route is admin-only.
2. **Forced password change**: whenever an admin sets a password (user
   creation or a password reset), that user must change it on their next
   login before using anything else. The change asks for the current
   password and the new one.
3. **Editable fields**: the admin can edit a user's **name** (new field,
   required) and profile, and reset their password. The `username` (login)
   is immutable after creation, because it's the `actor` written to
   `ticket_audit_log`/`truck_audit_log`.
4. **Deactivation**: an inactive user can't log in, and an already-open
   session stops working immediately. A user can be reactivated. No hard
   delete (keeps audit history meaningful). Guards: an admin can't
   deactivate themselves or change their own profile, and the system can
   never be left without at least one active admin.
5. **Password rule**: minimum 6 characters, nothing else. The rule is
   shown as helper text under every password field.
6. **Existing users** (created via `db:seed-admin`) become `admin` in the
   migration. The seed CLI stays as the emergency recovery path: it now
   also forces `role = admin` and `active = true` on an existing user.

## 3. Design

### Data model

Keep the table name `admin_users` (renaming it is churn with no benefit;
it now just means "users of the Admin UI"). New columns:

| column | notes |
|---|---|
| name | text, not null — migration backfills existing rows with `username` |
| role | `admin` \| `operator`, not null, default `admin` |
| active | bool, not null, default `true` |
| must_change_password | bool, not null, default `false` (existing users aren't forced) |
| updated_at | timestamp, not null — backfilled with `created_at` |

### Auth/authorization (backend)

- The session stores `adminUserId` instead of trusting a cached
  username/role. `requireAuth` re-reads the user **on every request**
  (one indexed SQLite lookup — trivial at this volume) and rejects with
  401 (and destroys the session) if the user no longer exists or is
  inactive. That's what makes deactivation and profile changes take
  effect immediately, with no session-store bookkeeping. The username
  used as audit `actor` comes from that fresh lookup.
- New `requireAdmin` preHandler (403 for operators) on every admin route
  except the ones the Operação screen needs: `GET /tickets`,
  `GET /tickets/stream`, plus the auth routes. The header's
  `HardwareStatusBadge` (`GET /status`) stays admin-only and is hidden for
  operators.
- While `mustChangePassword` is true, `requireAuth` answers 403
  `password_change_required` for everything except `GET /auth/me`,
  `POST /auth/logout` and `POST /auth/change-password` — enforced
  server-side, not just by the UI redirect.
- Login rejects an inactive user with the same generic 401 as wrong
  credentials (doesn't leak which usernames exist).
- `POST /auth/login` and `GET /auth/me` return
  `{ id, username, name, role, mustChangePassword }`.

### New API (all under `/api/admin`)

| route | who | notes |
|---|---|---|
| `POST /auth/change-password` `{ currentPassword, newPassword }` | any logged-in user | 400 if current is wrong or new is < 6 chars or equal to current; clears `mustChangePassword` |
| `GET /users` | admin | list, active and inactive, no password hashes |
| `POST /users` `{ username, name, role, password }` | admin | 409 on duplicate username; username 3–32 chars of `[A-Za-z0-9._-]`; created with `mustChangePassword = true` |
| `PATCH /users/:id` `{ name, role }` | admin | 400 if changing own role; 409 if it would leave no active admin |
| `POST /users/:id/reset-password` `{ password }` | admin | sets `mustChangePassword = true`; 400 on self (use change-password) |
| `POST /users/:id/deactivate` / `POST /users/:id/activate` | admin | 400 on self; 409 if it would leave no active admin |

A dedicated `src/users/repository.ts` (same pattern as
`src/trucks/repository.ts`); `findAdminUserByUsername` moves there from the
ticket repository. User-management actions are **not** written to an audit
table in this first version (no user audit log exists today) — flagged as
a possible follow-up, not built now.

### Frontend

- `CurrentUser` gains `id`, `name`, `role`, `mustChangePassword`.
- Route guards: a `RequireRole`/`RequireAdmin` wrapper around every
  admin-only route; an operator hitting one is redirected to `/operation`,
  and `/` (dashboard) redirects operators to `/operation` too. Nav links
  filtered by role; the hardware badge hidden for operators.
- When `mustChangePassword` is true, every route redirects to a
  `/change-password` page (no app nav, only logout) until it's done.
- Header: the user's name links to a "Alterar senha" page (same form as
  the forced one, voluntary).
- New "Usuários" page (admin only): table (name, username, profile,
  status) + create form; per-user edit (name/profile), reset password,
  activate/deactivate actions. Guard errors from the API (last admin,
  self) shown inline.
- i18n pt-BR/en, MSW handlers + fixtures, component tests.

## 4. Steps

### Step 1 — Backend: schema, migration, users repository, auth/authorization
**Status: done.** Migration `0002_user_management.sql` was generated by
`drizzle-kit` then hand-edited (SQLite can't `ADD` a `NOT NULL` column with
no default to a non-empty table: `name`/`updated_at` get a placeholder
default and are backfilled from `username`/`created_at`).
`findAdminUserByUsername` moved off `TicketRepository` into the new
`UserRepository`. Business-error responses are machine-readable codes
(`USER_ERRORS` in `routes.ts`, e.g. `password_change_required`,
`last_active_admin`) so the UI can translate them. Verified in the Alpine
container: typecheck clean, core-service 335/336. The one failure is the
known `app.test.ts` `/health` cold-start timeout. It passed at 4.3s when
re-run alone with a longer timeout, against vitest's 5s default.

- `db/schema.ts` new columns + generated Drizzle migration (with the
  `name`/`updated_at` backfill).
- `src/users/repository.ts` (+ tests): find by id/username, list, create,
  update name/role, set password (+ `mustChangePassword` flag),
  set active, count active admins.
- `db/seed-admin.ts`: also force `role = admin`, `active = true` on reset.
- `admin/session.ts`: `adminUserId`. `admin/auth-service.ts`: reject
  inactive users. `admin/routes.ts`: `requireAuth` re-reading the user,
  `requireAdmin`, `mustChangePassword` gate, new login/me response shape,
  `requireAdmin` applied to every route except the Operação ones.
- Tests: inactive login rejected, deactivated user's open session gets
  401, operator gets 403 on admin routes and 200 on `GET /tickets` /
  stream, `password_change_required` gate.

### Step 2 — Backend: user management + change-password routes
**Status: done** (done together with Step 1, same verification run).
The "last active admin" guard is defense in depth: with the self-guards
in place, it isn't reachable through the API today.

- Schemas + routes from the table above, with all guards (self, last
  active admin, duplicate username, password length).
- Route tests for every success and guard case.

### Step 3 — Frontend: auth/role plumbing + change-password page
**Status: done.** `RequireAdmin` wraps every admin-only route and
redirects operators to `/operation`, including `/`, where login lands
by default. `RequireAuth` redirects to `/change-password` while
`mustChangePassword` is set. The voluntary page is `/account/password`,
reached by clicking your name in the header. The login screen copy
changed from "Admin sign in" to a neutral "Sign in" / "Acesso ao sistema",
since operators use it too. MSW mocks gained a user store with an
operator and a pending-password-change user.

- Types/client, `AuthContext`, role guards, nav filtering, operator
  redirect to `/operation`, forced and voluntary change-password page,
  MSW handlers, i18n, tests.

### Step 4 — Frontend: Users management page
**Status: done.** `/users` (list + create) and `/users/:id` (edit
name/profile, reset password, deactivate/reactivate; none of the
self-forbidden actions are offered on your own user). There is no
`GET /users/:id`: the detail page reads the shared `['users']` list.
Verification (Alpine container): lint 0 errors (2 pre-existing warnings),
typecheck clean, admin-ui 44/44, core-service 31/31 files, build clean.
The only red test across the repo is `scale-bridge` `/health` (untouched
by this change, 9.1s cold-start timeout in the container, passes at 5.6s
with a longer timeout). Migration 0002 was also run against a DB with a
pre-existing admin row, and the backfill was correct. Running Prettier on
touched files also reformatted pre-existing, never-Prettier-clean code.
That was undone with a 3-way merge, so the diff only contains this
feature.

- `UsersPage` + create/edit/reset-password forms, activate/deactivate,
  password helper text ("mínimo 6 caracteres"), MSW handlers/fixtures,
  i18n, tests. Verification of the whole feature in the Alpine container
  per `CLAUDE.md`.

### Step 5 — Docs
**Status: done** (except deleting this file, which happens after merge).

- Master plan §3.4 (profiles), §4 (`admin_users` columns), §11 note;
  `CLAUDE.md` status; runbook mention that `db:seed-admin` is now the
  recovery path for a locked-out admin. Delete this plan after merge.
