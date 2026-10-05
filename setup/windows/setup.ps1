# Sets up Body Lab on Windows: a 5:30 AM start, a 9 PM stop, a Desktop shortcut, then starts it.
# -TaskPrefix and -ShortcutName let tests use other names. -Port and -DataRoot are passed through.
# -Demo sets up the made-up demo instead: port 4187, the folder dev\body-lab-demo in your home folder
# (or -DataRoot), a "Body Lab Demo" shortcut and no scheduled tasks. It makes the demo data first if
# the folder has no day notes yet.
param(
  [int]$Port = 4185,
  [string]$DataRoot = '',
  [string]$TaskPrefix = 'Body Lab',
  [string]$ShortcutName = 'Body Lab Dashboard',
  [switch]$Demo,
  [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
if ($Demo) {
  if (-not $PSBoundParameters.ContainsKey('Port')) { $Port = 4187 }
  if (-not $DataRoot) { $DataRoot = Join-Path $env:USERPROFILE 'dev\body-lab-demo' }
  if (-not $PSBoundParameters.ContainsKey('ShortcutName')) { $ShortcutName = 'Body Lab Demo' }
}
function Wait-Close { if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null } }
if ($DataRoot) { $DataRoot = $DataRoot.TrimEnd([char[]]@(92, 47)) }
trap { Write-Host "Setup failed: $_"; Wait-Close; exit 1 }
$AppDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$StartScript = Join-Path $PSScriptRoot 'start.ps1'
$StopScript = Join-Path $PSScriptRoot 'stop.ps1'
$Icon = Join-Path $AppDir 'setup\Body Lab.ico'
. (Join-Path $PSScriptRoot 'node-version.ps1')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Body Lab needs Node.js, and it is not installed.'
  Write-Host 'Install the LTS version from https://nodejs.org, then run this setup again.'
  Wait-Close
  exit 1
}
if (-not (Test-NodeVersion (Get-NodeVersion))) {
  Write-Host $NodeTooOldMessage
  Write-Host 'Nothing was set up. Run this setup again after installing it.'
  Wait-Close
  exit 1
}
$folderName = Split-Path $AppDir -Leaf
if ($folderName -ne 'App') {
  Write-Host "Note: this folder is named '$folderName', not 'App'. Body Lab keeps your notes in the folder above it. Continuing."
}

if ($Demo) {
  # The demo only uses a folder that is missing, empty, or one the demo maker made. Check before
  # anything is made, started or put on the Desktop.
  $maker = Join-Path $AppDir 'tools\make-demo-data.js'
  $global:LASTEXITCODE = 0
  & node $maker $DataRoot --check
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'The demo was not set up. Use an empty folder for -DataRoot, or leave it out to use the usual demo folder.'
    Write-Host 'No shortcut was made and nothing was started.'
    Wait-Close
    exit 1
  }
  $daysDir = Join-Path $DataRoot 'Days'
  if (-not (Get-ChildItem -LiteralPath $daysDir -Filter '*.md' -ErrorAction SilentlyContinue)) {
    Write-Host "Making demo data in $DataRoot..."
    $global:LASTEXITCODE = 0
    & node $maker $DataRoot
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'The demo data could not be made. See the message above.'
      Wait-Close
      exit 1
    }
  }
}

$extra = "-Port $Port"
if ($DataRoot) { $extra += " -DataRoot `"$DataRoot`"" }
# -Demo makes start.ps1 insist on demo data, so the demo shortcut never opens real notes.
if ($Demo) { $extra += ' -Demo' }
$startName = "$TaskPrefix - Start Morning"
$stopName = "$TaskPrefix - Stop 9 PM"
if (-not $Demo) {
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 72)
  # No StartWhenAvailable for the stop: a missed 9 PM stop must not run at the next sign-in and
  # shut Body Lab down just after the morning start.
  $stopSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 72)
  $startAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`" $extra -Scheduled -TaskPrefix `"$TaskPrefix`""
  $stopAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StopScript`" -Port $Port"
  Register-ScheduledTask -TaskName $startName -Action $startAction -Trigger (New-ScheduledTaskTrigger -Daily -At '5:30AM') -Settings $settings -Principal $principal -Force | Out-Null
  Register-ScheduledTask -TaskName $stopName -Action $stopAction -Trigger (New-ScheduledTaskTrigger -Daily -At '9:00PM') -Settings $stopSettings -Principal $principal -Force | Out-Null
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop "$ShortcutName.lnk"
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = 'powershell.exe'
$lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`" -Open $extra"
$lnk.WorkingDirectory = $AppDir
if (Test-Path -LiteralPath $Icon) { $lnk.IconLocation = $Icon }
$lnk.WindowStyle = 7
$lnk.Save()

$global:LASTEXITCODE = 0
& $StartScript -Open -Port $Port -DataRoot $DataRoot -Demo:$Demo
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  if ($Demo) { Write-Host 'The shortcut was created, but the Body Lab demo did not start. See the message above.' }
  else { Write-Host 'The tasks and shortcut were created, but Body Lab did not start. See the message above.' }
  Wait-Close
  exit 1
}

Write-Host ''
if ($Demo) {
  Write-Host 'The Body Lab demo is set up, with made-up data and no scheduled tasks:'
  Write-Host "  - Demo folder: $DataRoot"
} else {
  Write-Host 'Body Lab is set up:'
  Write-Host "  - Task '$startName': every day at 5:30 AM"
  Write-Host "  - Task '$stopName': every day at 9:00 PM"
}
Write-Host "  - Desktop shortcut: $lnkPath"
Write-Host "  - Running now at http://127.0.0.1:$Port"
Wait-Close
