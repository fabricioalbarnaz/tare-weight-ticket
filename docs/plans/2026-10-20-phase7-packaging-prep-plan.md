# Phase 7 packaging prep — the parts that don't need the definitive PC

Status: **All 5 steps done, verified. Not yet committed — pending user
review.**
Created: 2026-10-20

## Scope

Phase 7 (master plan §9) is "Packaging & per-PC deployment": finalize
docker-compose for production, Windows auto-start configuration,
`.env`-based per-balance config, and a written install runbook for
replicating to the 3 PCs — plus finishing the still-deferred real hardware
integrations (driver-signal relay, printer transport) on-site. The user
asked what can be done now, before the definitive PC is available.

**In scope here** — pure software/packaging work, independent of which
specific Windows PC it eventually runs on:

1. Core Service doesn't actually serve the Admin UI static build yet,
   despite that being the architecture documented in the master plan
   (§2 item 1: "Serves the Admin UI (static build)", repo layout comment).
   `Dockerfile.core-service` never builds or copies `apps/admin-ui`, and
   `app.ts` has no static-file registration. This is a real gap in the
   production path, not a hardware unknown — close it now.
2. `docker/docker-compose.yml` is still the Phase-0 skeleton (one service,
   no restart policy decision applied, no mention that `print-bridge`/
   `scale-bridge` run natively alongside it). Finalize it for production
   per the master plan §7 item 6 decision (`restart: always`, not
   `unless-stopped`, since this must come back up unattended even after an
   explicit stop/crash during a power event).
3. The native apps (`print-bridge`, `scale-bridge`) need to run as Windows
   services so they survive reboot without a logged-in user — the master
   plan's §7 item 2 fallback print-bridge section already names
   [NSSM](https://nssm.cc/) as the intended mechanism. Write the service
   registration scripts/instructions now; they're generic Windows+NSSM
   steps, not tied to a specific machine.
4. Consolidate everything into a per-PC install runbook
   (`docs/runbooks/per-pc-deployment.md`), with hardware-specific values
   (COM port name, camera IPs, relay model/URL, printer) left as explicit
   placeholders to fill in on-site — this is the "replicate to the 3 PCs"
   deliverable from §9, written ahead of having the hardware.

**Explicitly out of scope** (needs the real PC/hardware, do not guess):
driver-signal relay hardware selection, printer transport decision
(`usbipd-win` vs. native fallback — the runbook will note both are still
options), actual COM port/camera IP values, cold-boot/reboot burst
validation (tracked separately in
`docs/plans/2026-10-17-serial-capture-validation-plan.md`).

## Steps

1. **Serve the Admin UI static build from Core Service.**
   - Add `@fastify/static` to `apps/core-service`.
   - `app.ts`: new optional `adminUiDir` in `BuildAppOptions`; when set,
     register `@fastify/static` for it and add a SPA-fallback (`notFound`
     handler serving `index.html`) so React Router's client-side routes
     work on a hard refresh. Registered after the API routes so it never
     shadows `/api`, `/health`, camera, or print routes.
   - `server.ts`: read `ADMIN_UI_DIR` from env (default
     `../admin-ui/dist` relative to the built `dist/server.js`, matching
     where the Dockerfile will place it); omit static serving entirely if
     the directory doesn't exist (keeps `npm run dev` working without
     requiring an admin-ui build first).
   - `Dockerfile.core-service`: add a build stage for `@tare/admin-ui`
     (needs its own `npm ci`/`vite build`) and copy its `dist/` into the
     runtime stage at the path `ADMIN_UI_DIR` expects.
   - Tests: a focused test that `GET /` (or a non-API path) 200s with the
     SPA fallback when `adminUiDir` is set, and that API routes are
     unaffected.
   Status: **done.** `@fastify/static@^8` added to `apps/core-service`;
   `app.ts` takes an optional `adminUiDir`, registers static serving, and a
   `setNotFoundHandler` SPA fallback (GET + not under `/api/` → serve
   `index.html`; everything else → plain JSON 404). `server.ts` computes
   the default (`apps/admin-ui/dist`, sibling to `apps/core-service`,
   resolved relative to the running `dist/server.js`), overridable via
   `ADMIN_UI_DIR`, and only wires it in if `index.html` actually exists
   there (so plain `npm run dev` is unaffected — no admin-ui build
   required). `Dockerfile.core-service` now builds `@tare/admin-ui` with
   `VITE_API_MODE=proxy` pinned at build time (critical: `vite build`
   inlines `import.meta.env.VITE_API_MODE`, and the admin-ui's own default,
   `mock`, would otherwise ship an MSW-fixture-only UI in production — this
   is a real bug that would have shipped silently) and copies its `dist`
   into the runtime stage. 4 new tests in `app.test.ts`. Verified beyond
   typecheck/test: built the actual Docker image and ran it — `GET /`
   serves the real bundled Admin UI (confirmed no MSW/mock wiring in the
   served `index.html`/bundle), a hashed JS asset 200s, `GET /tickets/42`
   (an Admin UI client-side route, not a server route) falls back to
   `index.html`, and `GET /api/does-not-exist` still 404s as plain JSON —
   not swallowed by the SPA fallback.

