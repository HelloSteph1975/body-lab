# Starts the Body Lab server (hidden) if it is not already running.
# -Open also opens the app window. -Port and -DataRoot are passed to the server.
# -Demo starts the made-up demo: port 4187 and dev\body-lab-demo in your home folder, unless -Port or -DataRoot say otherwise.
# -Scheduled is for the morning task: outside the start and stop tasks' times it exits quietly and
# starts nothing. -TaskPrefix names those tasks, as setup.ps1 did.
# A running Body Lab is only reused if it shows the right kind of data: the demo for -Demo, real notes otherwise.
param(
  [switch]$Open,
  [int]$Port = 4185,
  [string]$DataRoot = '',
  [switch]$Demo,
  [switch]$Scheduled,
  [string]$TaskPrefix = 'Body Lab'
)
$ErrorActionPreference = 'Stop'
# The shortcut and the scheduled task run this hidden, so it never waits for a key.
function Stop-WithError([string]$Message) {
  Write-Host $Message
  exit 1
}
trap { Stop-WithError "Body Lab could not start: $_" }
if ($Demo) {
  if (-not $PSBoundParameters.ContainsKey('Port')) { $Port = 4187 }
  if (-not $DataRoot) { $DataRoot = Join-Path $env:USERPROFILE 'dev\body-lab-demo' }
}
. (Join-Path $PSScriptRoot 'node-version.ps1')
. (Join-Path $PSScriptRoot 'start-window.ps1')
if ($Scheduled -and -not (Test-ScheduledStartAllowed (Get-Date) $TaskPrefix)) { exit 0 }
$AppDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$Url = "http://127.0.0.1:$Port"

# Returns 'up' (Body Lab answers), 'other' (something else answers) or 'down'.
function Get-PortState {
  try {
    $r = Invoke-WebRequest -Uri "$Url/" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200 -and $r.Content -match 'Body Lab') { return 'up' }
    return 'other'
  } catch { return 'down' }
}
function Test-Up { return ((Get-PortState) -eq 'up') }

# Returns 'demo', 'real' or 'unknown', from the server's GET /api/info.
function Get-DataKind {
  try {
    $info = Invoke-RestMethod -Uri "$Url/api/info" -TimeoutSec 2
    if ($info.demo -eq $true) { return 'demo' }
    if ($info.demo -eq $false) { return 'real' }
  } catch {}
  return 'unknown'
}

function Get-RegisteredPath($key) {
  $v = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).'(default)'
  if ($v) { return $v }
  return $null
}

# Chrome first (registry, then standard folders), then Edge.
function Find-Browser {
  $candidates = @(
    (Get-RegisteredPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'),
    (Get-RegisteredPath 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'),
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    (Get-RegisteredPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe'),
    (Get-RegisteredPath 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe'),
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}

if ((Get-PortState) -eq 'other') {
  Stop-WithError "Something else is already using port $Port, so Body Lab can't start there."
}
if (-not (Test-Up)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Stop-WithError 'Node.js was not found. Install it from https://nodejs.org and try again.'
  }
  if (-not (Test-NodeVersion (Get-NodeVersion))) { Stop-WithError $NodeTooOldMessage }
  $env:BODYLAB_PORT = "$Port"
  if ($DataRoot) { $env:BODYLAB_ROOT = $DataRoot }
  Start-Process -FilePath $node.Source -ArgumentList 'server.js' -WorkingDirectory $AppDir -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(5)
  while (-not (Test-Up) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
}

if (-not (Test-Up)) {
  Stop-WithError "Body Lab did not start on port $Port."
}

# Never show real notes as the demo, or the demo as your notes.
$kind = Get-DataKind
if ($Demo -and $kind -ne 'demo') {
  if ($kind -eq 'real') { Stop-WithError "Port $Port is running Body Lab with real notes, not the demo. Stop it first, or give the demo another port with -Port." }
  Stop-WithError "Something on port $Port answers as Body Lab but didn't say it holds the demo. Stop it and try again."
}
if (-not $Demo -and $kind -ne 'real') {
  if ($kind -eq 'demo') { Stop-WithError "Port $Port is running the Body Lab demo, not your own notes. Stop the demo first." }
  Stop-WithError "Something on port $Port answers as Body Lab but didn't say whose notes it has. Stop it and try again."
}

if ($Open) {
  $browser = Find-Browser
  if ($browser) {
    Start-Process -FilePath $browser -ArgumentList "--app=$Url"
  } else {
    Write-Host "No Chrome or Edge found. Open $Url in any browser."
  }
}
