# Body Lab needs Node 22.13 or newer (node:sqlite). Dot-sourced by setup.ps1 and start.ps1.
$NodeTooOldMessage = 'Body Lab needs Node 22.13 or newer. Install the LTS from https://nodejs.org.'

# True when a "node -v" string such as v24.1.0 is 22.13 or newer.
function Test-NodeVersion([string]$Version) {
  if ($Version -notmatch '^v?(\d+)\.(\d+)') { return $false }
  $major = [int]$Matches[1]
  $minor = [int]$Matches[2]
  return ($major -gt 22 -or ($major -eq 22 -and $minor -ge 13))
}

function Get-NodeVersion {
  try { return [string](& node -v 2>$null) } catch { return '' }
}
