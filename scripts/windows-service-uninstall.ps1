<#
.SYNOPSIS
  Removes a Windows service previously installed by
  windows-service-install.ps1. Run as Administrator.

.PARAMETER ServiceName
  The service name passed to windows-service-install.ps1.

.EXAMPLE
  .\scripts\windows-service-uninstall.ps1 -ServiceName EixoLinkScaleBridge
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ServiceName
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    throw "nssm not found on PATH. Install it from https://nssm.cc/ first."
}

& nssm stop $ServiceName
& nssm remove $ServiceName confirm

Write-Host "Service '$ServiceName' removed."
