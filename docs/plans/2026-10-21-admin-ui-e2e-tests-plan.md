# Admin UI Playwright smoke tests

Status: all 4 steps done. Not yet committed — pending user review.
Created: 2026-10-21

## Scope

Master plan §8 ("Testing strategy") calls for "a handful of Playwright
smoke tests for the critical manual-fix flow (edit weight → audit log
entry appears → reprint works) — kept minimal, not exhaustive E2E
coverage." `apps/admin-ui` already has `playwright.config.ts` and the
`test:e2e` script, but no `.spec.ts` files exist yet and CI never runs
`test:e2e` — this closes that gap. Runs against the existing MSW mock
fixtures (same as local dev's default `VITE_API_MODE=mock`), per the
plan's own "kept minimal" framing — no real backend needed.

Prioritized now (over Phase 8 hardening items) per the user: first
on-site deployment tests happen this week, so work goes to what's needed
for the system to run, not improvements that can wait.

## Steps

1. Write `apps/admin-ui/e2e/manual-correction.spec.ts`: login, search the
   dashboard for a known closed ticket, edit its exit weight (asserting
   the audit log gains a `manual_edit` entry), then reprint it (asserting
   the audit log gains a `reprint` entry). A second, smaller spec for the
   invalid-credentials rejection path (basic auth-gate smoke check).
   Status: **done** — both tests pass locally.
2. Install the Playwright browser binary locally (`playwright install
   chromium`) and actually run `npm run test:e2e --workspace=@tare/admin-ui`
   — not just typecheck/lint — since Playwright needs a real browser and
   can't run inside the `node:24-alpine` container (no Chromium build for
   musl/Alpine).
   Status: **done.** Found along the way: a native (non-container) `npm
   install` on this Windows machine now actually works — it previously
   didn't (CLAUDE.md's documented reason was no Python/node-gyp toolchain
   for `better-sqlite3`), but `better-sqlite3`/`@serialport/bindings-cpp`
   both resolved via prebuilt binaries without compiling, and Windows
   `.cmd`/`.ps1` bin shims got generated correctly. This is worth the user
   re-checking (see final report) since it could simplify the documented
   Docker-only verification workflow — not changed here without
   confirming with the user first. **Side effect caught and fixed**:
   that local install rewrote `node_modules/.bin/*` shims to target
   Windows' `node.exe`, which then broke the very next container-based
   `npm run build`/`typecheck`/`lint` (`node.exe: not found` inside
   Alpine) — fixed by deleting all `node_modules` and reinstalling clean
   inside the container, restoring the documented workflow's consistency.
3. Wire `test:e2e` into `.github/workflows/ci.yml` (install the browser,
   run the suite) so this doesn't silently rot the way it did before.
   Status: **done.**
4. Update master plan §8 to note the tests now exist.
   Status: **done.**

## Out of scope

- Exhaustive E2E coverage of every page/flow — §8 explicitly asks for a
  minimal smoke test, not full coverage.
- Running against a real backend (`VITE_API_MODE=proxy`) — the mock
  fixtures are enough for this smoke-test tier per §8.
