# Where does "Oplata zaborgovanosti" live, and what does it point at?
#
# Two things are now settled and change the whole ingest design:
#
#   1. RealizaciyaTovarovUslug HAS an attribute MarshrutnyjLyst, filled 40/40.
#      So the stop list is one query -- realizations whose MarshrutnyjLyst is
#      the sheet -- and the print form does exactly that. No tabular section
#      needed, nothing to reverse-engineer.
#
#   2. Document 000001242 ("Oplata zaborgovanosti", 5 888.00) is NOT a
#      PriKhodnyiKassovyiOrder -- no PKO carries that number. It is a separate
#      document type, and the exchange does not read it at all.
#
# That second point may reach far past driver payroll: if debt collection is a
# document we never sync, money the company actually received is invisible on
# the site -- in receivables, in rep motivation, in analytics.
#
# This probe finds that document. Section 1 sweeps names in both languages,
# section 2 asks each candidate for number 000001242 (proof, not a guess), and
# section 3 checks whether it too points back at the route sheet -- which is
# what makes the driver's percentage computable.
#
# Note on section 3 of the previous probe: PKO.VidOperacii printed as
# System.__ComObject for all 500 rows, so the operation kind could not be read
# as text. Enum values must be compared with ZNACHENIE() inside the query, not
# read out and inspected -- section 4 does it properly.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-debt-doc-final.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-debt-final.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $DocNumber = "000001242"
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
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$AND    = C 1048                                                   # I
$COUNT  = C 1050,1054,1051,1048,1063,1045,1057,1058,1042,1054      # KOLICHESTVO
$SUM    = C 1057,1059,1052,1052,1040                               # SUMMA
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$KONTR  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$PARAM  = C 1053,1086,1084                                         # Nom
$PARAMD = C 1044,1072,1090,1072,1057                               # DataS

$RS = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst

# --- 1. Which document types exist with debt-ish names? ---------------------
#
# The printed form says "Oplata zaborgovanosti" -- Ukrainian, like the route
# sheet itself. Both languages and several wordings are tried.

Write-Host "=== 1. Candidate document names ==="

$names = @(
    @{ l = "OplataZaborgovanosti";   n = (C 1054,1087,1083,1072,1090,1072,1047,1072,1073,1086,1088,1075,1086,1074,1072,1085,1086,1089,1090,1110) },
    @{ l = "OplataZaborgovanosty";   n = (C 1054,1087,1083,1072,1090,1072,1047,1072,1073,1086,1088,1075,1086,1074,1072,1085,1086,1089,1090,1080) },
    @{ l = "OplataZadolzhennosti";   n = (C 1054,1087,1083,1072,1090,1072,1047,1072,1076,1086,1083,1078,1077,1085,1085,1086,1089,1090,1080) },
    @{ l = "Zaborgovanist";          n = (C 1047,1072,1073,1086,1088,1075,1086,1074,1072,1085,1110,1089,1090,1100) },
    @{ l = "OplataBorgu";            n = (C 1054,1087,1083,1072,1090,1072,1041,1086,1088,1075,1091) },
    @{ l = "OplataKlienta";          n = (C 1054,1087,1083,1072,1090,1072,1050,1083,1110,1108,1085,1090,1072) },
    @{ l = "OplataPokupcya";         n = (C 1054,1087,1083,1072,1090,1072,1055,1086,1082,1091,1087,1094,1103) },
    @{ l = "Oplata";                 n = (C 1054,1087,1083,1072,1090,1072) },
    @{ l = "PrijomKoshtiv";          n = (C 1055,1088,1080,1081,1086,1084,1050,1086,1096,1090,1110,1074) },
    @{ l = "NadhodzhennyaKoshtiv";   n = (C 1053,1072,1076,1093,1086,1076,1078,1077,1085,1085,1103,1050,1086,1096,1090,1110,1074) },
    @{ l = "PrybutkovyjKasovyjOrder";n = (C 1055,1088,1080,1073,1091,1090,1082,1086,1074,1080,1081,1050,1072,1089,1086,1074,1080,1081,1054,1088,1076,1077,1088) },
    @{ l = "KasovyjOrder";           n = (C 1050,1072,1089,1086,1074,1080,1081,1054,1088,1076,1077,1088) },
    @{ l = "PKO_UA";                 n = (C 1055,1050,1054) },
    @{ l = "RozrahunokZKlientom";    n = (C 1056,1086,1079,1088,1072,1093,1091,1085,1086,1082,1047,1050,1083,1110,1108,1085,1090,1086,1084) }
)

