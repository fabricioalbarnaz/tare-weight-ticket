# Per-PC deployment runbook

Status: first version, written **before** the definitive PC/hardware are
available (2026-10-20) — see
`docs/plans/2026-09-29-tare-weight-ticket-plan.md` §9 Phase 7. Everything
here that doesn't depend on the actual machine or hardware is ready to
follow as-is; everything that does is called out explicitly as a
placeholder to fill in on-site. This is **not** a substitute for the
Isis New serial on-site validation checklist in
`docs/runbooks/isis-new-serial-setup.md` (cold boot, reboot, known-good
adapter, vendor spec) — that stays open regardless of this runbook.

One instance of this runbook is followed per physical scale/PC (3 PCs
total per the master plan).

## Prerequisites

- Windows 10/11, with Docker Desktop installed and its WSL2 backend
  enabled (not Hyper-V/Windows containers — nothing here needs Windows-
  native APIs inside the container).
- Node.js 24 (see the repo's `.nvmrc`) — needed to build `print-bridge`
  and `scale-bridge`, which run natively, outside Docker.
- [NSSM](https://nssm.cc/) on `PATH` — used to register `print-bridge`
  and `scale-bridge` as Windows services (see below). Not needed to run
  `core-service`, which is containerized.
- A USB-RS-232 adapter wired to the Digi-Tron Isis New indicator, and the
  entrance/exit cameras and driver-signal relay reachable on the same
  network as this PC — **hardware placeholders**, see the checklist below.

## 1. Build

From the repo root:

```
npm install
npm run build
```

This builds every workspace, including `apps/print-bridge` and
`apps/scale-bridge`'s `dist/server.js` (needed before step 3) and
`apps/admin-ui` (needed before step 2, since `core-service`'s Docker image
builds it itself — this local build is only required for the native apps).

## 2. Configure `.env` and start Core Service (Docker)

```
cp .env.example .env
```

Then edit `.env`. The table below is every variable that needs a decision
at install time — see `.env.example` itself for the full inline rationale
behind each one.

| Variable | Per-PC decision needed | Status |
|---|---|---|
| `ADMIN_SESSION_SECRET` | Generate a fresh random value (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Never reuse the placeholder or share one across PCs. | Ready to do now. |
| `PORT` | Keep `3000` unless something else on this PC already uses it. | Ready to do now. |
| `DB_PATH` | Default (`/app/data/tare.sqlite` inside the container, bind-mounted from `../data`) is fine for a single-PC install. | Ready to do now. |
| `SCALE_BRIDGE_COM_PORT` | **Hardware placeholder.** The Windows COM port the USB-RS-232 adapter enumerates as (check Device Manager). `docs/runbooks/isis-new-serial-setup.md` saw `COM3`, but that's specific to the adapter/port used during diagnostics — confirm on this PC. | Needs the real machine. |
| `SCALE_BRIDGE_BAUD_RATE` | `9600` confirmed by the serial runbook for the Isis New's DGN protocol — leave as-is unless a different indicator model is used. | Ready to do now (pending vendor confirmation per the serial runbook). |
| `SCALE_HOST`/`SCALE_PORT`, `SCALE_BRIDGE_RELAY_PORT` | Keep the defaults (`127.0.0.1:9000`) unless `core-service` and `scale-bridge` run on different machines (not the documented topology — both run on the same per-balance PC). `SCALE_BRIDGE_RELAY_PORT` must match `SCALE_PORT`. | Ready to do now. |
| `DRIVER_SIGNAL_URL_ENTRANCE`/`EXIT` | **Hardware placeholder.** Relay hardware isn't chosen yet (master plan §7 item 4) — leave unset (no-op) until it is. | Needs hardware selection first. |
| `PRINT_BRIDGE_URL`/`PORT`/`OUTPUT_DIR` | Defaults are fine; `OUTPUT_DIR` only matters while the print bridge still writes jobs to a file instead of a real printer (master plan §7 item 1, unresolved `usbipd-win` vs. native-fallback spike). | Ready to do now, revisit once printer hardware/approach is chosen. |
| Camera entrance/exit push targets | **Not an `.env` variable** — configured on each camera's own admin interface, pointing at this PC's `http://<pc-ip>:3000/webhooks/camera/entrance` / `/exit`. **Hardware placeholder**: needs the cameras' real IPs/admin access. | Needs the real machine/network. |

Then:

```
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d
```

`docker compose ... up` refuses to start if `.env` is missing, and the
container reports Docker-native `healthy`/`unhealthy` via `GET /health`
(see `docker/docker-compose.yml`).

## 3. Register the native apps as Windows services

`print-bridge` and `scale-bridge` are native Windows processes (USB/COM-
port access from a container is unreliable on Windows — see CLAUDE.md).
They need to run as Windows services to survive a reboot without a
logged-in user. `scripts/windows-service-install.ps1` wraps NSSM for this
(run an elevated/Administrator PowerShell):

```powershell
.\scripts\windows-service-install.ps1 -ServiceName EixoLinkScaleBridge `
  -AppPath apps\scale-bridge `
  -EnvVar "SCALE_BRIDGE_COM_PORT=COM3","SCALE_BRIDGE_BAUD_RATE=9600","SCALE_BRIDGE_RELAY_PORT=9000","SCALE_BRIDGE_HEALTH_PORT=4100"

.\scripts\windows-service-install.ps1 -ServiceName EixoLinkPrintBridge `
  -AppPath apps\print-bridge `
  -EnvVar "PRINT_BRIDGE_PORT=4000","PRINT_BRIDGE_OUTPUT_DIR=./print-jobs"
```

Replace the `SCALE_BRIDGE_COM_PORT` value with the real COM port from the
`.env` checklist above. These apps read `process.env` directly (no `.env`
file loader of their own), so every value they need must be passed via
`-EnvVar` here, matching what `core-service`'s `.env` expects on the other
side of the TCP relay/print HTTP call.

Each service auto-starts on boot and auto-restarts if the process crashes
(`AppExit Default Restart`). Logs land at `service.log` inside each app's
folder. To remove a service later: `.\scripts\windows-service-uninstall.ps1 -ServiceName <name>`.

## 4. Docker Desktop auto-start

So `core-service` comes back up after a reboot with no one logged in:

- Docker Desktop Settings → **General** → enable "Start Docker Desktop
  when you sign in to Windows."
- Docker Desktop Settings → **General** → enable "Start containers on
  Docker startup" if present in the installed version (behavior otherwise
  covered by `restart: always` in `docker-compose.yml`, which brings the
  container back up once the Docker Engine is running again, including
  after a Windows auto-login with no interactive session).
- If this PC has no auto-login configured, Docker Desktop won't start
  until someone signs in — **decide and document the sign-in behavior for
  this specific PC on-site**; it's a Windows account/security decision,
  not something this repo can set.

## 5. Verify

- `http://localhost:3000/health` → `{"status":"ok"}`.
- `http://localhost:3000/` → the Admin UI loads and can log in (seed an
  admin user first via `npm run db:seed-admin --workspace=@tare/core-service`
  if this is a fresh database).
- `http://localhost:4100/health` (scale-bridge) and
  `http://localhost:4000/health` (print-bridge, `PRINT_BRIDGE_PORT`) report
  `{"status":"ok"}` once their services are running.
- `GET /api/admin/status` (via the Admin UI's hardware status panel)
  reflects the scale/driver-signal/print connections — expect "not
  reachable" for anything whose hardware placeholder above isn't filled in
  yet.
- A full entrance → exit → print smoke test with the real hardware is
  on-site work, not something this runbook alone verifies — see the
  serial runbook's still-open validation checklist before treating any of
  this as production sign-off.