2. **Finalize `docker/docker-compose.yml` for production.**
   - `restart: always` (per §7 item 6), explicit `env_file` requirement
     (document that `.env` must exist at the install, not just optional
     dev convenience), a comment block noting `print-bridge` and
     `scale-bridge` are intentionally outside this file (native Windows
     processes, see runbook).
   - Add a healthcheck hitting `GET /health` so `docker ps`/Docker Desktop
     surfaces an unhealthy container instead of a silently-stuck one.
   Status: **done.** `restart: always` (per §7 item 6); `env_file` flipped
   to `required: true` — `ADMIN_SESSION_SECRET` has no safe default (see
   below) so a missing `.env` should fail `docker compose up` immediately,
   not crash-loop the container; a comment block documents `print-bridge`/
   `scale-bridge` as intentionally outside this file; a `wget`-based
   healthcheck against `GET /health`. Found and fixed a real bug along the
   way: `ADMIN_SESSION_SECRET` (required, no default — core-service throws
   at startup without it) was undocumented in `.env.example` entirely;
   added it with generation guidance. README's Docker section now says to
   copy `.env.example` first. Verified beyond config validation: built and
   ran the actual compose stack — confirmed `docker compose up` refuses to
   start with no `.env` present (exactly the intended fail-fast), and with
   one present the container reaches Docker's `healthy` state. One bug
   caught by that same run: the first healthcheck attempt used `localhost`,
   which Alpine resolves to `::1` first — the app only listens on `0.0.0.0`
   (IPv4), so wget got a spurious "connection refused" and the container
   never left `starting`. Fixed by pointing the healthcheck at `127.0.0.1`
   explicitly. Test stack and temporary `.env` torn down after verifying.

3. **Windows service registration for the native apps.**
   - A small `scripts/install-windows-service.ps1` (or two, or
     parameterized) using NSSM to register `print-bridge` and
     `scale-bridge` as auto-starting Windows services pointing at
     `node dist/server.js` in each app's folder.
   - Document Docker Desktop's own "start on login"/"start automatically"
     setting as the equivalent mechanism for the containerized side.
   Status: **done.** `scripts/windows-service-install.ps1` (NSSM-backed:
   registers the service, auto-start, auto-restart on crash, rotated log
   file, and an `-EnvVar` passthrough since these apps read `process.env`
   directly with no `.env` loader of their own) and
   `scripts/windows-service-uninstall.ps1`. Verified with a PowerShell
   AST parse (`[System.Management.Automation.Language.Parser]::ParseFile`)
   — syntax-checked without executing; actually registering a service
   needs NSSM, Administrator rights, and a built `dist/server.js`, none of
   which exist on this dev machine, so that part is still on-site work.
   Docker Desktop auto-start documented in step 4's runbook rather than as
   a separate doc (it's one paragraph, not worth a second file).



4. **Write `docs/runbooks/per-pc-deployment.md`.**
   - Prerequisites (Node 24, Docker Desktop w/ WSL2 backend, NSSM).
   - Build/install steps (clone, `npm install`, `npm run build`, Docker
     image build).
   - A `.env` checklist: every value that *must* be customized per PC
     (`SCALE_BRIDGE_COM_PORT`, `SCALE_HOST`/`PORT` if not localhost,
     `DRIVER_SIGNAL_URL_ENTRANCE`/`EXIT`, admin session secret/credentials,
     `DB_PATH`, `PRINT_BRIDGE_OUTPUT_DIR`), each flagged as "placeholder —
     fill in on-site" where it depends on hardware not yet chosen.
   - Windows service registration steps (step 3) and Docker Desktop
     autostart steps.
   - A short verification checklist (health endpoints reachable, admin UI
     loads, test ticket flow) — explicitly not a substitute for the serial
     runbook's on-site validation checklist, which stays open.
   Status: **done.** `docs/runbooks/per-pc-deployment.md`: prerequisites,
   build steps, a `.env` table marking each variable "ready to do now" vs.
   "needs the real machine"/"needs hardware selection first" (including
   that camera entrance/exit push targets are configured on the cameras
   themselves, not in this repo's `.env`), the Windows service
   registration commands from step 3, Docker Desktop auto-start, and a
   verification checklist that explicitly defers to the serial runbook's
   on-site validation checklist rather than duplicating or superseding it.

5. **Final verification pass.**
   - `node:24-alpine` Docker one-liner: build/typecheck/lint/test across
     all workspaces.
   - A real `docker build` + `docker run` smoke test confirming the Admin
     UI's `index.html` is actually served and the SPA fallback works, not
     just that the build succeeds.
   - Update master plan §9 (Phase 7 line) and §11 with what was closed here
     vs. what's still deferred to on-site work.
   Status: **done.** Full root-level `npm install`/`build`/`typecheck`/
   `lint`/`test` (all workspaces, bumped `testTimeout=20000` to rule out
   the pre-existing container first-boot flake) green via the
   `node:24-alpine` one-liner — 24 test files, 193+10+10 tests across
   `core-service`/`print-bridge`/`scale-bridge` plus `shared`/`admin-ui`,
   all passing; lint clean except the same 2 pre-existing admin-ui
   fast-refresh warnings as every prior phase. Master plan §9 (Phase 7
   line) and §11 updated with what this closed vs. what's still deferred
   to on-site work.

## Out of scope for this plan

- Choosing driver-signal relay hardware or the printer transport approach.
- Any COM port, camera IP/hostname, or relay URL real values.
- Cold-boot/reboot serial validation (tracked in the 2026-10-17 plan).
