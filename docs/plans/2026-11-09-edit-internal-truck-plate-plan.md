# Edit internal truck plate after creation — Development Plan

Status: **In progress**
Created: 2026-11-09

## 1. Request

Today `internal_trucks.plate` can only be set at creation
(`POST /api/admin/trucks`) — there is no way to fix a plate typo or a plate
change afterward. The user asked to allow editing the plate of an already
registered internal truck from the Admin UI.

## 2. Design

Follows the existing manual-correction pattern already used for ticket
entry/exit edits (master plan §11 "mandatory reason notes" decision,
`EditLegForm`/`PATCH /tickets/:id/entry`): editing a truck's plate requires
a mandatory reason, is one transaction, and is recorded in
`truck_audit_log`.

- New audit action `TRUCK_AUDIT_ACTIONS.PLATE_EDITED` = `'plate_edited'`,
  payload `{ reason, before: { plate }, after: { plate } }` (mirrors
  `ENTRY_EDITED`/`EXIT_EDITED`'s shape).
- New repository method `TruckRepository.updateTruckPlate(truckId, plate):
  InternalTruck`.
- New route `PATCH /api/admin/trucks/:id/plate`, body
  `{ plate: string, reason: string }`. 404 if the truck doesn't exist. 409
  if another truck already has that plate (the column is
  `unique()` — catch and translate the DB constraint violation into a
  clean 409 rather than a 500, matching no existing precedent exactly, so
  add a small `findTruckByPlate` pre-check inside the same transaction
  instead of relying on the DB error).
- Frontend: a new `EditTruckPlateForm` component (same shape as
  `EditLegForm`: plate input + mandatory reason textarea, min 5 chars),
  rendered in `TruckDetailPage`. New `api.editTruckPlate(id, payload)` and
  `EditTruckPlatePayload` type. New audit log label
  `truckAuditLog.actions.plate_edited` in both locales. MSW handler for
  the new PATCH route.

No schema/migration change — `plate` already exists on `internal_trucks`.

## 3. Steps

**Note (2026-11-09): user approved proceeding through all remaining steps
without a stop-and-review checkpoint after each one.**

### Step 1 — Backend: repository + route + tests
**Status: done.** `updateTruckPlate` added to `TruckRepository`;
`editTruckPlateBodySchema`/`EditTruckPlateBody` added to `schemas.ts`;
`PATCH /api/admin/trucks/:id/plate` added to `routes.ts` with a
pre-transaction duplicate-plate check (404/409/200) and a new
`plate_edited` audit action. Verified via the Docker/Alpine container per
`CLAUDE.md` (a stale native-Windows `node_modules` had corrupted the
container's `.bin` shims — `node.exe: not found` — fixed with a clean
wipe + reinstall, matching the documented symptom/fix exactly):
`vitest run src/trucks/repository.test.ts src/admin/routes.test.ts` →
45/45 passed, including the 3 new plate-edit cases (happy path + audit
log, 404, 409 on duplicate plate) and the existing `updateTruckPlate`
repository test.

- `src/trucks/repository.ts`: add `updateTruckPlate(truckId, plate)` to
  the `TruckRepository` interface and implementation (plain `update`,
  bump `updatedAt`, `.returning().get()`).
- `src/admin/schemas.ts`: `editTruckPlateBodySchema` + `EditTruckPlateBody`
  (`{ plate: string (minLength 1), reason: string (minLength 1) }`).
- `src/admin/routes.ts`: `TRUCK_AUDIT_ACTIONS.PLATE_EDITED`; new
  `instance.patch('/trucks/:id/plate', ...)` — 404 if truck missing, 409
  if `findTruckByPlate` resolves to a *different* truck, otherwise update
  + audit log in one `truckRepo.transaction`.
- Tests: `src/trucks/repository.test.ts` (`updateTruckPlate` happy path)
  and `src/admin/routes.test.ts` (success + 404 + 409-on-duplicate-plate +
  audit log entry recorded).

### Step 2 — Frontend: form + client + i18n + tests
**Status: done.** Also added during this step: the route now runs the
edited plate through `normalizePlate` (same as camera reads), otherwise a
plate typed as `abc-1234` would never match `findActiveTareByPlate`; 400
if it normalizes to empty; extra route test. Verification (Alpine
container): typecheck clean; admin-ui 31/31; core-service 301/302 with
the known flaky `/health` timeout passing 5/5 on isolated re-run; build
clean. `npm run lint` has 7 errors, all in
`print-bridge/scripts/generate-logo-bitmap.mjs` (from the prior logo
commit; nothing to do with this change).

- `api/types.ts`: `EditTruckPlatePayload { plate: string; reason: string }`.
- `api/client.ts`: `editTruckPlate(id, payload)` → `PATCH /trucks/:id/plate`.
- New `components/forms/EditTruckPlateForm.tsx`, same validation/UX shape
  as `EditLegForm.tsx`.
- `pages/TruckDetailPage.tsx`: render the new form in a section above/below
  the conjunto ones.
- i18n: `forms.editTruckPlate.*` + `truckAuditLog.actions.plate_edited` in
  both `en.json` and `pt-BR.json`.
- `api/mocks/handlers.ts`: PATCH handler updating the in-memory truck and
  appending a `truckAuditLog` entry, 409 on duplicate plate.
- Tests: extend `TruckDetailPage.test.tsx` with a successful edit and a
  duplicate-plate error case.

### Step 2b — Follow-ups requested by the user
**Status: done.** `POST /trucks` now normalizes the plate too (400 if
empty, 409 on duplicate instead of a 500 from the unique constraint;
`CreateTruckForm` shows a duplicate message), with 3 route tests.
`eslint.config.js` declares Node globals for `**/*.{js,mjs,cjs}`, which
fixes the 7 `no-undef` errors in `generate-logo-bitmap.mjs`. Lint: 0
errors. core-service 304/305 (only the known flaky `/health` timeout);
admin-ui 31/31.

### Step 3 — Docs cleanup (after merge)
**Status: not started**

- Delete this plan file per `CLAUDE.md`'s working-document convention.
