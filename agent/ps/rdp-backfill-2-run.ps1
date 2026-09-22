# Budvik: step 2 of 2 -- the 2024-2025 realization backfill itself.
#
# Does everything docs/1c-backfill-2024.md describes by hand, in one run:
# stops the three BudvikSync tasks, backs up state.json and config.json,
# moves documents.realizationsFrom back, clears the two backfill flags, runs
# one full cycle, then puts the schedule back.
#
# 1C IS ONLY READ. This script changes the AGENT's own settings on this
# server; it sends nothing to 1C but SELECT queries (extract.ps1 does that,
# unchanged). Nothing is written to the 1C database.
#
# NEEDS AN ELEVATED SESSION: without it Get-ScheduledTask returns nothing for
# BudvikSync* and the schedule cannot be stopped -- an hourly run arriving
# mid-backfill would overwrite out\ before send.ps1 gets to it.
#
# Run in PowerShell STARTED AS ADMINISTRATOR:
#   powershell -ep bypass -f \\tsclient\Downloads\budvik-rdp-2-run.ps1
#
# Takes a while (roughly 116k document lines across 2024-2026). Do not close
# the window. Avoid 20:00-20:30 (1C drops sessions) and 03:30 (nightly run).
#
# The schedule is re-enabled in finally{}: even if the cycle dies, the sync
# does not stay switched off.
#
# ASCII-only source (Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI).

param(
    # The date to pull realizations from. 2024-01-01 gives both years.
    [string] $From = "2024-01-01",
    # Set up everything but do not run the cycle -- for a dry look.
    [switch] $WhatIfOnly
)

$ErrorActionPreference = "Continue"

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$share = "\\tsclient\Downloads"
$work = Join-Path $env:USERPROFILE ("budvik-backfill\rdp-2-" + $stamp)
[void](New-Item -ItemType Directory -Force -Path $work)
$summary = Join-Path $work "00-summary.txt"

function Say($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $summary -Value $line -Encoding UTF8
}

Say ("Budvik backfill step 2 -- realizations from " + $From)
Say ("work folder: " + $work)

# ---------------------------------------------------------------- elevation
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Say "STOP: this window is not elevated."
    Say "Close it, open PowerShell with 'Run as administrator', and run the same line again."
    exit 1
}
Say "elevated session: yes"

# ---------------------------------------------------------------- agent folder
$candidates = @(
    "C:\Users\fedyshyn\budvik-agent",
    "C:\budvik-agent",
    (Join-Path $env:USERPROFILE "budvik-agent")
)
$agent = $candidates | Where-Object { Test-Path (Join-Path $_ "run-sync.ps1") } | Select-Object -First 1
if (-not $agent) {
    Say ("STOP: agent folder not found in: " + ($candidates -join "; "))
    exit 1
}
Say ("agent folder: " + $agent)

$configPath = Join-Path $agent "config.json"
$statePath = Join-Path $agent "state.json"
$lockPath = Join-Path $agent ".sync.lock"
foreach ($p in @($configPath, $statePath)) {
    if (-not (Test-Path $p)) { Say ("STOP: missing " + $p); exit 1 }
}

# ---------------------------------------------------------------- lock check
if (Test-Path $lockPath) {
    $age = (Get-Date) - (Get-Item $lockPath).LastWriteTime
    if ($age.TotalMinutes -lt 50) {
        Say ("STOP: a sync is running right now (lock {0:N0} min old). Wait for it and start again." -f $age.TotalMinutes)
        exit 1
    }
    Say ("stale lock ({0:N0} min) -- ignoring" -f $age.TotalMinutes)
}

# ---------------------------------------------------------------- schedule off
$taskNames = @("BudvikSyncLight", "BudvikSyncHourly", "BudvikSyncFull")
$stopped = @()
foreach ($t in $taskNames) {
    try {
        $task = Get-ScheduledTask -TaskName $t -EA Stop
        if ($task.State -ne "Disabled") {
            [void](Disable-ScheduledTask -TaskName $t -EA Stop)
            $stopped += $t
            Say ("task " + $t + ": disabled")
        } else {
            Say ("task " + $t + ": already disabled -- left alone")
        }
    } catch {
        Say ("task " + $t + ": NOT FOUND (" + $_.Exception.Message + ")")
    }
}
if ($stopped.Count -eq 0) {
    Say "WARNING: no task was disabled by this run. If the schedule is live, an hourly run can overwrite out\ mid-backfill."
}