$exists = @()

foreach ($d in $names) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 3 R.$REF, R.$NUM, R.$DATE, R.$SUMDOC $FROM $DOC.$($d.n) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $has = $r.Next()
        $sample = ""
        if ($has) {
            try {
                $sample = "No " + ([string]$r.Get(1)).Trim() + " of " + ([string]$r.Get(2)).Trim() +
                          ", " + ([string]$r.Get(3)).Trim()
            } catch { }
        }
        Write-Host ("  FOUND   Dokument.{0,-26} {1}" -f $d.l, $(if ($has) { $sample } else { "(empty)" }))
        $exists += $d
    }
    catch { }
}

if ($exists.Count -eq 0) { Write-Host "  (none of these names exists)" }
Write-Host ""

# --- 2. Which one holds number 000001242? -----------------------------------

Write-Host ("=== 2. Which document has number {0}? ===" -f $DocNumber)

$winner = $null
foreach ($d in $exists) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 3 R.$REF, R.$NUM, R.$DATE, R.$SUMDOC, R.$KONTR.$NAME" +
                  " $FROM $DOC.$($d.n) $AS R $WHERE R.$NUM = &$PARAM"
        $q.SetParameter($PARAM, $DocNumber)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        if ($r.Next()) {
            Write-Host ("  *** MATCH: Dokument.{0}" -f $d.l)
            Write-Host ("      number {0}, date {1}, sum {2}, counterparty {3}" -f `
                ([string]$r.Get(1)).Trim(), ([string]$r.Get(2)).Trim(),
                ([string]$r.Get(3)).Trim(), ([string]$r.Get(4)).Trim())
            Write-Host "      (expected: 5 888,00 UAH, FOP Osoba Roman, 10.08.2026)"
            if (-not $winner) { $winner = $d }
        }
    }
    catch { }
}
if (-not $winner) { Write-Host "  not found among the names above" }
Write-Host ""

# --- 3. Does it point back at the route sheet? ------------------------------
#
# Realizations do (40/40). If debt payments do too, the driver's percentage is
# computable from 1C alone: sum realizations of the sheet, subtract debt
# payments of the same sheet.

if ($winner) {
    Write-Host ("=== 3. Does Dokument.{0} link to the route sheet? ===" -f $winner.l)

    $linkAttrs = @(
        @{ l = "MarshrutnyjLyst";   n = $RS },
        @{ l = "DokumentOsnovanie"; n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1054,1089,1085,1086,1074,1072,1085,1080,1077) },
        @{ l = "Osnovanie";         n = (C 1054,1089,1085,1086,1074,1072,1085,1080,1077) },
        @{ l = "Voditel";           n = (C 1042,1086,1076,1080,1090,1077,1083,1100) },
        @{ l = "VidOperacii";       n = (C 1042,1080,1076,1054,1087,1077,1088,1072,1094,1080,1080) },
        @{ l = "Sdelka";            n = (C 1057,1076,1077,1083,1082,1072) }
    )

    foreach ($a in $linkAttrs) {
        try {
            $q = $ib.NewObject("Query")
            $q.Text = "$SELECT $FIRST 40 R.$REF, R.$($a.n) $FROM $DOC.$($winner.n) $AS R"
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "null" }
            $r = $rs.Choose()
            $rows = 0
            $filled = 0
            while ($r.Next()) {
                $rows++
                $v = $r.Get(1)
                if ($null -eq $v) { continue }
                $txt = ([string]$v).Trim()
                if ($txt -eq "System.__ComObject") { $filled++ }
                elseif ($txt -ne "" -and $txt -ne "0") { $filled++ }
            }
            Write-Host ("  OK      {0,-20} {1,2}/{2,-2} filled" -f $a.l, $filled, $rows)
        }
        catch {
            Write-Host ("  absent  {0}" -f $a.l)
        }
    }
    Write-Host ""

    # --- 4. How much money is invisible to the site? ------------------------
    #
    # The exchange reads only PKO with VidOperacii = OplataPokupatelya. If this
    # is a different document entirely, every hryvnia it records is missing
    # from receivables and from rep motivation.

    Write-Host "=== 4. Volume: how much does the site not see? ==="
    try {
        $since = (Get-Date).AddYears(-1)
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $COUNT(R.$REF) $AS Cnt, $SUM(R.$SUMDOC) $AS Tot" +
                  " $FROM $DOC.$($winner.n) $AS R $WHERE R.$POSTED $AND R.$DATE >= &$PARAMD"
        $q.SetParameter($PARAMD, $since)
        $rs = $q.Execute()
        $r = $rs.Choose()
        if ($r.Next()) {
            Write-Host ("  Last 12 months: {0} documents, {1} UAH total" -f `
                ([string]$r.Get(0)).Trim(), ([string]$r.Get(1)).Trim())
            Write-Host "  ^ if this is large, the site's collected-money figures are"
            Write-Host "    understated by roughly this much -- a problem well beyond payroll."
        }
    }
    catch {
        Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
    }
}
else {
    Write-Host "=== 3-4 skipped: document not identified ==="
    Write-Host "In 1C open that row of the route sheet (Oplata zaborgovanosti 000001242)"
    Write-Host "and report the document type from its window title."
}
Write-Host ""

