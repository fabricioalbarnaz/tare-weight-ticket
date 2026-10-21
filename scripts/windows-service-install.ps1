<#
.SYNOPSIS
  Registers one of the native EixoLink apps (print-bridge, scale-bridge) as
  an auto-starting Windows service via NSSM (https://nssm.cc/), so it comes
  back up after a reboot with no user logged in. Run as Administrator.

  These apps are intentionally kept outside Docker (USB/COM-port access
  from a container is unreliable on Windows) — see CLAUDE.md and
  docs/runbooks/per-pc-deployment.md.

.PARAMETER ServiceName
  Windows service name to create, e.g. EixoLinkScaleBridge.

.PARAMETER AppPath
  Path to the app's folder (e.g. apps\scale-bridge), relative to the repo
  root or absolute. Must already contain a built dist\server.js — run
  `npm run build --workspace=<package>` first.

.PARAMETER EnvVar
  Zero or more NAME=value pairs the service needs (these apps read
  process.env directly, with no .env file loader of their own) — e.g.
  SCALE_BRIDGE_COM_PORT, SCALE_BRIDGE_RELAY_PORT. Values containing
  hardware specifics (COM port, IPs) are the install's responsibility to
  fill in; nothing here guesses at them.

.EXAMPLE
  .\scripts\windows-service-install.ps1 -ServiceName EixoLinkScaleBridge `
    -AppPath apps\scale-bridge `
    -EnvVar "SCALE_BRIDGE_COM_PORT=COM3","SCALE_BRIDGE_BAUD_RATE=9600","SCALE_BRIDGE_RELAY_PORT=9000","SCALE_BRIDGE_HEALTH_PORT=4100"

.EXAMPLE
  .\scripts\windows-service-install.ps1 -ServiceName EixoLinkPrintBridge `
    -AppPath apps\print-bridge `
    -EnvVar "PRINT_BRIDGE_PORT=4000","PRINT_BRIDGE_OUTPUT_DIR=./print-jobs"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ServiceName,

    [Parameter(Mandatory = $true)]
    [string]$AppPath,

    [string]$EntryPoint = "dist\server.js",

    [string[]]$EnvVar = @()
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    throw "nssm not found on PATH. Install it from https://nssm.cc/ first."
}

$node = (Get-Command node -ErrorAction Stop).Source
$appDir = (Resolve-Path $AppPath).Path
$entry = Join-Path $appDir $EntryPoint

if (-not (Test-Path $entry)) {
    throw "$entry not found - run 'npm run build --workspace=<package>' for this app before installing the service."
}

& nssm install $ServiceName $node "`"$entry`""
& nssm set $ServiceName AppDirectory $appDir
& nssm set $ServiceName Start SERVICE_AUTO_START
& nssm set $ServiceName AppStdout (Join-Path $appDir "service.log")
& nssm set $ServiceName AppStderr (Join-Path $appDir "service.log")
& nssm set $ServiceName AppRotateFiles 1
& nssm set $ServiceName AppRotateBytes 10485760
# AppExit Default Restart: come back up after a crash too, not just reboot.
& nssm set $ServiceName AppExit Default Restart

if ($EnvVar.Count -gt 0) {
    & nssm set $ServiceName AppEnvironmentExtra @EnvVar
}

Write-Host "Service '$ServiceName' installed (auto-start, auto-restart on crash)."
Write-Host "Start it now with: nssm start $ServiceName"
Write-Host "Logs at: $(Join-Path $appDir 'service.log')"
