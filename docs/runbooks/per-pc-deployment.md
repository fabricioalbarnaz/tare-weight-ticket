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
- Python 3.x and a C++ build toolchain (Visual Studio Build Tools 2022,
  "Desktop development with C++" workload). Confirmed on-site (2026-10-24):
  `better-sqlite3`'s own `install` script always runs `node-gyp rebuild`
  from source on Windows — it ships prebuilt binaries in its npm package
  but doesn't use them at install time — so without Python/a C++ compiler,
  the root `npm install` fails with "Could not find any Python
  installation to use". `@serialport/bindings-cpp` does resolve its own
  native binary via a bundled prebuild and needs no toolchain on its own,
  but `better-sqlite3` still blocks the same `npm install`.
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
| `SCALE_HOST`/`SCALE_PORT`, `SCALE_BRIDGE_RELAY_PORT` | `SCALE_HOST` must be `host.docker.internal`, **not** `127.0.0.1` — `core-service` runs inside the Docker container, and `127.0.0.1` there is the container's own loopback, not the Windows host where `scale-bridge` actually listens. `host.docker.internal` is Docker Desktop's built-in DNS name for the host on Windows/WSL2 (no `extra_hosts` entry needed). Confirmed on-site 2026-10-24: with `127.0.0.1`, the admin status panel showed the scale as permanently unreachable even with real hardware wired up and `scale-bridge` running. Keep `SCALE_PORT`/`SCALE_BRIDGE_RELAY_PORT` at `9000` unless something else on this PC already uses it. | Ready to do now. |
| `DRIVER_SIGNAL_URL_ENTRANCE`/`EXIT` | **Hardware placeholder.** Relay hardware isn't chosen yet (master plan §7 item 4) — leave unset (no-op) until it is. | Needs hardware selection first. |
| `PRINT_BRIDGE_URL`/`PORT` | `PRINT_BRIDGE_URL` must point at `host.docker.internal`, not `127.0.0.1` — same reason as `SCALE_HOST` above: it's an HTTP call from inside the `core-service` container to a native Windows process. | Ready to do now. |
| `PRINTER_TRANSPORT`/`PRINTER_NETWORK_HOST`/`PRINTER_NETWORK_PORT` | **Hardware placeholder, but check `Get-Printer` first — don't assume USB.** The first on-site PC's printer (2026-10-24) turned out to be a network-attached POS80 thermal printer (`Get-Printer` showed its `PortName` as an IP), not USB — the master plan's §7 item 1 `usbipd-win`-vs-native-fallback question turned out to be moot for this install. If `Get-Printer`/the printer's own admin page shows an IP, use `PRINTER_TRANSPORT=network` with that IP and its raw/JetDirect port (conventionally `9100`, confirm with `Test-NetConnection -ComputerName <ip> -Port 9100`). Only fall back to `PRINTER_TRANSPORT=file` (writes jobs to `PRINT_BRIDGE_OUTPUT_DIR` instead of printing) if no printer is connected yet. These are print-bridge's own env vars (set via the NSSM `-EnvVar` list in step 3 below, not read from this repo's root `.env` by core-service). | Needs the real machine/printer. |
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
  -EnvVar "PRINT_BRIDGE_PORT=4000","PRINTER_TRANSPORT=network","PRINTER_NETWORK_HOST=192.168.29.25","PRINTER_NETWORK_PORT=9100"
```

(the example above uses a network printer per the `PRINTER_TRANSPORT` row
in the `.env` checklist; swap in `-EnvVar "PRINT_BRIDGE_PORT=4000","PRINTER_TRANSPORT=file","PRINT_BRIDGE_OUTPUT_DIR=./print-jobs"`
if no printer is connected on this PC yet.)

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
  if this is a fresh database). **If you seed the admin user while the
  container is already up**, restart the container afterward
  (`docker compose -f docker/docker-compose.yml restart core-service`) —
  confirmed on-site 2026-10-24: the already-running container's SQLite
  connection didn't see the newly-inserted row (login kept 401ing with a
  verified-correct password) until the container was restarted and opened
  a fresh connection, even though both sides use WAL mode. Seeding before
  `docker compose up` avoids this entirely.
- `http://localhost:4100/health` (scale-bridge) and
  `http://localhost:4000/health` (print-bridge, `PRINT_BRIDGE_PORT`) report
  `{"status":"ok"}` once their services are running.
- `GET /api/admin/status` (via the Admin UI's hardware status panel)
  reflects the scale/driver-signal/print connections — expect "not
  reachable" for anything whose hardware placeholder above isn't filled in
  yet.
- A full entrance → exit → print smoke test with the real hardware is
  on-site work, not something this runbook alone verifies. Confirmed
  working end-to-end on the first PC (2026-10-24) with a real scale
  reading and a real physical print through the full system path (camera
  webhook → scale-bridge → core-service → print-bridge → printer) — but
  that is one successful run on one PC, not production sign-off. See the
  serial runbook's still-open validation checklist (cold boot, reboot,
  vendor spec) before treating any install as fully validated.
