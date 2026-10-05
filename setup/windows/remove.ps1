# Removes the Body Lab scheduled tasks and Desktop shortcut. Your notes are not touched.
# -Demo removes only the "Body Lab Demo" shortcut; the demo has no tasks.
param(
  [string]$TaskPrefix = 'Body Lab',
  [string]$ShortcutName = 'Body Lab Dashboard',
  [switch]$Demo,
  [switch]$NoPause
)
trap { Write-Host "Remove failed: $_"; if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }; exit 1 }
if ($Demo) {
  if (-not $PSBoundParameters.ContainsKey('ShortcutName')) { $ShortcutName = 'Body Lab Demo' }
} else {
  foreach ($n in @("$TaskPrefix - Start Morning", "$TaskPrefix - Stop 9 PM")) {
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $n -Confirm:$false
      Write-Host "Removed task '$n'."
    }
  }
}
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$ShortcutName.lnk"
if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force; Write-Host "Removed $lnk." }
Write-Host 'Done. Your notes were left alone.'
if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
