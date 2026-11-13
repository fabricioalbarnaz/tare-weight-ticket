# Sort dashboard/operation ticket lists by last update, not creation

Status: **Done.**
Created: 2026-11-12

## Context

`TicketRepository.listTickets` (`apps/core-service/src/tickets/repository.ts`)
orders results `desc(tickets.id)` — insertion order. Both the Admin UI
dashboard (`DashboardPage.tsx`) and the operator screen (`OperationPage.tsx`)
call `api.listTickets` and render the result directly in `TicketTable`, so
both inherit this ordering.

In practice this means a ticket only ever sorts by when it was first
created (entrance read), never by what happened to it since. An older
open ticket that just got its exit weight, a correction, or a reprint
stays buried below newer tickets instead of surfacing near the top. The
user wants both screens ordered by last update instead, so whichever
ticket just had something happen to it (entrance, exit, admin correction,
print) appears first.

`tickets.updatedAt` already exists and is already maintained on every
mutation (`repository.ts` `create`/`setEntry`/`setExit`/`correctExit`/
`markPrinted`, etc.) and already serialized to the Admin UI
(`admin/serialize.ts`). No schema/migration change, no API contract
change — this is a query-ordering change only.

## Decision

- `listTickets` orders by `desc(tickets.updatedAt)` instead of
  `desc(tickets.id)`, with `desc(tickets.id)` kept as a secondary sort key
  for deterministic ordering when two updates land in the same
  millisecond.
- No frontend change needed — `DashboardPage` and `OperationPage` both
  already just render whatever order the API returns via the shared
  `TicketTable`.
- Existing test `listTickets > paginates and orders results
  most-recent-first` currently only exercises creation order (all three
  tickets created with no further updates); add a second test that
  updates an older ticket and asserts it now sorts first, to actually
  exercise update-order behavior rather than coincidentally passing
  because creation order and update order are the same in that fixture.

## Steps

1. **Code + test** — change the `orderBy` in `listTickets`
   (`apps/core-service/src/tickets/repository.ts`); add the update-order
   test in `repository.test.ts`. Verify via the Alpine Docker
   lint/typecheck/test command (core-service is Docker-authoritative per
   `CLAUDE.md`).
   Status: **done** (Alpine: `tickets/repository.test.ts` 34/34, core-service
   typecheck clean, root lint clean apart from 2 pre-existing unrelated
   `react-refresh` warnings)
