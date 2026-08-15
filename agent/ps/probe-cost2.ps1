# Probe 2: nail down ProdazhiSebestoimost so the exchange can be wired.
#
# Probe 1 settled the big question: RegistrNakopleniya.Prodazhi does NOT exist
# in this build, but RegistrNakopleniya.ProdazhiSebestoimost DOES and returns
# rows (Registrator, Nomenklatura, quantity, cost). That is the source of the
# "Valovaya pribyl val" report the operator has open.
#
# What is still unknown, and what this probe answers:
#   1. Field names. Probe 1 read columns positionally (Get(0..3)) so the third
#      column could be Kolichestvo and the fourth Stoimost -- or something else
#      entirely. Names must be PROVEN before they go into queries.json.
#   2. Is the cost per unit or per line? 4,63 for quantity 1 is ambiguous.
#   3. Does Registrator point at RealizaciyaTovarovUslug? If the register also
#      logs returns and write-offs, the exchange must filter by document type
#      or it will subtract cost that never was a sale.
#   4. Does the register cover the SAME period as our realizations (2026-01+)?
#   5. THE PAYOFF: cost joined to a real realization, one row per
#      (document, product), so the number can be checked against the report.
#
# Section 6 re-runs the metadata sweep that failed in probe 1: .Metadata is not
# reachable off the connection object in 8.2 the way it was written. Two other
# routes are tried instead.
#
# Each candidate is its own query in its own try/catch: a wrong name fails
# Execute() with a bare NullReferenceException naming nothing, and one bad call
# poisons the COM session for everything after it.
#
# READ-ONLY. Run with 32-bit PowerShell from the agent folder:
#   cd C:\Users\fedyshyn\budvik-agent
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f .\probe-cost2.ps1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Days = 30
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir "config.json" }

$config = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$connString = 'Srvr="' + $config.oneC.server + '";Ref="' + $config.oneC.base +
              '";Usr="' + $config.oneC.user + '";Pwd="' + $config.oneC.password + '";'

Write-Host "connecting..."
$connector = New-Object -ComObject V82.COMConnector
$ib = $connector.Connect($connString)
Write-Host "connected"
Write-Host ""

# Cyrillic must not appear as a literal: PS5 reads .ps1 in the OEM codepage and
# mangles it. Everything is built from char codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT  = C 1042,1067,1041,1056,1040,1058,1068
$FIRST   = C 1055,1045,1056,1042,1067,1045
$FROM    = C 1048,1047
$AS      = C 1050,1040,1050
$WHERE   = C 1043,1044,1045
$AND     = C 1048
$SUM     = C 1057,1059,1052,1052,1040
$COUNT   = C 1050,1054,1051,1048,1063,1045,1057,1058,1042,1054
$MIN     = C 1052,1048,1053,1048,1052,1059,1052
$MAX     = C 1052,1040,1050,1057,1048,1052,1059,1052
$GROUPBY = (C 1057,1043,1056,1059,1055,1055,1048,1056,1054,1042,1040,1058,1068) + " " + (C 1055,1054)
$REFOP   = C 1057,1057,1067,1051,1050,1040
$EXPRESS = C 1042,1067,1056,1040,1047,1048,1058,1068
$DIFFER  = C 1056,1040,1047,1051,1048,1063,1053,1067,1045

$REG   = C 1056,1077,1075,1080,1089,1090,1088,1053,1072,1082,1086,1087,1083,1077,1085,1080,1103
$DOC   = C 1044,1086,1082,1091,1084,1077,1085,1090

$PS            = C 1055,1088,1086,1076,1072,1078,1080,1057,1077,1073,1077,1089,1090,1086,1080,1084,1086,1089,1090,1100
$Stoimost      = C 1057,1090,1086,1080,1084,1086,1089,1090,1100
$Registrator   = C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088
$Nomenklatura  = C 1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1072
$Kolichestvo   = C 1050,1086,1083,1080,1095,1077,1089,1090,1074,1086
$Period        = C 1055,1077,1088,1080,1086,1076
$Data          = C 1044,1072,1090,1072
$Nomer         = C 1053,1086,1084,1077,1088
$SummaDok      = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072
$Kontragent    = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090
$Realizaciya   = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075
$Naimenovanie  = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077
$Tovary        = C 1058,1086,1074,1072,1088,1099
$Cena          = C 1062,1077,1085,1072
$Summa         = C 1057,1091,1084,1084,1072
$Sklad         = C 1057,1082,1083,1072,1076

$since = (Get-Date).AddDays(-$Days)

function Try-Query {
    param([string] $Label, [string] $Text, [hashtable] $Params = @{}, [int] $Cols = 6, [int] $Rows = 8)

    Write-Host ("-" * 70)
    Write-Host $Label
    try {
        $q = $ib.NewObject("Query")
        $q.Text = $Text
        foreach ($k in $Params.Keys) { $q.SetParameter($k, $Params[$k]) }
        $sel = $q.Execute().Choose()
        $n = 0
        while ($sel.Next() -and $n -lt $Rows) {
            $n++
            $line = @()
            for ($i = 0; $i -lt $Cols; $i++) {
                try {
                    $v = $sel.Get($i)
                    if ($null -eq $v) { $line += ("[{0}] NULL" -f $i); continue }
                    # Reference values print as System.__ComObject -- ask 1C for
                    # a human string instead, that is the whole point here.
                    $s = $v.ToString()
                    if ($s -eq "System.__ComObject") {
                        try { $s = $ib.String($v) } catch { $s = "<ref>" }
                    }
                    $line += ("[{0}] {1}" -f $i, $s)
                } catch { break }
            }
            Write-Host ("  " + ($line -join " | "))
        }
        if ($n -eq 0) { Write-Host "  OK (query valid) but ZERO rows" }
        else { Write-Host ("  OK -- {0} row(s)" -f $n) }
        return $true
    } catch {
        Write-Host ("  FAIL: " + $_.Exception.Message.Split("`n")[0])
        return $false
    }
}

