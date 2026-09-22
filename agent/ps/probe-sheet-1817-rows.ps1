# Rows of sheet 1817 -- built from the query that already works in production.
#
# Two earlier attempts died with "Object reference not set" on the realizations
# step, and each time we blamed the wrong thing:
#
#   probe-sheet-1817       filtered by reference (GDE T.MarshrutnyjLyst = &Sheet)
#                          -- that form is known to fail on this 8.2 build;
#   probe-sheet-1817-rows  used a LATIN parameter name (&DateFrom) plus an upper
#                          date bound. The production query uses the Cyrillic
#                          name DataS and no upper bound at all.
#
# So this version stops inventing query text. It runs, verbatim, the same
# statement extract.ps1 sends every cycle (queries.json: routeSheetStopsSince),
# and a second one shaped exactly like salesSince -- which selects Proveden and
# is likewise known to work. Everything else is done in PowerShell: the sheet
# match by GUID and the upper date bound.
#
# What we are after: the site imports 17 rows totalling 58 181,19 UAH, the
# owner's form shows a payroll base of 66 078,52 -- a gap of 7 897,33. Query A
# carries "I T.Proveden", query B does not. If B finds rows that A misses, the
# gap is unposted documents.
#
# One connection per query: a failed Execute() poisons the session on this
# build and every later query then answers "Object reference not set".
#
# READ-ONLY -- two SELECTs, nothing is written, nothing is posted.
#
# 32-bit PowerShell, one line:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-1817-rows.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $SheetNumber = "000001817",
    # Sheets carry the PREVIOUS day's shipments, and 1817 already holds a row
    # dated 07.08 -- so the window starts well before the sheet date.
    [string] $From = "2026-08-01",
    [string] $To   = "2026-08-16"
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir "config.json" }

$config = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$connString = 'Srvr="' + $config.oneC.server + '";Ref="' + $config.oneC.base +
              '";Usr="' + $config.oneC.user + '";Pwd="' + $config.oneC.password + '";'

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

# Cyrillic by code point: the file stays ASCII, otherwise the encoding gets
# mangled somewhere between Mac, RDP and PowerShell.
$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM_  = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$AND    = C 1048                                                   # I
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$KONTR  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$ADRDOST= C 1040,1076,1088,1077,1089,1044,1086,1089,1090,1072,1074,1082,1080  # AdresDostavki
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$REALIZ = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS -- the production parameter name

function RefId($ib, $value) {
    if ($null -eq $value) { return $null }
    try {
        $s = $ib.XMLString($value)
        if ([string]::IsNullOrWhiteSpace($s)) { return $null }
        if ($s -eq "00000000-0000-0000-0000-000000000000") { return $null }
        return $s
    } catch { return $null }
}

function New-Ib {
    $c = New-Object -ComObject V82.COMConnector
    return @{ conn = $c; ib = $c.Connect($script:connString) }
}
function Close-Ib($h) {
    if ($null -eq $h) { return }
    if ($h.ib)   { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($h.ib) }
    if ($h.conn) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($h.conn) }
    [GC]::Collect()
}

$dateFrom = [datetime]::ParseExact($From, "yyyy-MM-dd", $null)
$dateTo   = [datetime]::ParseExact($To,   "yyyy-MM-dd", $null)

# --- Step 1: the sheet GUID -------------------------------------------------

Write-Host ("=== 1. Sheet {0} ===" -f $SheetNumber)
$sheetId = $null
$h = New-Ib
try {
    $q = $h.ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 5 L.$REF, L.$NUM, L.$DATE" +
              " $FROM_ $DOC.$RS $AS L $WHERE L.$NUM = &SheetNum"
    $q.SetParameter("SheetNum", $SheetNumber)
    $res = $q.Execute()
    if ($null -eq $res) { throw "Execute() returned null" }
    $r = $res.Choose()
    if ($r.Next()) {
        $sheetId = RefId $h.ib $r.Get(0)
        Write-Host ("  found, GUID {0}" -f $sheetId)
    } else { Write-Host "  NOT FOUND" }
}
catch { Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0]) }
Close-Ib $h
Write-Host ""
if (-not $sheetId) { exit 0 }

<#
  Runs one statement, keeps only rows of our sheet, returns what it found.

  $text must already be a complete query using the production parameter name.
  Column order is fixed by the caller: 0 = sheet ref, 1 = amount, 2 = date,
  3 = label, 4 = posted flag (or $null when the query has no such column).
