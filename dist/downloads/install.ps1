# goinfra agent installer — InfraCentra (Windows 7+ / Server 2008 R2+ incl. 10/11/Server 2025)
# Usage (elevated PowerShell):
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   $env:GOINFRA_TOKEN='icag_XXXX'; & { iwr https://app.infracentra.com/downloads/goinfra/install.ps1 -useb | iex }
# Or download then run with parameters:
#   .\install.ps1 -Token icag_XXXX -Server https://app.infracentra.com

param(
    [string]$Token = $env:GOINFRA_TOKEN,
    [string]$Server = $(if ($env:GOINFRA_SERVER) { $env:GOINFRA_SERVER } else { 'https://app.infracentra.com' }),
    [string]$Version = $(if ($env:GOINFRA_VERSION) { $env:GOINFRA_VERSION } else { '1.0.0' }),
    [string]$BaseUrl = $(if ($env:GOINFRA_BASE_URL) { $env:GOINFRA_BASE_URL } else { 'https://app.infracentra.com/downloads/goinfra' })
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $Token) { Write-Error "goinfra install: -Token is required (Settings -> Agents -> New API token)"; exit 1 }

# Must be elevated (we write to Program Files + create a scheduled task as SYSTEM)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error "goinfra install: run from an elevated (Administrator) prompt"; exit 1 }

$arch = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { '386' }
$url  = "$BaseUrl/$Version/windows/$arch/goinfra.exe"
$dir  = Join-Path $env:ProgramFiles 'goinfra'
$exe  = Join-Path $dir 'goinfra.exe'
$state = Join-Path $env:ProgramData 'goinfra'

Write-Host "[goinfra] downloading $url"
New-Item -ItemType Directory -Force -Path $dir  | Out-Null
New-Item -ItemType Directory -Force -Path $state | Out-Null
Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing

# Enroll (token goes into $state\enrollment.json, never left in PS history),
# then register the SYSTEM autostart task and start it.
& $exe enroll --server $Server --token $Token --state-dir $state
if ($LASTEXITCODE -ne 0) { Write-Error "goinfra enroll failed ($LASTEXITCODE)"; exit 1 }
& $exe install --state-dir $state
if ($LASTEXITCODE -ne 0) { Write-Error "goinfra install failed ($LASTEXITCODE)"; exit 1 }

Write-Host "[goinfra] installed & enrolled. Verify with: & '$exe' status"
