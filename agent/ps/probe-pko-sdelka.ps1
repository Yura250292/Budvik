# Probe: can a cash order be tied to the realization it pays for?
#
# Why this matters: PaymentAllocation.profitAmount is always 0 today. The
# payment knows the client but not the invoice, so the share of margin inside
# the money collected cannot be computed. A motivation scheme that pays on
# collected PROFIT therefore yields zero for everyone.
#
# probe-pko-kinds found that the RaschifrovkaPlatezha tabular section has
# Sdelka filled on 20 of 20 sampled rows, while DokumentRaschetov and
# ZakazPokupatelya are absent. So Sdelka is the only candidate link -- but
# WHAT it points at is unknown, and that decides everything:
#   * points at RealizaciyaTovarovUslug -> margin is one step away;
#   * points at ZakazPokupatelya        -> need order -> realization first;
#   * points at something else          -> the idea does not work.
#
# This probe answers that question and measures how much of the money is
# actually covered, because a link that exists on 20% of payments is not
# worth building on.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-pko-sdelka.ps1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Months = 3
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

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$AND    = C 1048                                                   # I
$VALUE  = C 1047,1053,1040,1063,1045,1053,1048,1045                # ZNACHENIE
$ENUM   = C 1055,1077,1088,1077,1095,1080,1089,1083,1077,1085,1080,1077   # Perechislenie
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$PKO    = C 1055,1088,1080,1093,1086,1076,1085,1099,1081,1050,1072,1089,1089,1086,1074,1099,1081,1054,1088,1076,1077,1088
$RASCH  = C 1056,1072,1089,1096,1080,1092,1088,1086,1074,1082,1072,1055,1083,1072,1090,1077,1078,1072  # RaschifrovkaPlatezha
$SDELKA = C 1057,1076,1077,1083,1082,1072                          # Sdelka
$SUMPL  = C 1057,1091,1084,1084,1072,1055,1083,1072,1090,1077,1078,1072  # SummaPlatezha
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$DATE   = C 1044,1072,1090,1072                                    # Data
$REFF   = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$LINK   = C 1057,1089,1099,1083,1082,1072                          # Ssylka (owner ref on a tabular section)
$VIDOP  = C 1042,1080,1076,1054,1087,1077,1088,1072,1094,1080,1080  # VidOperacii
$VIDY   = C 1042,1080,1076,1099,1054,1087,1077,1088,1072,1094,1080,1081,1055,1050,1054  # VidyOperaciiPKO
$OPLATA = C 1054,1087,1083,1072,1090,1072,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # OplataPokupatelya
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS
$VYBOR  = C 1042,1067,1041,1054,1056                               # VYBOR
$KOGDA  = C 1050,1054,1043,1044,1040                               # KOGDA
$TOGDA  = C 1058,1054,1043,1044,1040                               # TOGDA
$INACHE = C 1048,1053,1040,1063,1045                               # INACHE
$KONEC  = C 1050,1054,1053,1045,1062                               # KONEC
$SSYLKA = C 1057,1057,1067,1051,1050,1040                          # SSYLKA (type test)
$REAL   = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug
$ZAKAZ  = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # ZakazPokupatelya

$since = (Get-Date).AddMonths(-$Months)

# Same filter as the production query, so the numbers describe the payments we
# actually ingest -- not every cash order in the base.
$kindFilter = " $AND P.$VIDOP = $VALUE($ENUM.$VIDY.$OPLATA)"

# --- 1. What type of object does Sdelka hold? -------------------------------
#
# Read the reference itself and ask its metadata for the type name. Guessing
# by joining to a candidate table would fail silently on a type mismatch.

Write-Host ("=== What Sdelka points at, last {0} months ===" -f $Months)

