# Known ticket failure patterns

Diagnostic reference for recurring causes of `entry_capture_failed` /
`exit_capture_failed` tickets and related Admin UI correction issues. Add a
new section here whenever an incident investigation turns up a pattern
likely to recur, instead of leaving the findings only in chat history.

## Pattern: truck stops before the camera trigger line, weighs, then
## triggers the camera after already leaving the scale

**Symptom:** ticket has `entry_capture_failed = 1` (or the equivalent on
exit), `entry_weight_kg = null`, and the scale's raw event shows
`failureReason: "stability_timeout"` with `waitedMs` close to
`stabilityTimeoutMs * stabilityRetryCount` (3 × 30000 = ~90000ms with
current defaults — see `docs/plans/2026-10-27-scale-capture-reliability-plan.md`).
Other trucks around the same time weigh in normally — the scale itself is
not malfunctioning.

**Root cause:** the automatic flow assumes the truck is still physically on
the scale platform when the camera webhook fires, since the scale read only
starts after the camera event is received (`camera/routes.ts`). If the
driver stops short of the camera's trigger line, finishes weighing, then
pulls forward and *only then* crosses the trigger line, the scale platform
is already empty by the time `scaleClient.readStableWeight()` starts
waiting. With `minValidWeightKg = 500` (default), a near-zero reading from
an empty platform never counts toward stability (`dgn-frame-parser.ts`), so
every retry times out the same way — hence the ~90s of waiting and the
`stability_timeout` failure, even though the truck itself weighed
correctly moments earlier.

**How to confirm during investigation:**
1. Query `tickets` for the plate/ticket in question and check
   `entry_capture_failed`/`exit_capture_failed` and the corresponding
   `*_weight_kg` is `null`.
2. Query `raw_events` (`source = 'scale'`) around that ticket's
   `created_at`/`updated_at` for `failureReason: "stability_timeout"` and a
   `waitedMs` close to the full retry budget (not a partial wait, which
   would suggest a different failure, e.g. a real connection error).
3. Check nearby tickets (same camera, close in time) for normal weight
   captures — this pattern is a one-off per truck, not a systemic scale or
   connectivity issue. A run of consecutive failures across multiple
   trucks points elsewhere (scale-bridge down, COM port issue, relay/TCP
   flapping — check `apps/scale-bridge/service.log`'s `relay-server`
   connect/disconnect entries for that window).
4. There is no per-frame serial log on `scale-bridge` today (it only logs
   `serial port open` once at startup), so raw weight samples during the
   failed window usually aren't recoverable after the fact — this
   diagnosis is inferred from the timing/shape of the failure, not from a
   literal "platform was empty" log line.

**This is a physical/operational issue, not a software defect** — it's
about where the truck stops relative to the camera's trigger line, not a
bug in the stability/retry logic. The fix (if deemed worth it) is on-site:
adjust the trigger line position or driver instructions so the truck is
still on the scale when the camera fires. See the next section for a
secondary issue this pattern exposes: once a ticket like this closes
normally on a successful *exit* read, its entry weight can no longer be
corrected through the Admin UI.

**Example:** ticket #254 (id 259), plate IXI9886, 2026-10-31. Entrance at
09:39:36 local time, `waitedMs: 90010`, `failureReason: "stability_timeout"`;
exit captured normally at 09:46:33 (27,960 kg), auto-closing and
auto-printing the ticket with a blank entry weight and net weight.

## Pattern: "Não foi possível salvar. Tente novamente." when correcting
## entry weight on a ticket that already auto-closed

**Symptom:** in the Admin UI's ticket detail page, editing "Peso de
entrada" and saving fails with a generic error, even though the same form
for "Peso de saída" on the same ticket works. The browser network tab (or
server logs) would show `PATCH /api/admin/tickets/:id/entry` returning
`409 Conflict`, body `"Ticket is not OPEN"`.

**Root cause:** `PATCH /tickets/:id/entry` in
`core-service/src/admin/routes.ts` only allows the edit when
`existing.status === 'OPEN'`:

```ts
if (existing.status !== 'OPEN') {
  reply.code(409).send('Ticket is not OPEN');
  return;
}
```

There is no post-close correction path for the entry leg. Compare this
with `PATCH /tickets/:id/exit`, which explicitly branches between
`repo.close(...)` (status `OPEN`) and `repo.correctExit(...)` (any other
non-`ANOMALY` status) — the exit side supports correcting a leg after the
ticket has already closed; the entry side does not.

This becomes reachable precisely through the pattern above: a ticket whose
**entry** capture failed stays `OPEN` with `entryCaptureFailed: true`
(session-service never closes a ticket on an entry failure). If that same
truck's **exit** read later succeeds normally — which it usually does,
since the camera-trigger-line issue is specific to where the truck
happened to stop on entry, not a general scale problem — `handleExitReading`
closes the ticket via `repo.close()` regardless of whether the entry leg
ever got a weight. `printService.printIfNeeded()` then auto-prints that
`CLOSED` ticket on its own `status === 'CLOSED' && printedAt === null`
check, with no validation that `entryWeightKg`/`netWeightKg` are non-null —
so the ticket prints with a blank entry weight and blank net weight, and
by the time an admin notices and tries to fix the entry weight, the ticket
is already `CLOSED` and the entry-edit endpoint rejects the request.

On the frontend, `EditLegForm` (`admin-ui/src/components/forms/EditLegForm.tsx`)
renders a single static string for any mutation error
(`t('forms.editLeg.error')`, "Não foi possível salvar. Tente novamente."),
regardless of HTTP status or response body — so the operator has no way to
learn it was a 409/"not OPEN" conflict from the UI itself; the real reason
is confirmed by inspecting `raw_events`/`ticket_audit_log` directly or
checking server logs.

**Workaround today:** none through the Admin UI as it stands — the entry
weight on an already-`CLOSED` ticket cannot currently be corrected without
a direct database update. Not attempted here pending a decision on the
proper fix (see below).

**Likely fix, not yet implemented/planned:** give `PATCH /tickets/:id/entry`
a `correctEntry`-style path mirroring `correctExit`'s handling of non-`OPEN`
tickets (recomputing `netWeightKg` afterward), and have `EditLegForm`
surface the actual server error message instead of a generic string. This
would be a non-trivial change under this project's workflow (needs its own
`docs/plans/` entry and step-by-step sign-off) — flagged here for now, not
started.

**Example:** ticket #254 (id 259), plate IXI9886, 2026-10-31 — see the
previous section for the entry-capture-failure timeline. Exit closed the
ticket at 09:46:33; the subsequent attempt to correct the entry weight via
the Admin UI (`/tickets/259`) returned the generic save error because the
ticket was already `CLOSED`.
