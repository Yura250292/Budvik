# Registers the Budvik 1C sync in Windows Task Scheduler.
#
# Run ONCE from an elevated PowerShell on the 1C server:
#   powershell -ExecutionPolicy Bypass -File install-task.ps1
#
# Three tasks, tiered by cost. The tiers exist because Spravochnik.Nomenklatura
# has no change-date field, so catalogs can only be read in full -- while the
# registers do expose Period, so prices and stock can be read incrementally.
# Reading 20k products every five minutes to catch the rare renamed item would
# be all cost and no benefit.
#
#   BudvikSyncLight   -- every 5 min: prices + stock that moved since last run
#   BudvikSyncHourly  -- hourly: the above plus full catalogs
#   BudvikSyncFull    -- nightly: everything, and the only run that may flag
#                        records missing from 1C (reported, never auto-deleted)
#
# ASCII-only source (see extract.ps1 for why).

[CmdletBinding()]
param(
    [int]    $IntervalMinutes = 5,
    [string] $HourlyAt        = "00:07",
    [string] $FullSyncAt      = "03:30"
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$runner = Join-Path $scriptDir "run-sync.ps1"
if (-not (Test-Path $runner)) { throw "run-sync.ps1 not found next to this script" }

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "Run this from an elevated PowerShell (Run as administrator)."
}

# 64-bit powershell.exe is fine as the task action: run-sync.ps1 shells out to
# the 32-bit host itself, where the 1C COM connector lives.
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Register($name, $trigger, $extraArgs) {
    $action = New-ScheduledTaskAction -Execute $ps `
        -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" + $extraArgs) `
        -WorkingDirectory $scriptDir

    # Battery conditions are the classic reason a scheduled job silently never
    # runs on a machine that reports itself as portable.
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2)

    if (Get-ScheduledTask -TaskName $name -EA 0) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "replaced existing task: $name"
    }

    # Runs as SYSTEM, not as the interactive user.
    #
    # A task registered for a normal account without a stored password only
    # runs while that account is logged on -- so the sync would quietly stop
    # the first time nobody is connected over RDP, which is most of the time
    # on this machine. SYSTEM needs no password and survives reboots.
    #
    # The 1C credentials live in config.json next to the script, so the task
    # does not depend on the interactive user's profile.
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger `
        -Settings $settings -User "SYSTEM" -RunLevel Highest | Out-Null
    Write-Host "registered: $name"
}

# An older single-task install would keep running full extracts every 5 min
# alongside the new tiers, so retire it by name.
if (Get-ScheduledTask -TaskName "BudvikSync" -EA 0) {
    Unregister-ScheduledTask -TaskName "BudvikSync" -Confirm:$false
    Write-Host "removed obsolete task: BudvikSync"
}

$everyN = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
Register "BudvikSyncLight" $everyN " -Scope light"

# Offset from the hour so it does not collide with the light run at :00 and
# lose its turn to the lock.
$hourly = New-ScheduledTaskTrigger -Once -At ([datetime]::Today.Add([timespan]::Parse($HourlyAt))) `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
Register "BudvikSyncHourly" $hourly " -Scope hourly"

$nightly = New-ScheduledTaskTrigger -Daily -At $FullSyncAt
Register "BudvikSyncFull" $nightly " -Scope full"

Write-Host ""
Write-Host "--- registered tasks ---"
Get-ScheduledTask -TaskName "BudvikSync*" |
    Select-Object TaskName, State,
        @{N = "NextRun"; E = { (Get-ScheduledTaskInfo $_.TaskName).NextRunTime } } |
    Format-Table -AutoSize

# SYSTEM has its own profile, so a path that works interactively can still be
# unreadable for the task. Fail loudly here rather than at 03:30.
$cfg = Join-Path $scriptDir "config.json"
if (-not (Test-Path $cfg)) {
    Write-Host "WARNING: config.json not found next to run-sync.ps1 -- tasks will fail" -ForegroundColor Yellow
}
if ($scriptDir -like "\\*") {
    Write-Host "WARNING: scripts live on a UNC path; SYSTEM cannot read network shares." -ForegroundColor Yellow
    Write-Host "         Move them to a local folder such as C:\budvik-agent" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Run now:   Start-ScheduledTask -TaskName BudvikSyncLight"
Write-Host "Check:     Get-ScheduledTaskInfo BudvikSyncLight"
Write-Host "Logs:      $scriptDir\logs\"
