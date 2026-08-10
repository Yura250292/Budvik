# Budvik 1C sync -- one scheduled cycle: extract, then send.
#
# Entry point for Windows Task Scheduler. Keeps a rolling log and never
# leaves a half-written extract behind: send.ps1 refuses to run without a
# manifest, and the manifest is written last.
#
# Register (run once, in an ELEVATED 32-bit PowerShell):
#   .\install-task.ps1
#
# ASCII-only source (see extract.ps1 for why).

[CmdletBinding()]
param(
    # What to read from 1C. See extract.ps1 for the scope definitions.
    [ValidateSet("light", "hourly", "full")]
    [string] $Scope = "light",

    # What to tell the server this run is. Left empty, send.ps1 derives it from
    # the manifest and the preview flag -- which is what the schedule wants.
    [ValidateSet("incremental", "full", "preview")]
    [string] $Kind
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$logDir = Join-Path $scriptDir "logs"
if (-not (Test-Path $logDir)) { [void](New-Item -ItemType Directory -Path $logDir -Force) }
$logFile = Join-Path $logDir ("sync-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

function Write-Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# Keep two weeks of logs: unattended jobs are the ones nobody notices filling
# a disk.
Get-ChildItem $logDir -Filter "sync-*.log" -EA 0 |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Force -EA 0

# A stale lock from a killed run must not block the schedule forever, but two
# concurrent runs share out/ and would double-post batches, so honour a recent
# one. The three schedules deliberately share ONE lock: a light run must wait
# for the nightly full run rather than truncate its output mid-flight.
#
# 25 minutes: a full cycle measured ~100 s, so anything older than this is a
# crash, not a slow run -- and a 5-minute schedule must not stay wedged for an
# hour because one run was killed.
#
# The grace period depends on WHOSE lock it is, not on who is looking. The
# full scope needs a longer one because extract.ps1 retries a lost connection
# there (1C drops sessions around 20:00) and SLEEPS between attempts -- up to
# ~20 minutes on top of the ~100 s of actual work. The lock is stamped once at
# start and never refreshed, so it ages through that sleep.
#
# Judging by the reader's own scope would break the pair that matters: a light
# run arriving at 03:50 would apply its own 25-minute threshold to the nightly
# run's lock, declare it stale and walk into the same out/ directory. So the
# lock file carries the scope that wrote it.
$lockFile = Join-Path $scriptDir ".sync.lock"
if (Test-Path $lockFile) {
    $age = (Get-Date) - (Get-Item $lockFile).LastWriteTime

    # Locks written by the previous version hold a bare timestamp and no
    # scope; treat those as the old 25-minute kind.
    $holder = ""
    try { $holder = ([string](Get-Content $lockFile -Raw -EA 0)).Trim() } catch { }
    $staleAfterMin = 25
    if ($holder -match "(?i)\bfull\b") { $staleAfterMin = 50 }

    if ($age.TotalMinutes -lt $staleAfterMin) {
        Write-Log ("skipped: another run started {0:N0} min ago" -f $age.TotalMinutes)
        exit 0
    }
    Write-Log ("stale lock ({0:N0} min old) ignored" -f $age.TotalMinutes)
}
Set-Content -Path $lockFile -Value ((Get-Date).ToString("o") + " " + $Scope) -Encoding ASCII

# Hard-coded rather than derived from $PSHOME: this script may itself be
# running in either bitness, and the COM connector only exists in the 32-bit
# host. Checked explicitly so a missing host reads as such in the log instead
# of as a bare "command not found".
$ps32 = "C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path $ps32)) {
    Write-Log "FAILED: 32-bit PowerShell not found at $ps32"
    Remove-Item $lockFile -Force -EA 0
    exit 1
}

try {
    Write-Log ("=== cycle start (scope=" + $Scope + ") ===")

    $extract = Join-Path $scriptDir "extract.ps1"
    Write-Log ("extract (scope=" + $Scope + ")...")
    $out = & $ps32 -ExecutionPolicy Bypass -File $extract -Scope $Scope 2>&1
    $out | ForEach-Object { Add-Content -Path $logFile -Value ("    " + $_) -Encoding UTF8 }
    if ($LASTEXITCODE -ne 0) { throw "extract failed with exit code $LASTEXITCODE" }
    Write-Log "extract done"

    $send = Join-Path $scriptDir "send.ps1"
    $args = @("-ExecutionPolicy", "Bypass", "-File", $send)
    if ($Kind) { $args += @("-Kind", $Kind) }
    Write-Log "send..."
    $out = & $ps32 @args 2>&1
    $out | ForEach-Object { Add-Content -Path $logFile -Value ("    " + $_) -Encoding UTF8 }
    if ($LASTEXITCODE -ne 0) { throw "send failed with exit code $LASTEXITCODE" }
    Write-Log "send done"

    Write-Log "=== cycle complete ==="
}
catch {
    $msg = $_.Exception.Message
    Write-Log ("FAILED: " + $msg)

    # Also to the Windows event log. A scheduled job that fails silently at
    # 03:30 is one nobody notices for weeks -- the log file is only read by
    # someone who already suspects a problem, whereas the event log is where
    # monitoring and the admin actually look.
    try {
        $src = "BudvikSync"
        if (-not [Diagnostics.EventLog]::SourceExists($src)) {
            New-EventLog -LogName Application -Source $src -EA Stop
        }
        Write-EventLog -LogName Application -Source $src -EntryType Error `
            -EventId 1001 -Message ("Budvik 1C sync failed (scope=$Scope): " + $msg)
    } catch {
        Write-Log ("(could not write to event log: " + $_.Exception.Message + ")")
    }

    exit 1
}
finally {
    Remove-Item $lockFile -Force -EA 0
}
