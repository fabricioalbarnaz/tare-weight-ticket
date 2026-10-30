# Internal trucks / pre-registered tare ("conjuntos") — Development Plan

Status: **In progress**
Created: 2026-10-27

**Correction (2026-10-28):** §1/§2 below described a conjunto as owned by
one truck (`truck_sets.truckId`, 1:N). The user corrected this with a
photo of the real paper registry in use today: a conjunto is a **shared
type** (e.g. "Vanderleia", "Bitrem Bicaçamba", "LS") that **many trucks**
can be assigned to, and **the tare is a property of the (truck, conjunto)
pair**, not of the conjunto alone — the same conjunto has a different tare
for each truck it's assigned to (e.g. plate JAS-6D83 in the photo: 22860 kg
under "Bitrem Bicaçamba", 22800 kg under "Bitrem Cebolão", 20800 kg under
"Vanderleia" — three different tares for three conjuntos, and other
conjuntos list multiple different plates each). Steps 1/3/4 are reworked
below to a many-to-many model (`conjuntos` shared table +
`truck_conjuntos` join table carrying the pair-specific
`tareWeightKg`/`isActive`); the "only one active conjunto per truck"
rule and the single-event-closes-ticket business rule from §1 are
unchanged.

## 1. Business rule (confirmed with user 2026-10-27)

The company has its own internal trucks. Each one has a pre-registered tare
(empty weight). An internal truck's plate is registered in a new registry;
every camera-read plate is checked against it.

- An internal truck is **never weighed twice** for the same trip. Exactly
  one camera event (entrance **or** exit — whichever one physically fires
  with the truck on the scale) carries the real scale reading. The other
  leg is filled in from the truck's registered tare.
  - Truck leaves empty to go fetch material for the company, returns
    loaded → **entrance** is the real weighing; **exit** weight = tare.
  - Truck picks up material on-site to deliver elsewhere, leaves loaded →
    **exit** is the real weighing; **entrance** weight = tare.
- This is **unconditional and always-on** once the plate is recognized as
  an internal truck — it does not depend on whether the scale read
  succeeded or timed out, and it does not depend on any prior state (no
  "wait for the matching open ticket" — a single event is enough to create
  **and immediately close** a complete ticket).
- A truck can have **N conjuntos**, and a conjunto can be shared by **N
  trucks** (many-to-many) — conjuntos are a shared registry of rig/trailer
  types (e.g. "Vanderleia", "LS", "Bitrem Bicaçamba"), not owned by one
  truck. **The tare is specific to each (truck, conjunto) assignment**,
  since the same trailer type combined with different truck chassis
  weighs differently. **Only one conjunto assignment is active per truck
  at a time**; the truck's current tare = its active assignment's tare.
  Admins need the ability to create conjuntos (shared types), assign an
  existing (or new) conjunto to a truck with that pair's tare, and switch
  which assignment is active per truck.
- This whole flow is independent of the existing external-truck session
  state machine (§5 of the master plan) — internal trucks never sit in
  `OPEN` waiting for a second leg.

Assumption carried into the design below (flag if wrong before step 1
lands): if a truck is registered as internal but currently has **no active
conjunto** (so no known tare), the event is **not** treated as an internal
truck for that read — it falls through to the normal external-truck flow
untouched, and a warning is logged via the existing audit/raw-event
mechanism so an admin notices the misconfiguration. This avoids silently
fabricating a ticket with an unknown weight.

Admin UI scope: a new "Internal trucks" section is added following the
existing Admin UI patterns (same as ticket management) — list/create
trucks, list/create conjuntos per truck, activate a conjunto. If this
should instead be API-only for now, say so before step 3 starts.

## 2. Data model additions

New tables in `apps/core-service/src/db/schema.ts` (+ a Drizzle migration):

`internal_trucks`
| column | notes |
|---|---|
| id | PK |
| plate | normalized plate text, unique |
| label | free text, optional (driver/truck nickname) |
| createdAt / updatedAt | |

`conjuntos` (shared rig/trailer type registry)
| column | notes |
|---|---|
| id | PK |
| name | unique, e.g. "Vanderleia", "Bitrem Bicaçamba", "LS" |
| createdAt / updatedAt | |

`truck_conjuntos` (join table — the actual (truck, conjunto) assignment,
replaces the earlier truck-owned `truck_sets`)
| column | notes |
|---|---|
| id | PK |
| truckId | FK → internal_trucks.id |
| conjuntoId | FK → conjuntos.id |
| tareWeightKg | real, not null — specific to this (truck, conjunto) pair |
| isActive | bool, default false — app logic guarantees at most one `true` per truckId (deactivate the previous one in the same transaction when activating a new one), not a DB constraint, matching this repo's existing style |
| createdAt / updatedAt | |

`ticket_audit_log.action` gains two new values for traceability:
`internal_truck_entry_via_tare`, `internal_truck_exit_via_tare` (payload
includes `truckConjuntoId` and `tareWeightKg` used).