#>
function Collect($label, $text, $hasPosted) {
    Write-Host ("--- {0}" -f $label)
    $out = @{ rows = @(); failed = $null }
    $hh = New-Ib
    try {
        $q = $hh.ib.NewObject("Query")
        $q.Text = $text
        $q.SetParameter($script:PARAM, $script:dateFrom)
        $res = $q.Execute()
        if ($null -eq $res) { throw "Execute() returned null" }
        $r = $res.Choose()
        while ($r.Next()) {
            $rid = RefId $hh.ib $r.Get(0)
            if ($rid -ne $script:sheetId) { continue }

            $d = [datetime]$r.Get(2)
            if ($d -ge $script:dateTo) { continue }

            $sum = 0.0
            try { $sum = [double]$r.Get(1) } catch { $sum = 0.0 }
            $isPosted = $true
            if ($hasPosted) { try { $isPosted = [bool]$r.Get(4) } catch { $isPosted = $true } }

            $out.rows += [pscustomobject]@{
                label  = ([string]$r.Get(3)).Trim()
                date   = $d
                amount = $sum
                posted = $isPosted
            }
        }
        Write-Host ("    rows on this sheet: {0}" -f $out.rows.Count)
    }
    catch {
        $out.failed = $_.Exception.Message.Split("`n")[0]
        Write-Host ("    FAILED: " + $out.failed)
    }
    Close-Ib $hh
    Write-Host ""
    return $out
}

# --- Step 2A: exactly what the ingest runs (posted only) ---------------------

$textA = "$SELECT T.$RS, T.$SUMDOC, T.$DATE, T.$ADRDOST, T.$REF" +
         " $FROM_ $DOC.$REALIZ $AS T $WHERE T.$DATE >= &$PARAM $AND T.$POSTED"

Write-Host ("=== 2. Realizations {0}..{1} ===" -f $From, $To)
$a = Collect "A: production query (posted only)" $textA $false

# --- Step 2B: same shape as salesSince, no posted filter --------------------

$textB = "$SELECT T.$RS, T.$SUMDOC, T.$DATE, T.$NUM, T.$POSTED" +
         " $FROM_ $DOC.$REALIZ $AS T $WHERE T.$DATE >= &$PARAM"
$b = Collect "B: same, without the posted filter" $textB $true

# --- Step 3: verdict --------------------------------------------------------

$sumA = ($a.rows | Measure-Object amount -Sum).Sum
if (-not $sumA) { $sumA = 0.0 }
$sumB = ($b.rows | Measure-Object amount -Sum).Sum
if (-not $sumB) { $sumB = 0.0 }

if ($b.rows.Count -gt 0) {
    Write-Host "Rows found without the posted filter:"
    $i = 0
    foreach ($row in ($b.rows | Sort-Object date)) {
        $i++
        Write-Host ("  {0,2}. {1,-14} {2:dd.MM} {3,12:N2}  {4}" -f `
            $i, $row.label, $row.date, $row.amount,
            $(if ($row.posted) { "posted" } else { "UNPOSTED" }))
    }
    Write-Host ""
}

Write-Host "=== 3. Verdict ==="
Write-Host ("  A, posted only ........... {0,3} rows, {1,12:N2}   <- what the site imports" -f $a.rows.Count, $sumA)
Write-Host ("  B, all rows .............. {0,3} rows, {1,12:N2}" -f $b.rows.Count, $sumB)
Write-Host "  site currently has ....... 17 rows,    58 181,19"
Write-Host "  owner's payroll base .....             66 078,52   (form 71 966,52 minus debt 5 888,00)"
Write-Host ""

if ([Math]::Abs(66078.52 - $sumB) -lt 1.0) {
    Write-Host "  ALL rows match the base -> the gap is the unposted rows the ingest filters out."
} elseif ([Math]::Abs(66078.52 - $sumA) -lt 1.0) {
    Write-Host "  POSTED rows match the base -> 1C has rows the ingest never delivered."
} elseif ([Math]::Abs($sumA - 58181.19) -lt 1.0) {
    Write-Host "  1C agrees with the site (58 181,19) -> the form's 71 966,52 counts something"
    Write-Host "  beyond realizations: returns, payments, or rows added by hand on the form."
} else {
    Write-Host ("  A differs from the base by {0,10:N2}" -f (66078.52 - $sumA))
    Write-Host ("  B differs from the base by {0,10:N2}" -f (66078.52 - $sumB))
}
