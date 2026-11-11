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

## Pattern: exit retry loop outlives the truck and captures the *next*
## truck's weight instead — and the victim can be a stale `OPEN` ticket,
## not a fresh anomaly

**Symptom:** a `CLOSED`, already-printed ticket has an `exit_weight_kg`
that produces an implausible `net_weight_kg` (e.g. a few hundred/thousand
kg for a truck that should net tens of thousands) or simply doesn't match
what the real exit weight should have been. Around the same time, another
truck's entrance appears to go "missing" from the Admin UI's recent-tickets
view — it didn't vanish, but it also didn't create a new ticket row,
because it silently overwrote the entry fields of an **old `OPEN` ticket**
for that same plate instead.

**Root cause:** this is the same underlying race already described in the
2026-10-31 pattern above and in
`docs/plans/2026-10-31-scale-weight-attribution-fix-plan.md` — the scale's
TCP client serializes all reads through a single queue with no check that
the plate behind a given webhook is the truck physically on the platform
when a stable reading finally arrives. What's different (and not covered
by the 2026-10-31 mitigation) is what the *stolen* reading lands on:

1. Truck A's **exit** webhook fires, but A pulls off the platform before 3
   stable samples land. Attempt 1 times out (`stability_timeout`, ~30s).
2. While the connection is torn down/re-established for attempt 2, truck B
   drives onto the now-empty platform for its own **entrance**. Its weight
   is still bouncing (axles settling) when attempt 2's 30s window also
   expires — so *two* full retry cycles (~60s) elapse with no success,
   even though a legitimate truck was present for part of that window.
3. By attempt 3, B's weight has settled. The retry loop — still servicing
   A's exit request — takes it as A's exit weight. A's ticket closes and
   **auto-prints** with a corrupted `net_weight_kg`.
4. ~0.5s later, B's own entrance webhook (which had been queued behind A's
   retries on the same scale client) finally gets its turn, reads the
   platform (already stable, resolves in under 1s) and gets the *same*
   weight A's exit just consumed.
5. If B happens to already have an `OPEN` ticket sitting from an earlier,
   unresolved visit — e.g. from a prior `exit_capture_failed` that was
   never corrected by an admin — the "repeated entrance overwrites an open
   ticket" business rule (intentional for the common misread-plate case;
   see master plan §5) applies here too, with no staleness check. B's new,
   correct physical reading overwrites that old ticket's entry weight/time
   in place. **No new ticket is created**, so there's nothing new to spot
   in a "most recent tickets" view, and the old ticket's original entry
   weight — and whatever was unresolved about its earlier failed exit — is
   gone from the ticket row (still recoverable from `raw_events`/
   `ticket_audit_log`, which are append-only, but no longer reflected in
   `tickets`).

**How to confirm during investigation:**
1. Query `tickets` for the suspect plate/ticket; check `exit_weight_kg` /
   `net_weight_kg` for implausible values versus that truck's own history.
2. Query `ticket_audit_log` for that ticket's `exit_captured` entry —
   `attemptsUsed > 1` (ideally `3`, the full retry budget) and a `payload`
   `weightKg` is the first red flag (this is exactly the signal the
   2026-10-31 fix now surfaces as the amber "suspectWeight" badge in the
   Admin UI dashboard — check there first).
3. Search `raw_events`/`ticket_audit_log` across **all** plates for a
   `camera_entrance` or `camera_exit` row landing within the same
   ~30-90s window with the *same* `weightKg` — that's the other truck that
   actually produced the reading.
4. If that other plate's ticket shows an `entry_overwritten` audit action
   instead of a fresh `entry_captured`, check its `created_at` — if it
   predates the overwrite by hours, this is the stale-`OPEN`-ticket variant
   of the pattern, and the truck's prior unresolved leg (often an earlier
   `exit_capture_failed`) needs separate admin attention, not just the
   weight-attribution fix.

**Real example:** plates MFX8B10 / IRR7J60, 2026-11-07 (server clock,
UTC):

