# Remove the 7-character length requirement from the plate-reliability check

**Status:** All steps implemented and verified (Alpine Docker: `lint`
clean, `typecheck` clean, `build` clean; `core-service` test run in
isolation 406/407 — the one failure is the pre-existing, already-documented
cold-start `/health` flake, unrelated to this change). A full-monorepo run
in the same pass also surfaced and fixed a real, unrelated test bug: the
plate-misread-deduction feature's `TicketDetailPage` test matched
"RK76F83" ambiguously against both the banner and the audit log's raw
JSON dump — fixed by scoping the assertion to the banner element itself.
Not yet deployed to any production install. **Follow-up (same day, Step
4 below):** `MIN_CONFIDENCE_LEVEL` lowered from 80 to 70 — code and tests
updated, verified via Alpine Docker (`lint` 0 errors, `typecheck` clean,
`build` clean; `core-service` test run in isolation 406/407, the one
failure being the same pre-existing cold-start `/health` flake). Pending
user review before deleting this plan file per `CLAUDE.md`'s workflow.

## Follow-up, same day (Step 4)

After this plan's steps landed, the user also asked to lower
`MIN_CONFIDENCE_LEVEL` itself from 80 to **70** — a further loosening of
the same reliability gate, independent of the length-check removal above.
Done in the same files: `normalize.ts` (constant + doc comment) and
`normalize.test.ts` (boundary tests updated from 80/79 to 70/69). No other
behavior changed; see master plan §11 "Plate-reliability length check
removed" follow-up note and `CLAUDE.md`.

- [x] Step 4 — lower `MIN_CONFIDENCE_LEVEL` to 70 + update boundary tests

## Decision (requested by user, 2026-11-18)

`apps/core-service/src/camera/normalize.ts`'s `isReliablePlateRead` today
requires **both** `confidenceLevel >= 80` **and** the normalized plate
being exactly 7 characters (both Brazilian plate formats) before a camera
read is acted on — anything else (including a truncated or non-standard
read like `XXX1X11Y`, 8 characters) is treated as unreadable (`rawPlate =
''`), no matter how high its confidence.

**New behavior**: drop the length requirement entirely. A read is
reliable whenever `confidenceLevel >= MIN_CONFIDENCE_LEVEL`, regardless of
how many characters the plate has.

**Explicitly unchanged**:
- The confidence threshold itself (`MIN_CONFIDENCE_LEVEL = 80`) — not
  touched by this change.
- The plate-misread deduction match
  (`docs/plans/2026-11-18-plate-misread-deduction-plan.md`,
  `tickets/plate-deduction.ts`) — `findSingleCharDifferenceIndex` already
  returns `null` for different-length strings, so it already tolerates
  non-7-character plates showing up as `OPEN`/`CLOSED` tickets; no code
  change needed there, just fewer reads filtered out before reaching it.
- Everything else `normalizeCameraPayload` does (camera id, timestamp
  parsing, `readQuality` passthrough).

## Risk being accepted (flagged once, per user's explicit request)

The length check exists because of a specific documented finding (master
plan §7 item 3 / §11): a truncated read can carry high *per-character*
confidence despite being wrong, since the camera is confident about the
characters it did see — just not about how many there should have been.
Removing the check means a truncated or garbled read that happens to
score ≥80% overall confidence will now open/close tickets instead of
being withheld as unreadable. No additional guard is being added to
compensate (not requested) — proceeding as scoped above per the user's
explicit decision.

## Steps

### Step 1 — Code change

`apps/core-service/src/camera/normalize.ts`:
- Remove `EXPECTED_PLATE_LENGTH` and the `plate.length === ...` clause
  from `isReliablePlateRead`, leaving only the confidence check.
- Update the doc comment above the constants (currently explains both the
  confidence *and* length rationale) to only describe
  `MIN_CONFIDENCE_LEVEL`, and note the length check was removed
  2026-11-18 (with a pointer to the master plan §11 entry for why).

### Step 2 — Tests

`apps/core-service/src/camera/normalize.test.ts`:
- Remove `'rejects a plate shorter than 7 characters even at high
  confidence'` and `'rejects a plate longer than 7 characters'` from the
  `isReliablePlateRead` describe block; replace with tests asserting a
  short (`'V0694'`) and a long (`'ABC12345'`) plate are now **accepted**
  at or above the confidence threshold.
- `normalizeCameraPayload` describe block: replace `'blanks rawPlate when
  the plate is shorter than expected (likely truncated read)'` with a
  test asserting `rawPlate` is now populated for that same input at high
  confidence.

`apps/core-service/src/camera/routes.test.ts`:
- Replace `'creates no ticket and withholds the driver signal when the
  plate is shorter than expected (likely truncated read)'` (~line 289)
  with a test asserting a short, high-confidence plate now opens a ticket
  normally (`kind: 'ticket_opened'`, driver signaled).

### Step 3 — Docs

- `docs/plans/2026-09-29-tare-weight-ticket-plan.md`:
  - §5 "Entrance camera fires" / wherever plate reliability is described:
    note the length check was removed.
  - §7 item 3 (the original truncated-read finding) and §11: add a dated
    entry reversing it, explaining what changed and why (user request,
    accepted risk, no compensating guard added).
- `CLAUDE.md`: short dated note under "Project status", same style as
  other reversals.

## Verification

Per `CLAUDE.md`'s per-workspace rule: `core-service` only touched here —
verify via the Alpine Docker one-liner (`lint`, `typecheck`, `test`,
`build`).

## Progress

- [x] Step 1 — code change (`normalize.ts`)
- [x] Step 2 — tests (`normalize.test.ts`, `routes.test.ts`)
- [x] Step 3 — docs (master plan §5/§11, `CLAUDE.md`)