try {
    # ------------------------------------------------------------ backups
    $bakConfig = Join-Path $agent ("config.json.before-backfill-" + $stamp)
    $bakState = Join-Path $agent ("state.json.before-backfill-" + $stamp)
    Copy-Item $configPath $bakConfig -Force
    Copy-Item $statePath $bakState -Force
    Copy-Item $configPath (Join-Path $work "config.before.json") -Force
    Copy-Item $statePath (Join-Path $work "state.before.json") -Force
    Say ("backups: " + (Split-Path $bakConfig -Leaf) + " , " + (Split-Path $bakState -Leaf))

    # ------------------------------------------------------------ config.json
    # Edited as TEXT, not through ConvertTo-Json: the file holds Cyrillic
    # price-type names, and a round trip through the JSON writer would escape
    # or mangle them depending on the console code page.
    $raw = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8)
    $before = [regex]::Match($raw, '"realizationsFrom"\s*:\s*"([^"]*)"')
    if (-not $before.Success) {
        Say "STOP: realizationsFrom not found in config.json -- not touching anything."
        exit 1
    }
    Say ("config realizationsFrom: " + $before.Groups[1].Value + " -> " + $From)
    if ($before.Groups[1].Value -ne $From) {
        # No count argument: the fourth parameter of [regex]::Replace is
        # RegexOptions, not a replacement count -- passing 1 there would mean
        # IgnoreCase. The key occurs once, so replacing all is the same thing.
        $patched = [regex]::Replace($raw, '("realizationsFrom"\s*:\s*")[^"]*(")', ('${1}' + $From + '${2}'))
        [IO.File]::WriteAllText($configPath, $patched, (New-Object Text.UTF8Encoding($false)))
        Say "config.json written"
    } else {
        Say "config.json already holds that date -- left as is"
    }

    # ------------------------------------------------------------ state.json
    # Both flags must go: extract.ps1 reads realizations from the backfill
    # date when EITHER is missing, and cost of sales rides the same window.
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    $had = @()
    foreach ($k in @("realizationsBackfilledAt", "costBackfilledAt")) {
        if ($state.PSObject.Properties.Name -contains $k) {
            $had += $k
            $state.PSObject.Properties.Remove($k)
        }
    }
    if ($had.Count -gt 0) {
        # Written exactly the way send.ps1 writes it: UTF-8 without a BOM
        # through WriteAllText. Set-Content -Encoding UTF8 would add a BOM and
        # leave the agent's own file looking different from ours.
        [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
        Say ("state.json: cleared " + ($had -join ", "))
    } else {
        Say "state.json: both flags already absent"
    }

    if ($WhatIfOnly) {
        Say "WhatIfOnly: stopping before the cycle. Restore the backups if you do not want the new settings."
        exit 0
    }

    # ------------------------------------------------------------ the run
    Say "starting one FULL cycle -- this is the long part, do not close the window"
    $runStarted = Get-Date
    $runSync = Join-Path $agent "run-sync.ps1"
    & powershell.exe -ExecutionPolicy Bypass -File $runSync -Scope full 2>&1 |
        ForEach-Object {
            $s = [string]$_
            Write-Host $s
            Add-Content -Path (Join-Path $work "cycle.log") -Value $s -Encoding UTF8
        }
    $mins = ((Get-Date) - $runStarted).TotalMinutes
    Say ("cycle finished in {0:N1} min" -f $mins)

    # ------------------------------------------------------------ verdict
    $after = Get-Content $statePath -Raw | ConvertFrom-Json
    $names = $after.PSObject.Properties.Name
    $okReal = $names -contains "realizationsBackfilledAt"
    $okCost = $names -contains "costBackfilledAt"
    Say ("flags after run: realizations=" + $okReal + " cost=" + $okCost)
    if ($okReal -and $okCost) {
        Say "OK: backfill reported complete. The agent is back on its normal window."
    } else {
        Say "NOT COMPLETE: at least one flag is still missing -- the send did not finish."
        Say "Nothing is lost: the next manual run repeats the backfill. Send the logs to Claude before retrying."
    }
} finally {
    # ------------------------------------------------------------ schedule on
    # In finally on purpose: a crashed cycle must not leave the exchange off.
    foreach ($t in $stopped) {
        try {
            [void](Enable-ScheduledTask -TaskName $t -EA Stop)
            Say ("task " + $t + ": enabled again")
        } catch {
            Say ("task " + $t + ": COULD NOT ENABLE -- " + $_.Exception.Message)
        }
    }
    try {
        Get-ScheduledTask -TaskName "BudvikSync*" -EA Stop |
            ForEach-Object { Say ("task state: " + $_.TaskName + " = " + $_.State) }
    } catch { }

    # ------------------------------------------------------------ hand-over
    $logDir = Join-Path $agent "logs"
    if (Test-Path $logDir) {
        Get-ChildItem $logDir -Filter "sync-*.log" -EA 0 |
            Sort-Object LastWriteTime -Descending | Select-Object -First 2 |
            ForEach-Object { Copy-Item $_.FullName (Join-Path $work $_.Name) -Force -EA 0 }
    }
    Copy-Item $statePath (Join-Path $work "state.after.json") -Force -EA 0
    Say "1C was only read. Nothing was written to the 1C database."

    $dest = Join-Path $share "budvik-rdp-2"
    try {
        [void](New-Item -ItemType Directory -Force -Path $dest -EA Stop)
        Copy-Item (Join-Path $work "*") $dest -Recurse -Force -EA Stop
        Say ("copied to " + $dest + " -- tell Claude it is done")
    } catch {
        Say ("could not copy to " + $dest + ": " + $_.Exception.Message)
        Say ("results stay in " + $work)
    }
}