| Time (UTC) | Event | Scale reading | Result |
|---|---|---|---|
| 16:56:26.201 | MFX8B10 entrance | 54,280 kg (1st attempt) | Ticket #475 opened |
| 17:43:50.777 | MFX8B10 exit webhook | — | Starts exit read (req-bk4) |
| 17:43:50 → 17:44:20 | — | 19,500 kg → 0 kg (MFX8B10 driving off) | Never stabilizes |
| 17:44:20.919 | — | — | Attempt 1 times out (`stability_timeout`, 30,001 ms) |
| ~17:44:46 → 17:44:51 | — | 0 → ~53,300 kg, bouncing | IRR7J60 arriving on the platform |
| 17:44:37.457 | IRR7J60 entrance webhook | — | Queued behind req-bk4 on the shared scale client |
| 17:44:50.927 | — | — | Attempt 2 times out too (30,008 ms; weight still unstable) |
| 17:45:24 → 17:45:38 | — | stable ~53,280–53,300 kg | IRR7J60 settled |
| **17:45:38.696** | — | **53,300 kg** (3rd attempt, `attemptsUsed: 3`, 87,778 ms total) | **Ticket #475 (MFX8B10) closes**: `exit_weight_kg = 53,300`, `net_weight_kg = \|54,280 − 53,300\| = 980` — wrong. Auto-printed at 17:45:38.825. |
| 17:45:39.215 | IRR7J60's queued entrance read finally runs | 53,300 kg (`attemptsUsed: 1`, 497 ms — platform already stable) | Ticket **#437** (IRR7J60, `OPEN` since 2026-11-06 18:27:55, with an unresolved `exit_capture_failed` from 19:03:10 the day before) gets `entry_overwritten`: `entry_weight_kg` 54,360 → 53,300, `entry_at` → now. No new ticket created. |

Confirmed via `ticket_audit_log`: #475's `exit_captured` has
`"attemptsUsed":3`; #437's `entry_overwritten` has `"attemptsUsed":1` —
illustrating the gap called out below (the overwritten ticket itself
carries no suspicious signal).

**Core problem:** two independent gaps compound here. (a) the serialized,
plate-blind scale read queue from the 2026-10-31 pattern, which lets a
long-running retry loop for one plate consume another plate's settled
weight; and (b) the "entrance overwrites `OPEN` ticket" rule has no
staleness bound, so a ticket left open for ~23h by an earlier unresolved
failure silently absorbs today's (possibly contaminated) reading with no
visible trace that anything unusual happened — unlike the 2026-10-31
victim (which became a loud `ANOMALY`), this victim looks like an
unremarkable, fast (`attemptsUsed: 1`), successful entrance.

**Fixed (2026-11-10) — gap (a) only:** the scale client now preempts an
in-progress (or queued) read as soon as a camera reading with a different,
readable plate arrives — see master plan §5 "Scale read preemption" and
§11. Replayed against this exact scenario in `camera/routes.test.ts`:
IRR7J60's entrance at 17:44:37 would have stopped MFX8B10's exit retries
immediately (`{ kind: 'reading_preempted' }`, a `raw_events` row flagged
`discarded: 'preempted_by_new_plate'`, no close, no print), and the
53,300 kg reading would have gone only to IRR7J60. Note the trade-off: the
preempted exit leg is discarded, so ticket #475 would have stayed `OPEN`
with no exit — look for that `raw_events` flag when investigating an exit
that "never happened". Gap (b) (stale `OPEN` ticket silently overwritten)
and items 2–3 below are still open.

**Suggested fix (original, partly superseded by the note above):**
1. The existing 2026-10-31 mitigation (`suspectWeight` badge on
   `attemptsUsed > 1`) already would have flagged ticket #475 in the
   dashboard — confirm it's actually visible there is the first, zero-code
   step before anything else.
2. Extend the "suspicious" signal to the *overwrite* side too: flag
   `entry_overwritten` (and `exit`'s equivalent "correct an already-closed
   ticket" path) as suspect whenever the ticket being overwritten was
   `OPEN` for longer than some threshold (e.g. a few hours, reasonable for
   a ~200-truck/day single-shift yard) — today only `attemptsUsed` drives
   the badge, and this path can have `attemptsUsed: 1` while still being
   exactly the kind of event an admin should double-check.
3. Separately, consider surfacing "tickets `OPEN` longer than N hours" as
   its own admin-visible list (it isn't today) — ticket #437 sat open for
   23h with a failed exit and nothing in the Admin UI called that out
   before it got silently overwritten.
4. A deeper structural fix (correlating a scale reading to a specific
   plate by presence-sensor or tighter timestamp proximity, rather than
   FIFO-queue order) remains the same out-of-scope item noted in the
   2026-10-31 plan's "Scope" section — this second occurrence is more
   evidence for revisiting that decision if this keeps recurring.
