# Where do the 32 rows on the screen actually come from?
#
# Settled by the control test: tabular sections ARE readable over this COM
# connection (ZakazPokupatelya.Tovary answered), and MarshrutnyjLyst has none
# under 32 tried names. So the rows in the photo are not stored in a tabular
# section of the sheet -- they are assembled from somewhere else.
#
# The photo shows exactly what that "somewhere" must contain: a realization
# document number, a counterparty, an address and a document sum, for one
# driver on one date. Two candidates explain that:
#
#   A. The realization itself points back at the sheet, through an attribute
#      whose name we have not tried. An earlier probe thought it saw
#      RealizaciyaTovarovUslug.MarshrutnyjLyst 40/40, then a later one denied
#      it -- and probe-sheet-ts-clean.ps1's own header explains why: a failed
#      Execute() poisons the session, so the denial came AFTER a failure and
#      cannot be trusted. This retests it cleanly, one attribute per fresh
#      connection.
#
#   B. Nothing links them, and the form gathers realizations by driver+date.
#      Then we can reproduce it the same way -- and this probe measures how
#      well that works for the very sheet in the photo (000001820, Picyshyn,
#      2026-08-13, 32 rows).
#
# Whichever answers, we get a usable ingest rule instead of another guess.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-source.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-sheet-source.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath
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

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NOMER  = C 1053,1086,1084,1077,1088                               # Nomer
$DATA   = C 1044,1072,1090,1072                                    # Data
$KONTR  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$SUMMA  = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$VODIT  = C 1042,1086,1076,1080,1090,1077,1083,1100                # Voditel
$AND2   = C 1048                                                   # I -- "AND"
$T      = C 1058                                                   # T
$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$REAL   = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug

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

# Fresh connection per attempt: a failed Execute() poisons the session, so
# batched attempts report false negatives for everything after the first fail.
# That flaw is what made the earlier "no link" conclusion unreliable.
function Test-Attr([string] $label, [string] $attr) {
    $h = $null
    try {
        $h = New-Ib
        $q = $h.ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 5 $T.$REF, $T.$attr $FROM $DOC.$REAL $AS $T"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $sel = $rs.Choose()
        $n = 0
        $filled = 0
        while ($sel.Next()) {
            $n++
            $v = ""
            try { $v = [string]$sel.Get(1) } catch { $v = "" }
            if ($v -and $v -ne "") { $filled++ }
        }
        Write-Host ("  EXISTS  {0,-22} rows {1}, non-empty {2}" -f $label, $n, $filled)
        return $true
    }
    catch {
        Write-Host ("  absent  {0,-22} {1}" -f $label, $_.Exception.Message.Split("`n")[0])
        return $false
    }
    finally { Close-Ib $h }
}

Write-Host "=== A. Does a realization point back at its route sheet? ==="
Write-Host "Retested cleanly -- one fresh connection per attribute, because a"
Write-Host "poisoned session is what made the previous answer unreliable."
Write-Host ""

$attrCandidates = @(
    @{ l = "MarshrutnyjLyst";  n = $RS },
    @{ l = "Marshrut";         n = (C 1052,1072,1088,1096,1088,1091,1090) },
    @{ l = "MarshrutnyjList2"; n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1099,1081,1051,1080,1089,1090) },
    @{ l = "Voditel";          n = $VODIT },
    @{ l = "Vodij_UA";         n = (C 1042,1086,1076,1110,1081) },
    @{ l = "Dostavka";         n = (C 1044,1086,1089,1090,1072,1074,1082,1072) },
    @{ l = "AdresDostavki";    n = (C 1040,1076,1088,1077,1089,1044,1086,1089,1090,1072,1074,1082,1080) }
)

$linkFound = @()
foreach ($a in $attrCandidates) {
    if (Test-Attr $a.l $a.n) { $linkFound += $a.l }
}

Write-Host ""
Write-Host "=== B. The sheet from the photo, and same-day realizations ==="
Write-Host ""

# The sheet: driver and date, read positionally.
$h = $null
try {
    $h = New-Ib
    $q = $h.ib.NewObject("Query")
    $q.Text = "$SELECT $T.$NOMER, $T.$DATA, $T.$VODIT $FROM $DOC.$RS $AS $T"
    $rs = $q.Execute()
    $sel = $rs.Choose()
    $seen = 0
    while ($sel.Next()) {
        $seen++
        $num = ([string]$sel.Get(0)).Trim()
        if ($num -eq "000001820") {
            Write-Host ("  Sheet 000001820 -- date: {0}" -f ([string]$sel.Get(1)))
            Write-Host ("                     driver ref: {0}" -f ([string]$sel.Get(2)))
            break
        }
    }
    Write-Host ("  (scanned {0} sheets)" -f $seen)
}
catch { Write-Host ("  sheet lookup failed: " + $_.Exception.Message.Split("`n")[0]) }
finally { Close-Ib $h }

Write-Host ""
Write-Host "  Realizations dated 2026-08-12 (the day the photo's rows are from)."
Write-Host "  The photo shows 32 rows; if a similar number appears here, the form"
Write-Host "  is gathering by date and we can reproduce it."
Write-Host ""

$h = $null
try {
    $h = New-Ib
    $q = $h.ib.NewObject("Query")
    # Date filter only -- parameter filters on references break on this build,
    # but a plain date comparison is what production already uses everywhere.
    $q.Text = "$SELECT $T.$NOMER, $T.$DATA, $T.$KONTR, $T.$SUMMA $FROM $DOC.$REAL $AS $T $WHERE $T.$DATA >= &D1 $AND2 $T.$DATA < &D2"
    $q.SetParameter("D1", [datetime]"2026-08-12")
    $q.SetParameter("D2", [datetime]"2026-08-13")
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $sel = $rs.Choose()
    $n = 0
    while ($sel.Next()) {
        $n++
        if ($n -le 10) {
            Write-Host ("    {0,-14} {1,-12} sum {2}" -f ([string]$sel.Get(0)), ([string]$sel.Get(1)), ([string]$sel.Get(3)))
        }
    }
    Write-Host ("  total realizations that day: {0}" -f $n)
}
catch { Write-Host ("  date query failed: " + $_.Exception.Message.Split("`n")[0]) }
finally { Close-Ib $h }

Write-Host ""
Write-Host "=== Verdict ==="
if ($linkFound.Count -gt 0) {
    Write-Host ("Realizations DO carry: {0}" -f ($linkFound -join ", "))
    Write-Host "If one of those is the sheet link, the ingest can join stops to sheets"
    Write-Host "exactly, with no guessing by date."
} else {
    Write-Host "No link attribute on realizations. Then the print form gathers rows by"
    Write-Host "driver and date, and the ingest can do the same -- the counts above say"
    Write-Host "how closely that matches the 32 rows in the photo."
}