Write-Host "=========================================================="
Write-Host " 1. Field names: confirm each one separately"
Write-Host "=========================================================="

Try-Query "1a. Period + Registrator + Nomenklatura (names, resolved to text)" @"
$SELECT $FIRST 5 $Period, $Registrator, $Nomenklatura
$FROM $REG.$PS
"@ 3

Try-Query "1b. Kolichestvo + Stoimost by name" @"
$SELECT $FIRST 5 $Kolichestvo, $Stoimost
$FROM $REG.$PS
"@ 2

Try-Query "1c. is there a Sklad dimension?" @"
$SELECT $FIRST 3 $Sklad
$FROM $REG.$PS
"@ 1

Write-Host ""
Write-Host "=========================================================="
Write-Host " 2. What document types write into this register?"
Write-Host "=========================================================="
Write-Host " If returns/write-offs are here too, the exchange must filter."
Write-Host ""

Try-Query "2a. distinct registrar types (via reference cast test)" @"
$SELECT $DIFFER $FIRST 20 $Registrator
$FROM $REG.$PS
$WHERE $Period >= &DateFrom
"@ 1 20 @{ DateFrom = $since }

Write-Host ""
Write-Host "=========================================================="
Write-Host " 3. Period coverage -- does it reach our realizations?"
Write-Host "=========================================================="

Try-Query "3a. min/max period + row count" @"
$SELECT
    $MIN($Period), $MAX($Period), $COUNT(*)
$FROM $REG.$PS
"@ 3

Write-Host ""
Write-Host "=========================================================="
Write-Host " 4. THE PAYOFF: cost per (realization, product)"
Write-Host "=========================================================="
Write-Host " Registrator cast to RealizaciyaTovarovUslug keeps sales only."
Write-Host " Grouping collapses batch splits: one product in one shipment"
Write-Host " can consume several batches, we need the line total."
Write-Host ""

Try-Query "4a. document number/date + product + qty + cost" @"
$SELECT $FIRST 10
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Nomer,
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Data,
    P.$Nomenklatura.$Naimenovanie,
    $SUM(P.$Kolichestvo),
    $SUM(P.$Stoimost)
$FROM $REG.$PS $AS P
$WHERE P.$Period >= &DateFrom
    $AND P.$Registrator $REFOP $DOC.$Realizaciya
$GROUPBY
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Nomer,
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Data,
    P.$Nomenklatura.$Naimenovanie
"@ 5 10 @{ DateFrom = $since }

Write-Host ""
Write-Host "=========================================================="
Write-Host " 5. MARGIN CHECK: cost vs the revenue we already import"
Write-Host "=========================================================="
Write-Host " Joins the register to the document's own line (Tovary) so the"
Write-Host " margin can be eyeballed against 'Valovaya pribyl val'."
Write-Host " Cost per unit vs per line is decided right here: compare"
Write-Host " column [4] (cost) with [3] (qty) and [5] (revenue)."
Write-Host ""

Try-Query "5a. one row per document: revenue, cost, margin %" @"
$SELECT $FIRST 10
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Nomer,
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Data,
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Kontragent.$Naimenovanie,
    $SUM(P.$Kolichestvo),
    $SUM(P.$Stoimost),
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$SummaDok
$FROM $REG.$PS $AS P
$WHERE P.$Period >= &DateFrom
    $AND P.$Registrator $REFOP $DOC.$Realizaciya
$GROUPBY
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Nomer,
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Data,
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Kontragent.$Naimenovanie,
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$SummaDok
"@ 6 10 @{ DateFrom = $since }

Write-Host ""
Write-Host "=========================================================="
Write-Host " 6. Metadata sweep (probe 1's version hit a null object)"
Write-Host "=========================================================="

# 8.2 exposes metadata off the session object, not the connector result, and
# the collection is walked with Get(i), not indexers. Both routes are tried.
foreach ($route in @("Metadata", "NewObject")) {
    try {
        $md = $null
        if ($route -eq "Metadata") { $md = $ib.Metadata }
        else { $md = $ib.NewObject("Metadata") }
        if ($null -eq $md) { Write-Host ("  route {0}: null" -f $route); continue }

        $regs = $md.AccumulationRegisters
        $cnt = $regs.Count()
        Write-Host ("  route {0}: OK, {1} accumulation registers" -f $route, $cnt)

        for ($i = 0; $i -lt $cnt; $i++) {
            $r = $regs.Get($i)
            if ($r.Name -ne $PS) { continue }
            Write-Host ("  >>> " + $r.Name)
            $dims = $r.Dimensions
            for ($d = 0; $d -lt $dims.Count(); $d++) {
                Write-Host ("        dimension: " + $dims.Get($d).Name)
            }
            $res = $r.Resources
            for ($x = 0; $x -lt $res.Count(); $x++) {
                Write-Host ("        resource:  " + $res.Get($x).Name)
            }
            $att = $r.Attributes
            for ($a = 0; $a -lt $att.Count(); $a++) {
                Write-Host ("        attribute: " + $att.Get($a).Name)
            }
        }
        break
    } catch {
        Write-Host ("  route {0} FAILED: {1}" -f $route, $_.Exception.Message.Split("`n")[0])
    }
}

Write-Host ""
Write-Host "=========================================================="
Write-Host " DONE."
Write-Host "=========================================================="