$types = @{}
$rowsTotal = 0
$filled = 0
try {
    $q = $ib.NewObject("Query")
    # The filter reaches the header through the owner reference: the tabular
    # section itself carries neither the date nor the operation kind.
    # SSYLKA is 1C's own type test ("Sdelka SSYLKA Dokument.X"), used instead
    # of reading the type off the COM object: Metadata().Name came back empty
    # on this build, which is what left the first run's type column blank.
    $q.Text = "$SELECT T.$SDELKA, T.$SUMPL" +
              ", $VYBOR $KOGDA T.$SDELKA $SSYLKA $DOC.$REAL $TOGDA 1 $INACHE 0 $KONEC" +
              ", $VYBOR $KOGDA T.$SDELKA $SSYLKA $DOC.$ZAKAZ $TOGDA 1 $INACHE 0 $KONEC" +
              " $FROM $DOC.$PKO.$RASCH $AS T" +
              " $WHERE T.$LINK.$POSTED $AND T.$LINK.$DATE >= &$PARAM" +
              " $AND T.$LINK.$VIDOP = $VALUE($ENUM.$VIDY.$OPLATA)"
    $q.SetParameter($PARAM, $since)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()

    while ($r.Next()) {
        $rowsTotal++
        $sd = $r.Get(0)
        $type = "<empty>"
        if ($null -ne $sd) {
            $filled++
            # Metadata() through COM returned an empty name on this build, so
            # the type is resolved by asking 1C itself (see the TYPE columns
            # added to the query) rather than by reading it off the object.
            if ($r.Get(2)) { $type = "RealizaciyaTovarovUslug" }
            elseif ($r.Get(3)) { $type = "ZakazPokupatelya" }
            else { $type = "<other type>" }
        }
        $amt = $r.Get(1)
        if (-not $types.ContainsKey($type)) { $types[$type] = @{ n = 0; sum = 0.0 } }
        $types[$type].n++
        if ($null -ne $amt) { $types[$type].sum += [double]$amt }
    }

    Write-Host ("  payment lines: {0}, of them with Sdelka filled: {1}" -f $rowsTotal, $filled)
    foreach ($k in ($types.Keys | Sort-Object { -$types[$_].sum })) {
        Write-Host ("    {0,7} lines  {1,16:N2} UAH   -> {2}" -f $types[$k].n, $types[$k].sum, $k)
    }
    if ($rowsTotal -eq 0) {
        Write-Host "  (no payment lines in this window -- widen -Months)"
    }
}
catch {
    Write-Host ("FAILED: " + $_.Exception.Message)
    Write-Host "Without this the profit link cannot be designed -- stop and investigate."
}
Write-Host ""

# --- 2. Coverage: how much of the collected money carries a link? -----------
#
# A link present on a minority of payments is not a basis for paying people.

Write-Host "=== Coverage of collected money ==="
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT P.$REFF, P.$DATE $FROM $DOC.$PKO $AS P" +
              " $WHERE P.$POSTED $AND P.$DATE >= &$PARAM" + $kindFilter
    $q.SetParameter($PARAM, $since)
    $rs = $q.Execute()
    $r = $rs.Choose()
    $payments = 0
    while ($r.Next()) { $payments++ }
    Write-Host ("  customer payments in window: {0}" -f $payments)
    Write-Host ("  payment lines with a Sdelka: {0}" -f $filled)
    if ($payments -gt 0) {
        Write-Host ("  ratio: {0:N1} lines per payment" -f ($rowsTotal / $payments))
        Write-Host "  (a payment with no line at all cannot be linked to a document)"
    }
}
catch {
    Write-Host ("FAILED: " + $_.Exception.Message)
}

Write-Host ""
Write-Host "Read this way:"
Write-Host "  * Sdelka -> RealizaciyaTovarovUslug: best case, margin is one join away;"
Write-Host "  * Sdelka -> ZakazPokupatelya: usable, but the order must be resolved to"
Write-Host "    its realization first, and orders can be partially shipped;"
Write-Host "  * mostly <empty>: the link is not there and collected profit stays"
Write-Host "    unavailable -- better to pay on collected TURNOVER than on a number"
Write-Host "    built from a minority of documents."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
