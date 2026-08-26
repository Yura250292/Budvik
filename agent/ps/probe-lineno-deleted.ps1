# Probe: does this 1C build accept PometkaUdaleniya and NomerStroki?
#
# Two columns were added to queries.json on 26.08.2026:
#   - Z.PometkaUdaleniya in ordersSince      -- so a draft order thrown away in
#     1C also disappears from the site (unposted orders now live there);
#   - T.NomerStroki in all three item queries -- so the document card shows the
#     lines in the order the operator typed them.
#
# Both are standard document attributes, but this configuration has surprised
# us before: RegistrNakopleniya.Prodazhi does not exist at all, "KAK V" kills
# Execute with a bare NullReferenceException because V is a reserved word, and
# a filter by reference falls over on this 8.2 build. A rejected column here
# does not raise a readable error either -- Execute() simply returns null.
#
# So this runs the NEW queries verbatim, straight out of queries.json, BEFORE
# extract.ps1 is replaced. Nothing is written to 1C and nothing on disk is
# touched: worst case the probe prints a failure and the agent keeps running
# on the old files.
#
# ASCII ONLY, like every other script here. Windows PowerShell 5.1 reads .ps1
# as the ANSI codepage (CP1251 on this box), so UTF-8 Cyrillic in the source
# turns into mojibake and the file fails to even parse. The Cyrillic that
# matters -- the query text -- lives in queries.json, which is read explicitly
# as UTF-8. That split is the whole reason extract.ps1 is English.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-lineno-deleted.ps1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $QueriesPath,
    # How many days back to read. Three is the ingest rescan window.
    [int]    $Days = 3,
    # How many rows to print per query.
    [int]    $Show = 5
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
if (-not $ConfigPath)  { $ConfigPath  = Join-Path $scriptDir "config.json" }
if (-not $QueriesPath) { $QueriesPath = Join-Path $scriptDir "queries.json" }

function ReadJsonUtf8($path) {
    if (-not (Test-Path $path)) { throw "File not found: $path" }
    $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    return $text | ConvertFrom-Json
}

$config  = ReadJsonUtf8 $ConfigPath
$queries = ReadJsonUtf8 $QueriesPath

Write-Host "queries.json: $QueriesPath"
Write-Host ""

$connString = 'Srvr="' + $config.oneC.server + '";Ref="' + $config.oneC.base +
              '";Usr="' + $config.oneC.user + '";Pwd="' + $config.oneC.password + '";'

$from = (Get-Date).AddDays(-$Days)
$failures = 0

# One failed probe must not hide the rest: after a failed Execute() the COM
# session is poisoned and every later query answers NullReference, so each
# query gets its own connection.
function Probe([string] $name, [string] $text, [int] $newIndex, [string] $newLabel) {
    Write-Host "--- $name ---"
    if (-not $text) {
        Write-Host "  FAILED: query missing from queries.json" -ForegroundColor Red
        $script:failures++
        Write-Host ""
        return
    }
    try {
        $conn = New-Object -ComObject V82.COMConnector
        $link = $conn.Connect($connString)
        $q = $link.NewObject("Query")
        $q.Text = [string]$text
        $q.SetParameter([string]$queries.paramFrom, $from)
        $res = $q.Execute()
        if ($null -eq $res) {
            Write-Host "  FAILED: Execute() returned null -- 1C rejected the query" -ForegroundColor Red
            $script:failures++
            Write-Host ""
            return
        }
        $sel = $res.Choose()
        $n = 0
        while ($sel.Next() -and $n -lt $Show) {
            $value = $sel.Get($newIndex)
            if ($null -eq $value) { $shown = "<null>" } else { $shown = [string]$value }
            Write-Host ("  row {0}: {1} = {2}" -f ($n + 1), $newLabel, $shown)
            $n++
        }
        if ($n -eq 0) {
            Write-Host ("  query ran, but no rows in the last {0} day(s) -- retry with a bigger -Days" -f $Days) -ForegroundColor Yellow
        } else {
            Write-Host "  OK: column reads" -ForegroundColor Green
        }
    } catch {
        Write-Host ("  FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red
        $script:failures++
    }
    Write-Host ""
}

# Column indexes are the ones extract.ps1 will read.
Probe "ordersSince / PometkaUdaleniya"  $queries.ordersSince      8 "PometkaUdaleniya"
Probe "orderItemsSince / NomerStroki"   $queries.orderItemsSince  5 "NomerStroki"
Probe "salesItemsSince / NomerStroki"   $queries.salesItemsSince  5 "NomerStroki"
Probe "returnItemsSince / NomerStroki"  $queries.returnItemsSince 5 "NomerStroki"

Write-Host "=============================="
if ($failures -eq 0) {
    Write-Host "ALL FOUR QUERIES PASSED -- safe to put the new queries.json and extract.ps1 in place" -ForegroundColor Green
} else {
    Write-Host ("FAILURES: {0} -- do NOT replace the agent files, show this output" -f $failures) -ForegroundColor Red
}