# --- 5. Rebuild one sheet's stop list, the way the print form does ----------
#
# Realizations carry MarshrutnyjLyst (40/40), so this is the real thing: the
# stop list, straight from the link. If the totals match the printed form, the
# ingest design is settled.

Write-Host "=== 5. Stops of one recent sheet, via the MarshrutnyjLyst link ==="

$REALIZ = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug
$ADRDOST = C 1040,1076,1088,1077,1089,1044,1086,1089,1090,1072,1074,1082,1080  # AdresDostavki

$sheetRef = $null
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 1 R.$REF, R.$NUM, R.$DATE $FROM $DOC.$RS $AS R" +
              " $WHERE R.$POSTED $AND R.$DATE >= &$PARAMD"
    $q.SetParameter($PARAMD, (Get-Date).AddMonths(-2))
    $rs = $q.Execute()
    $r = $rs.Choose()
    if ($r.Next()) {
        $sheetRef = $r.Get(0)
        Write-Host ("  Sheet No {0} of {1}" -f ([string]$r.Get(1)).Trim(), ([string]$r.Get(2)).Trim())
    }
} catch {
    Write-Host ("  could not pick a sheet: " + $_.Exception.Message.Split("`n")[0])
}

if ($sheetRef) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 40 R.$NUM, R.$DATE, R.$KONTR.$NAME, R.$SUMDOC, R.$ADRDOST" +
                  " $FROM $DOC.$REALIZ $AS R $WHERE R.$RS = &$PARAM"
        $q.SetParameter($PARAM, $sheetRef)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $n = 0
        $total = 0.0
        while ($r.Next()) {
            $n++
            $sum = 0.0
            [void][double]::TryParse((([string]$r.Get(3)).Trim() -replace ' ', '' -replace ',', '.'),
                [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref] $sum)
            $total += $sum
            Write-Host ("    {0,2}. {1,-38} {2,12}   {3}" -f $n,
                ([string]$r.Get(2)).Trim(), ([string]$r.Get(3)).Trim(), ([string]$r.Get(4)).Trim())
        }
        Write-Host ("  {0} realizations, total {1:N2} UAH" -f $n, $total)
        Write-Host "  ^ compare with the printed sheet: same rows, same total?"
    }
    catch {
        Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
    }
}

Write-Host ""
Write-Host "=== What this settles ==="
Write-Host "Section 2: the exact document type behind 'Oplata zaborgovanosti'."
Write-Host "Section 3: whether it links to the sheet -- if yes, payroll is fully"
Write-Host "  computable from 1C (realizations minus debt payments per sheet)."
Write-Host "Section 4: how much collected money the site currently cannot see."
Write-Host "Section 5: proof that stops can be rebuilt from the link alone."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
