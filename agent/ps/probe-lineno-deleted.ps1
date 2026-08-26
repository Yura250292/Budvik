# Probe: does this 1C build accept ПометкаУдаления and НомерСтроки?
#
# Two columns were added to queries.json on 26.08.2026:
#   - З.ПометкаУдаления in ordersSince      -- so a draft order thrown away in
#     1C also disappears from the site (unposted orders now live there);
#   - Т.НомерСтроки in all three item queries -- so the document card shows the
#     lines in the order the operator typed them.
#
# Both are standard document attributes, but this configuration has surprised
# us before: РегистрНакопления.Продажи does not exist at all, "КАК В" kills
# Execute with a bare NullReferenceException because В is a reserved word, and
# a filter by reference falls over on this 8.2 build. A rejected column here
# does not raise a readable error either -- Execute() simply returns null.
#
# So this runs the NEW queries verbatim, straight out of queries.json, BEFORE
# extract.ps1 is replaced. Nothing is written to 1C and nothing on disk is
# touched: worst case the probe prints a failure and the agent keeps running
# on the old files.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-lineno-deleted.ps1
#
# By default it reads queries.json sitting next to this script -- put the NEW
# one here, not over the agent's working copy, until the probe passes.

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $QueriesPath,
    # Скільки днів назад брати документи. Три — те саме вікно, що й у обміну.
    [int]    $Days = 3,
    # Скільки рядків показати з кожного запиту.
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

Write-Host "connecting..."
$connector = New-Object -ComObject V82.COMConnector
$ib = $connector.Connect($connString)
Write-Host "connected"
Write-Host ""

$from = (Get-Date).AddDays(-$Days)
$failures = 0

# Одна невдала проба не має ховати решту: COM-сесія після провального
# Execute() стає отруєною і всі наступні запити відповідають
# NullReference, тому кожен запит іде у власному з'єднанні.
function Probe([string] $name, [string] $text, [int] $newIndex, [string] $newLabel) {
    Write-Host "--- $name ---"
    try {
        $conn = New-Object -ComObject V82.COMConnector
        $link = $conn.Connect($connString)
        $q = $link.NewObject("Query")
        $q.Text = [string]$text
        $q.SetParameter([string]$queries.paramFrom, $from)
        $res = $q.Execute()
        if ($null -eq $res) {
            Write-Host "  ПРОВАЛ: Execute() повернув null — 1С не прийняла запит" -ForegroundColor Red
            $script:failures++
            return
        }
        $sel = $res.Choose()
        $n = 0
        while ($sel.Next() -and $n -lt $Show) {
            $value = $sel.Get($newIndex)
            $shown = if ($null -eq $value) { "<null>" } else { [string]$value }
            Write-Host ("  рядок {0}: {1} = {2}" -f ($n + 1), $newLabel, $shown)
            $n++
        }
        if ($n -eq 0) {
            Write-Host ("  запит пройшов, але за {0} дн. рядків немає — візьміть більше -Days" -f $Days) -ForegroundColor Yellow
        } else {
            Write-Host ("  OK: колонка читається") -ForegroundColor Green
        }
    } catch {
        Write-Host ("  ПРОВАЛ: {0}" -f $_.Exception.Message) -ForegroundColor Red
        $script:failures++
    }
    Write-Host ""
}

# Індекси нових колонок — ті самі, що читатиме extract.ps1.
Probe "ordersSince / ПометкаУдаления"      $queries.ordersSince      8 "ПометкаУдаления"
Probe "orderItemsSince / НомерСтроки"      $queries.orderItemsSince  5 "НомерСтроки"
Probe "salesItemsSince / НомерСтроки"      $queries.salesItemsSince  5 "НомерСтроки"
Probe "returnItemsSince / НомерСтроки"     $queries.returnItemsSince 5 "НомерСтроки"

Write-Host "=============================="
if ($failures -eq 0) {
    Write-Host "ВСЕ ЧОТИРИ ЗАПИТИ ПРОЙШЛИ — можна класти нові queries.json і extract.ps1" -ForegroundColor Green
} else {
    Write-Host ("ПРОВАЛІВ: {0} — НЕ міняйте файли агента, покажіть цей вивід" -f $failures) -ForegroundColor Red
}
