# Probe: the new "expense" channel -- runs EXACTLY the expensesSince and
# expensesSinceMinimal texts from the queries.json lying next to this script,
# before the agent is updated. READ ONLY: SELECT queries only.
#
# Run in 32-bit PowerShell on the 1C server (avoid 20:00-20:30 Kyiv), with the
# NEW queries.json in the same folder (\\tsclient\Downloads):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-expenses-channel.ps1 > \\tsclient\Downloads\probe-expenses-channel.out.txt 2>&1
#
# What it must show, compared with probe-costs.ps1 (05.09.2026): about 8.06M
# UAH over the last 12 months, months 0.48-0.90M, and year totals 2024 ~5.4M,
# 2025 ~7.3M. If the full query fails, the minimal one must still work -- that
# is exactly the fallback the agent takes.
#
# ASCII-only source: the query texts come from queries.json (UTF-8).

$ErrorActionPreference = "Continue"

$candidates = @()
if ($PSScriptRoot) { $candidates += (Join-Path $PSScriptRoot "config.json") }
$candidates += "C:\Users\fedyshyn\budvik-agent\config.json"
$candidates += "C:\budvik-agent\config.json"
$configPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $configPath) { throw "config.json not found in: $($candidates -join '; ')" }
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json

$queriesPath = Join-Path $PSScriptRoot "queries.json"
if (-not (Test-Path $queriesPath)) { throw "queries.json not found next to the probe: $queriesPath" }
$queries = [IO.File]::ReadAllText($queriesPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
if (-not $queries.expensesSince) { throw "queries.json has no expensesSince -- this is the OLD file" }
Write-Host ("config:  " + $configPath)
Write-Host ("queries: " + $queriesPath)

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    [string]$config.oneC.server, [string]$config.oneC.base, [string]$config.oneC.user, [string]$config.oneC.password
$ib = $conn.Connect($cs)
Write-Host ("CONNECTED to " + [string]$config.oneC.base + " -- READ ONLY")
Write-Host ("started " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host ""

$from = New-Object DateTime 2024, 1, 1
$yearAgo = (Get-Date).AddYears(-1)

function Run($label, $text, $cols) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $q = $ib.NewObject("Query")
        $q.Text = [string]$text
        $q.SetParameter([string]$queries.paramFrom, $from)
        $rs = $q.Execute()
        if ($null -eq $rs) { Write-Host ("  -- {0}: Execute returned null" -f $label); return }
        $r = $rs.Choose()
        $n = 0; $sum = 0.0; $sum12 = 0.0
        $byYear = @{}; $byType = @{}; $withPerson = 0; $withComment = 0
        $sample = @()
        while ($r.Next()) {
            $n++
            $amount = [double]$r.Get(6)
            $sum += $amount
            $d = $r.Get(2)
            if ($d -is [datetime]) {
                $y = $d.Year
                $byYear[$y] = [double]($byYear[$y]) + $amount
                if ($d -ge $yearAgo) { $sum12 += $amount }
            }
            $tp = [string]$r.Get(7)
            $byType[$tp] = [int]($byType[$tp]) + 1
            if ($cols -gt 8) {
                try { if ([string]$r.Get(8)) { $withPerson++ } } catch { }
                try { if ([string]$r.Get(9)) { $withComment++ } } catch { }
            }
            if ($n -le 8) {
                $parts = @()
                for ($i = 2; $i -lt $cols; $i++) {
                    $v = $r.Get($i)
                    if ($v -is [datetime]) { $parts += $v.ToString("yyyy-MM-dd") } else { $parts += [string]$v }
                }
                $sample += ("     " + ($parts -join " | "))
            }
        }
        Write-Host ("  OK {0}   rows={1}   {2:N1}s" -f $label, $n, $sw.Elapsed.TotalSeconds)
        Write-Host ("     total since 2024-01-01: {0:N0}" -f $sum)
        Write-Host ("     last 12 months:         {0:N0}   (probe-costs 05.09: ~8 060 000)" -f $sum12)
        foreach ($k in ($byYear.Keys | Sort-Object)) { Write-Host ("     year {0}: {1:N0}" -f $k, $byYear[$k]) }
        foreach ($k in ($byType.Keys | Sort-Object)) { Write-Host ("     doc type {0}: {1} rows  (1 other costs, 2 advance reports, 0 other)" -f $k, $byType[$k]) }
        if ($cols -gt 8) { Write-Host ("     rows with person: {0}   with comment: {1}" -f $withPerson, $withComment) }
        Write-Host "     sample (date | item | group | department | amount | type | ...):"
        $sample | ForEach-Object { Write-Host $_ }
    }
    catch {
        Write-Host ("  -- {0}: {1}" -f $label, $_.Exception.Message)
    }
    Write-Host ""
}

Run "expensesSince (full, 10 columns)" $queries.expensesSince 10
Run "expensesSinceMinimal (8 columns)" $queries.expensesSinceMinimal 8

Write-Host ("finished " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host "Nothing was written to 1C."