No changes to the `tickets` table itself — an internal-truck ticket is a
normal ticket row (`CLOSED` immediately), just populated from two different
sources instead of two separate camera events. `entryCameraId`/
`exitCameraId` is `null` on whichever leg came from the tare rather than a
real camera event.

## 3. Steps

**Note (2026-10-27): user approved proceeding through all steps without a
stop-and-review checkpoint after each one — will review/commit everything
at the end.** Status markers below are still kept up to date as work
lands, per `CLAUDE.md`.

### Step 1 — Domain core: schema, repository, session-service logic (no routes yet)
**Status: reworked for the many-to-many correction (2026-10-28), see below.**

Original (1:N) version, superseded: `internal_trucks`/`truck_sets`/`truck_audit_log` added to
`src/db/schema.ts` + migration `drizzle/0001_oval_hellfire_club.sql`;
`src/trucks/repository.ts` (`TruckRepository`); `session-service.ts`'s
`handleEntranceReading`/`handleExitReading` check `findActiveTareByPlate`
first and, when found, create+close the ticket in one transaction
(entrance real/exit tare, or entry tare/exit real). New `EntranceResult`
variant `ticket_closed_via_tare`. Unit tests in
`src/trucks/repository.test.ts` and `src/tickets/session-service.test.ts`
cover both directions, a capture-failed real leg, and the
no-active-conjunto fallback.

- Add `internal_trucks` / `truck_sets` to `src/db/schema.ts`, generate the
  Drizzle migration.
- New `src/trucks/repository.ts` (`TruckRepository`): CRUD for trucks and
  truck sets, `findActiveTareByPlate(plate): { truckId, truckSetId,
  tareWeightKg } | undefined`, `activateTruckSet(truckSetId)` (deactivates
  siblings in the same transaction).
- Extend `session-service.ts`: both `handleEntranceReading` and
  `handleExitReading` check `findActiveTareByPlate` first (after plate
  normalization, before the existing open-ticket lookup). If a tare is
  found, run a new code path that creates the ticket and closes it in the
  same transaction (reusing `repo.create` + `repo.close`, both already
  transactional-safe), using the real scale reading for the leg that fired
  and the tare for the other leg, and appends the new audit actions. New
  result variants are needed so callers (Step 2) know to print:
  `EntranceResult` gains `{ kind: 'ticket_closed_via_tare'; ticket }`;
  `ExitResult`'s existing `ticket_closed` is reused (closing-on-exit is
  already its normal meaning).
