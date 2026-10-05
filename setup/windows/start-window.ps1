# The scheduled start only runs Body Lab between the start task's time and the stop task's time.
# A start missed in the morning can run later, at the next sign-in; after the stop time it should
# not start Body Lab for the night. The times come from the two tasks, so changes made in Task
# Scheduler are followed. Dot-sourced by start.ps1.

# True when $Now is at or after $Start and before $Stop. A stop earlier than the start is an
# overnight window (for example 10 PM to 4 AM): true at or after the start, or before the stop.
# Equal times make an empty window, which is never true, so the start is skipped.
function Test-InStartWindow([datetime]$Now, [timespan]$Start, [timespan]$Stop) {
  $t = $Now.TimeOfDay
  if ($Stop -eq $Start) { return $false }
  if ($Stop -gt $Start) { return ($t -ge $Start -and $t -lt $Stop) }
  return ($t -ge $Start -or $t -lt $Stop)
}

# The clock time of a task's daily trigger, as Task Scheduler shows it, or $null if it can't be read.
function Get-TaskTime([string]$TaskName) {
  try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    foreach ($trigger in @($task.Triggers)) {
      if ($trigger.CimClass.CimClassName -eq 'MSFT_TaskDailyTrigger' -and $trigger.StartBoundary -match 'T(\d{2}):(\d{2})') {
        return New-TimeSpan -Hours ([int]$Matches[1]) -Minutes ([int]$Matches[2])
      }
    }
  } catch {}
  return $null
}

# Whether a scheduled start may run now. If either task can't be read, the scheduled start does
# nothing: guessing a time could start Body Lab at the wrong hour. The Desktop shortcut still
# starts it any time.
function Test-ScheduledStartAllowed([datetime]$Now, [string]$TaskPrefix) {
  $start = Get-TaskTime "$TaskPrefix - Start Morning"
  $stop = Get-TaskTime "$TaskPrefix - Stop 9 PM"
  if ($null -eq $start -or $null -eq $stop) { return $false }
  return (Test-InStartWindow $Now $start $stop)
}
