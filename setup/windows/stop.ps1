# Asks the running Body Lab server to shut down. -Demo stops the demo on port 4187 instead.
param([int]$Port = 4185, [switch]$Demo)
if ($Demo -and -not $PSBoundParameters.ContainsKey('Port')) { $Port = 4187 }
$Url = "http://127.0.0.1:$Port"
try {
  $page = Invoke-WebRequest -Uri "$Url/" -UseBasicParsing -TimeoutSec 2
} catch {
  Write-Host 'Body Lab is not running.'
  exit 0
}
if ($page.Content -notmatch 'Body Lab') {
  Write-Host "Something other than Body Lab is using port $Port. Nothing was stopped."
  exit 1
}
# The page just answered, so a failure from here on is not "not running".
try {
  Invoke-RestMethod -Uri "$Url/api/shutdown" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null
  Write-Host 'Body Lab stopped.'
} catch {
  if ($_.Exception.Response) {
    Write-Host "Body Lab refused to stop: $($_.Exception.Message)"
  } else {
    Write-Host "Body Lab didn't answer the stop request."
  }
  exit 1
}