- Full unit tests for `TruckRepository` (real temp-file SQLite, no mocking
  the DB, matching this repo's existing convention) and for the new
  session-service branches: entrance-real/exit-tare, exit-real/entrance-
  tare, scale capture-failed on the real leg (net stays null, ticket still
  closes), and the "internal truck with no active conjunto falls through
  to normal flow" case.

### Step 1 rework — many-to-many conjuntos (2026-10-28)
**Status: done.** `conjuntos` (shared) + `truck_conjuntos` (join, per-pair
tare) replace `truck_sets` in schema + migration (regenerated clean as
`drizzle/0001_grey_blizzard.sql`, since the original migration was never
applied anywhere real). `TruckRepository` gains conjunto CRUD +
`assignConjuntoToTruck`/`listTruckConjuntos` (joined with the conjunto
name)/`activateTruckConjunto`/`findTruckConjuntoById`. `session-service.ts`
needed no behavioral change (same `findActiveTareByPlate` contract), only
the field rename `truckSetId` → `truckConjuntoId` in its audit payloads.
Tests updated/added in `trucks/repository.test.ts` (including a dedicated
case: the same conjunto assigned to two trucks with different tares),
`tickets/session-service.test.ts`, `camera/routes.test.ts`.

### Step 2 — Wire into camera routes + integration tests
**Status: done.** Entrance handler now also calls `printService.printIfNeeded`
when the result is `ticket_closed_via_tare`. Integration tests added to
`src/camera/routes.test.ts` covering entrance-only and exit-only internal-
truck trips (printed, correct net weight), no anomaly on a tare-covered
exit with no prior entrance, and the no-active-conjunto fallback.

- `src/camera/routes.ts`: the entrance handler must call
  `printService.printIfNeeded` when the result is `ticket_closed_via_tare`
  (mirroring what the exit handler already does for `ticket_closed`).
- Integration tests extending the existing mock-TCP-scale /
  mock-HTTP-camera test setup: full entrance-only and exit-only internal-
  truck trips produce a printed, `CLOSED` ticket with the correct net
  weight on the first and only event.

### Step 3 — Admin backend API
**Status: done, reworked for many-to-many (2026-10-28).** Added
`truck_audit_log` table + `TruckRepository.appendAuditLog`/
`findAuditLogByTruckId`/`transaction`. Routes in `src/admin/routes.ts`:
`GET/POST /api/admin/conjuntos` (shared registry), `GET /api/admin/trucks`,
`GET/POST /api/admin/trucks/:id`, `POST /api/admin/trucks/:id/conjuntos`
(assigns a conjunto — existing `conjuntoId` or inline `conjuntoName` — with
that pair's `tareWeightKg`; 400 if neither is given), `POST
/api/admin/truck-conjuntos/:id/activate`. Same auth/schema/audit-log
pattern as the ticket routes. Confirmed `activateTruckConjunto`'s internal
`db.transaction` nests cleanly inside the route's own `truckRepo.transaction`
(better-sqlite3/drizzle supports nested transactions via savepoints) —
verified by the activation test actually exercising that path. Tests in
`src/admin/routes.test.ts` include assigning the same shared conjunto to
two trucks with different tares each.

- New routes under `/api/admin/trucks` and `/api/admin/trucks/:id/sets` in
  `src/admin/routes.ts` (or a new `src/admin/truck-routes.ts` registered
  alongside it): list/create trucks, create a truck set, activate a truck
  set. Same auth (`requireAuth`), schema validation, and audit-log-in-the-
  same-transaction pattern as the existing ticket admin routes.
- Tests mirroring `src/admin/routes.test.ts`'s existing style.

### Step 4 — Admin UI frontend
**Status: done, reworked for many-to-many (2026-10-28).** Added
`Conjunto`/`TruckConjunto`/`TruckAuditLogEntry`/`TruckDetail` types +
`api/client.ts` calls (`listConjuntos`, `createConjunto`,
`assignConjuntoToTruck`, `activateTruckConjunto`). MSW fixtures now seed a
shared "Vanderleia" conjunto assigned to *two* different trucks with
different tares (20120 kg / 20340 kg) plus "Bitrem Bicaçamba" on one of
them, directly mirroring the photo's real registry. `TruckDetailPage`'s
conjunto form (`AssignConjuntoForm`) is a `<select>` of existing shared
conjuntos with a "+ New conjunto…" option that reveals a name field —
picking an existing one reuses it (and its current tare elsewhere is
untouched; this truck gets its own new tare). i18n strings (en + pt-BR).
Tests updated/added in `InternalTrucksPage.test.tsx`/`TruckDetailPage.test.tsx`
to cover the shared-conjunto scenario.

### Verification (2026-10-28, after the many-to-many rework)

All via the Docker/Alpine container, same as before: `npm run lint` clean
(2 pre-existing warnings); `npm run typecheck` clean for both
`@tare/core-service` and `@tare/admin-ui` (after rebuilding `@tare/shared`
and regenerating the migration); `npm run build` clean for both; full
`vitest run` in `core-service` 236/236 (one `/health` test flaked once on
resource contention, passed clean on isolated re-run — same pre-existing
host-load pattern as before, unrelated to this change); full `vitest run`
in `admin-ui` 18/18 including the two reworked truck pages' test files.
One real test bug was caught and fixed along the way: a dropdown-options
assertion read `<select>.options` before its async conjuntos query
resolved — fixed with `waitFor`. Also fixed a new ESLint
`react-hooks/incompatible-library` warning from `react-hook-form`'s
`watch()` by switching to `useWatch`.

### Verification (2026-10-27, original 1:N version — superseded by the above)

All verification run via the Docker/Alpine container per `CLAUDE.md`
(`node:24-alpine` + `python3 make g++`, after a clean `node_modules` wipe
— the repo had no `node_modules` at all at the start of this session, and
a first native-Windows `npm install` attempt failed on `better-sqlite3`
per the known issue, then got mixed with a container install; wiped and
reinstalled clean inside the container per the documented fix):

- `npm run lint` — clean (2 pre-existing, unrelated `react-refresh` warnings).
- `npm run typecheck --workspace=@tare/core-service` and
  `--workspace=@tare/admin-ui` — clean (after building `@tare/shared` first).
- `npm run build --workspace=@tare/admin-ui` and `@tare/core-service` — clean.
- `vitest run` in `core-service`: 224/230 passed on the first parallel run;
  the 4 misses were all `Hook timed out` in unrelated files' `beforeEach`
  (bcrypt/file-system setup under heavy parallel worker spawn on this
  already-loaded host) — a clean re-run with `--no-file-parallelism`
  passed all 230.
- `vitest run` in `admin-ui`: 10/10 passed on the first parallel run,
  including both new `InternalTrucksPage`/`TruckDetailPage` test files;
  3 unrelated files failed only to *start* a worker (same resource-
  contention pattern, not a test failure) — not re-chased further since
  the new feature's own tests were unaffected and the pattern was already
  confirmed environmental on the core-service side.

- New page(s) under `apps/admin-ui/src/pages/` (e.g. `InternalTrucksPage`)
  plus API client types/calls in `apps/admin-ui/src/api/types.ts` and the
  mock fixtures under `api/mocks/`, following the existing ticket-page
  patterns (forms, mandatory-reason-free since this isn't a correction
  flow, i18n strings added to both `en.json` and `pt-BR.json`).
- Component tests matching the existing `*Page.test.tsx` convention.

### Step 5 — Docs cleanup (after merge)
**Status: not started**

- Add a short implementation-notes entry to the master plan's §11 (data
  model addition, the "no active conjunto → fall through" rule, any
  surprises found while building).
- Delete this plan file, per `CLAUDE.md`'s working-document convention.
