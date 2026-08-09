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
$lockFile = Join-Path $scriptDir ".sync.lock"
if (Test-Path $lockFile) {
    $age = (Get-Date) - (Get-Item $lockFile).LastWriteTime
    if ($age.TotalMinutes -lt 25) {
        Write-Log ("skipped: another run started {0:N0} min ago" -f $age.TotalMinutes)
        exit 0
    }
    Write-Log ("stale lock ({0:N0} min old) ignored" -f $age.TotalMinutes)
}
Set-Content -Path $lockFile -Value (Get-Date).ToString("o") -Encoding ASCII

$ps32 = "C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe"

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
    Write-Log ("FAILED: " + $_.Exception.Message)
    exit 1
}
finally {
    Remove-Item $lockFile -Force -EA 0
}
