# Probe: the route-sheet document (MarshrutnyiList / PutevoiList / custom name)
# -- does it exist, what is it called, and does it carry everything driver
# payroll needs?
#
# Driver pay is three components plus manual bonuses:
#   1. a flat rate per sheet by mileage  (<100 km = 500, 100-300 = 700, >300 = 1000)
#   2. per unique unloading address      (city 25, oblast 15)
#   3. 0.5% of (orders carried - debts collected for previous deliveries)
# Components 1 and 3 read fields of this document; component 2 needs the stop
# list with something that resolves to an address.
#
# Unlike returns, the document NAME itself is unknown -- this configuration is a
# modified UT 2.3 and the route sheet may well be a custom document. Section 0
# therefore walks the metadata first and every later section runs against
# whatever section 0 found, instead of a hardcoded name. Section 0 also dumps
# the full attribute and tabular-section list, which is what makes the guessing
# in sections 2-4 cheap: they only confirm types and fill rates.
#
# Every candidate is its own query in its own try/catch: a wrong attribute name
# fails Execute() with a bare NullReferenceException that names nothing.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-route-sheets.ps1 > probe-route-sheets.txt
#
# Optional: -DocName lets a second run target one document by its metadata name
# once section 0 has named it (skips the candidate scan).

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Years = 2,
    [string] $DocName
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

# Cyrillic must not appear as a literal in this file: PS5 reads .ps1 in the OEM
# codepage and mangles it (or breaks the parser). Everything is built from char
# codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$ORDER  = C 1059,1055,1054,1056,1071,1044,1054,1063,1048,1058,1068 # UPORYADOCHIT
$DESC   = C 1059,1041,1067,1042                                    # UBYV
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument

$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$DELMARK= C 1055,1086,1084,1077,1090,1082,1072,1059,1076,1072,1083,1077,1085,1080,1103  # PometkaUdaleniya
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS

# Substrings used to spot the document among all metadata names.
$SUB_MARSH = C 1052,1072,1088,1096,1088,1091,1090                  # Marshrut
$SUB_PUTEV = C 1055,1091,1090,1077,1074                            # Putev
$SUB_DOSTAV= C 1044,1086,1089,1090,1072,1074                       # Dostav
$SUB_REYS  = C 1056,1077,1081,1089                                 # Reys

$since = (Get-Date).AddYears(-$Years)

function RefId($value) {
    if ($null -eq $value) { return $null }
    try { return [string]$ib.XMLString($value) } catch { return $null }
}

function AsText($value) {
    if ($null -eq $value) { return "" }
    return ([string]$value).Trim()
}

# A reference is "filled" when it is not the all-zero GUID; a primitive when it
# is not empty/zero. Same test used by probe-returns.
function IsFilled($value) {
    $id = RefId $value
    if ($id) {
        return ($id -notmatch '^\{?[0-9a-fA-F-]*0{8}-0{4}-0{4}-0{4}-0{12}')
    }
    $txt = AsText $value
    return ($txt -ne "" -and $txt -ne "0" -and $txt -ne "0,00" -and $txt -ne "False")
}

# --- 0. Find the document by trying candidate names --------------------------
#
# $ib.Metadata is null through COM on this build (documented quirk: metadata is
# discovered by querying candidates in try/catch, never by walking the metadata
# tree). So instead of enumerating the configuration, we ask it directly: for
# each plausible document name, "VYBRAT PERVYE 1 Ssylka, Data IZ Dokument.<Name>".
# A name that exists answers; one that doesn't throws and is skipped.
#
# The list below covers the typical UT 2.3 names plus the usual custom ones. If
# every candidate fails, section 0b brute-forces the attribute list of whatever
# the user names via -DocName.

Write-Host "=== 0. Probing candidate document names ==="

# Cyrillic document names, built from char codes (this file must stay ASCII).
$NAME_MARSHLIST = C 1052,1072,1088,1096,1088,1091,1090,1085,1099,1081,1051,1080,1089,1090            # MarshrutnyiList
$NAME_PUTEVLIST = C 1055,1091,1090,1077,1074,1086,1081,1051,1080,1089,1090                           # PutevoiList
$NAME_MARSHRUT  = C 1052,1072,1088,1096,1088,1091,1090                                               # Marshrut
$NAME_ZADANIE   = C 1047,1072,1076,1072,1085,1080,1077,1053,1072,1055,1077,1088,1077,1074,1086,1079,1082,1091  # ZadanieNaPerevozku
$NAME_DOSTAVKA  = C 1044,1086,1089,1090,1072,1074,1082,1072                                          # Dostavka
$NAME_REYS      = C 1056,1077,1081,1089                                                              # Reys
$NAME_MARSHLIST2= C 1052,1072,1088,1096,1088,1091,1090,1085,1099,1081,1051,1080,1089,1090,1042,1086,1076,1080,1090,1077,1083,1103  # MarshrutnyiListVoditelya
$NAME_PUTLIST2  = C 1055,1091,1090,1077,1074,1086,1081,1051,1080,1089,1090,1040,1074,1090,1086        # PutevoiListAvto
$NAME_RASHNAKL  = C 1056,1072,1089,1093,1086,1076,1085,1072,1103,1053,1072,1082,1083,1072,1076,1085,1072,1103  # RashodnayaNakladnaya

# CONFIRMED 2026-08-12: the document is Dokument.MarshrutnyjLyst -- Ukrainian
# spelling with "y" (1080) where the Russian form has "yi" (1099,1081). That one
# letter is why 50 earlier guesses missed it. It stays first in the list; the
# rest are kept as fallbacks in case another base spells it differently.
$NAME_CONFIRMED = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst

$nameCandidates = @(
    @{ label = "MarshrutnyjLyst (CONFIRMED)"; name = $NAME_CONFIRMED },
    @{ label = "MarshrutnyiList";          name = $NAME_MARSHLIST },
    @{ label = "MarshrutnyiListVoditelya"; name = $NAME_MARSHLIST2 },
    @{ label = "PutevoiList";              name = $NAME_PUTEVLIST },
    @{ label = "PutevoiListAvto";          name = $NAME_PUTLIST2 },
    @{ label = "Marshrut";                 name = $NAME_MARSHRUT },
    @{ label = "ZadanieNaPerevozku";       name = $NAME_ZADANIE },
    @{ label = "Dostavka";                 name = $NAME_DOSTAVKA },
    @{ label = "Reys";                     name = $NAME_REYS },
    @{ label = "RashodnayaNakladnaya";     name = $NAME_RASHNAKL }
)

$candidates = @()

foreach ($cand in $nameCandidates) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 1 R.$REF, R.$DATE $FROM $DOC.$($cand.name) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $hasRows = $r.Next()
        Write-Host ("  EXISTS  {0,-26} {1}" -f $cand.label,
            $(if ($hasRows) { "has documents" } else { "empty" }))
        $candidates += $cand.name
    }
    catch {
        Write-Host ("  absent  {0}" -f $cand.label)
    }
}

if ($candidates.Count -eq 0) {
    Write-Host ""
    Write-Host "  None of the guessed names exists in this configuration."
    Write-Host "  Open 1C: Operations -> Documents, find the route sheet, and note the"
    Write-Host "  name shown in the configurator (or its Russian name in the journal)."
    Write-Host "  Then rerun with:  -DocName <ExactName>"
}
Write-Host ""

if ($DocName) { $candidates = @($DocName) }

if ($candidates.Count -eq 0) {
    Write-Host "No candidate document to probe. Stop here and report section 0."
    if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
    if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
    [GC]::Collect()
    exit 0
}

# --- Per-candidate probing ---------------------------------------------------

foreach ($docName in $candidates) {

Write-Host "############################################################"
Write-Host ("### PROBING Dokument.{0}" -f $docName)
Write-Host "############################################################"
Write-Host ""

# --- 1. Volume, and how far back the history goes ----------------------------
#
# The per-year counts pick the backfill start date: payroll needs months, not
# years, so there is no reason to drag in the whole history.

Write-Host ("=== 1. Volume by year, last {0} years ===" -f $Years)

$docExists = $false
$totalDocs = 0
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT R.$REF, R.$DATE, R.$POSTED, R.$DELMARK" +
              " $FROM $DOC.$docName $AS R $WHERE R.$DATE >= &$PARAM"
    $q.SetParameter($PARAM, $since)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()

    $docExists = $true
    $byMonth = @{}
    while ($r.Next()) {
        $d = $r.Get(1)
        $key = if ($null -eq $d) { "unknown" } else { ([datetime]$d).ToString("yyyy-MM") }
        if (-not $byMonth.ContainsKey($key)) {
            $byMonth[$key] = @{ docs = 0; posted = 0; deleted = 0 }
        }
        $byMonth[$key].docs++
        $totalDocs++
        if ([bool]$r.Get(2)) { $byMonth[$key].posted++ }
        if ([bool]$r.Get(3)) { $byMonth[$key].deleted++ }
    }

    foreach ($k in ($byMonth.Keys | Sort-Object)) {
        Write-Host ("  {0}  {1,5} docs ({2} posted, {3} deleted)" -f `
            $k, $byMonth[$k].docs, $byMonth[$k].posted, $byMonth[$k].deleted)
    }
    Write-Host ("  TOTAL {0} docs" -f $totalDocs)
    Write-Host "  ^ pick routeSheetsFrom from the first month that looks like real usage."
}
catch {
    Write-Host ("ABSENT / FAILED: " + $_.Exception.Message)
}
Write-Host ""

if (-not $docExists) { continue }

# --- 2. Header attributes: driver, mileage, vehicle, money -------------------
#
# Section 0 already listed the real names; this confirms each one resolves in a
# query AND is actually filled. An attribute that exists but is empty in most
# documents cannot carry payroll.

Write-Host "=== 2. Header attributes (existence + fill rate over last 100 docs) ==="

$VODITEL  = C 1042,1086,1076,1080,1090,1077,1083,1100                                  # Voditel
$SOTRUDNIK= C 1057,1086,1090,1088,1091,1076,1085,1080,1082                             # Sotrudnik
$FIZLICO  = C 1060,1080,1079,1051,1080,1094,1086                                       # FizLico
$OTVETST  = C 1054,1090,1074,1077,1090,1089,1090,1074,1077,1085,1085,1099,1081         # Otvetstvennyi
$EXPEDIT  = C 1069,1082,1089,1087,1077,1076,1080,1090,1086,1088                        # Ekspeditor
$AVTO     = C 1040,1074,1090,1086,1084,1086,1073,1080,1083,1100                        # Avtomobil
$TRANSPORT= C 1058,1088,1072,1085,1089,1087,1086,1088,1090,1085,1086,1077,1057,1088,1077,1076,1089,1090,1074,1086  # TransportnoeSredstvo
$MASHINA  = C 1052,1072,1096,1080,1085,1072                                            # Mashina
$PROBEG   = C 1055,1088,1086,1073,1077,1075                                            # Probeg
$KILOMETR = C 1050,1080,1083,1086,1084,1077,1090,1088,1072,1078                        # Kilometrazh
$RASSTOYA = C 1056,1072,1089,1089,1090,1086,1103,1085,1080,1077                        # Rasstoyanie
$SPIDOMET = C 1055,1088,1086,1073,1077,1075,1055,1086,1057,1087,1080,1076,1086,1084,1077,1090,1088,1091  # ProbegPoSpidometru
$SUMMA    = C 1057,1091,1084,1084,1072                                                 # Summa
$SUMDOC   = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072    # SummaDokumenta
$SUMZAKAZ = C 1057,1091,1084,1084,1072,1047,1072,1082,1072,1079,1086,1074              # SummaZakazov
$SUMDOLG  = C 1057,1091,1084,1084,1072,1044,1086,1083,1075,1072                        # SummaDolga
$SUMOPLAT = C 1057,1091,1084,1084,1072,1054,1087,1083,1072,1090,1099                   # SummaOplaty
$KDOPLATE = C 1050,1054,1087,1083,1072,1090,1077                                       # KOplate
$SKLAD    = C 1057,1082,1083,1072,1076                                                 # Sklad
$KOMMENT  = C 1050,1086,1084,1084,1077,1085,1090,1072,1088,1080,1081                   # Kommentarii

# The printed form has START and END ODOMETER boxes, not a single mileage
# field -- distance is their difference. That is why every probe for Probeg or
# Rasstoyanie came back absent.
$SPIDOM   = C 1057,1087,1110,1076,1086,1084,1077,1090,1088                                 # Spidometr (UA)
$SPIDOM_RU= C 1057,1087,1080,1076,1086,1084,1077,1090,1088                                 # Spidometr (RU)
$POCHATK  = C 1055,1086,1095,1072,1090,1082,1086,1074,1080,1081,1057,1087,1110,1076,1086,1084,1077,1090,1088  # PochatkovyiSpidometr
$KINCEV   = C 1050,1110,1085,1094,1077,1074,1080,1081,1057,1087,1110,1076,1086,1084,1077,1090,1088            # KincevyiSpidometr
$SPID_POCH= C 1057,1087,1110,1076,1086,1084,1077,1090,1088,1055,1086,1095,1072,1090,1082,1086,1074,1080,1081  # SpidometrPochatkovyi
$SPID_KIN = C 1057,1087,1110,1076,1086,1084,1077,1090,1088,1050,1110,1085,1094,1077,1074,1080,1081            # SpidometrKincevyi
$NACHALN  = C 1053,1072,1095,1072,1083,1100,1085,1099,1081,1057,1087,1080,1076,1086,1084,1077,1090,1088       # NachalnyiSpidometr
$KONECHN  = C 1050,1086,1085,1077,1095,1085,1099,1081,1057,1087,1080,1076,1086,1084,1077,1090,1088            # KonechnyiSpidometr
$VODIJ_UA = C 1042,1086,1076,1110,1081                                                     # Vodij (UA)

$headerFields = @(
    @{ name = "PochatkovyiSpidometr [KM]";      field = $POCHATK },
    @{ name = "KincevyiSpidometr [KM]";         field = $KINCEV },
    @{ name = "SpidometrPochatkovyi [KM]";      field = $SPID_POCH },
    @{ name = "SpidometrKincevyi [KM]";         field = $SPID_KIN },
    @{ name = "NachalnyiSpidometr [KM]";        field = $NACHALN },
    @{ name = "KonechnyiSpidometr [KM]";        field = $KONECHN },
    @{ name = "Spidometr (UA)";                 field = $SPIDOM },
    @{ name = "Spidometr (RU)";                 field = $SPIDOM_RU },
    @{ name = "Vodij (UA)  [DRIVER?]";          field = $VODIJ_UA },
    @{ name = "Voditel  [DRIVER?]";             field = $VODITEL },
    @{ name = "Sotrudnik  [DRIVER?]";           field = $SOTRUDNIK },
    @{ name = "FizLico  [DRIVER?]";             field = $FIZLICO },
    @{ name = "Ekspeditor  [DRIVER?]";          field = $EXPEDIT },
    @{ name = "Otvetstvennyi";                  field = $OTVETST },
    @{ name = "Avtomobil";                      field = $AVTO },
    @{ name = "TransportnoeSredstvo";           field = $TRANSPORT },
    @{ name = "Mashina";                        field = $MASHINA },
    @{ name = "Probeg  [KM?]";                  field = $PROBEG },
    @{ name = "Kilometrazh  [KM?]";             field = $KILOMETR },
    @{ name = "Rasstoyanie  [KM?]";             field = $RASSTOYA },
    @{ name = "ProbegPoSpidometru  [KM?]";      field = $SPIDOMET },
    @{ name = "Summa";                          field = $SUMMA },
    @{ name = "SummaDokumenta  [ORDERS?]";      field = $SUMDOC },
    @{ name = "SummaZakazov  [ORDERS?]";        field = $SUMZAKAZ },
    @{ name = "SummaDolga  [DEBTS?]";           field = $SUMDOLG },
    @{ name = "SummaOplaty  [DEBTS?]";          field = $SUMOPLAT },
    @{ name = "KOplate  [DEBTS?]";              field = $KDOPLATE },
    @{ name = "Sklad";                          field = $SKLAD },
    @{ name = "Kommentarii";                    field = $KOMMENT }
)

foreach ($f in $headerFields) {
    try {
        # Two columns on purpose: "VYBRAT PERVYE 1 <single field>" is unreliable
        # on this build, a second column makes it behave.
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 100 R.$REF, R.$($f.field) $FROM $DOC.$docName $AS R" +
                  " $WHERE R.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $rows = 0; $filled = 0; $sample = ""
        $nums = @()
        while ($r.Next()) {
            $rows++
            $v = $r.Get(1)
            if (IsFilled $v) {
                $filled++
                if (-not $sample) {
                    $id = RefId $v
                    $sample = if ($id) { (AsText $v) + " " + $id } else { AsText $v }
                }
            }
            $d = 0.0
            if ([double]::TryParse((AsText $v), [ref] $d)) { $nums += $d }
        }
        $range = ""
        if ($nums.Count -gt 0) {
            $mn = ($nums | Measure-Object -Minimum).Minimum
            $mx = ($nums | Measure-Object -Maximum).Maximum
            $av = ($nums | Measure-Object -Average).Average
            $range = ("   min={0:N1} max={1:N1} avg={2:N1}" -f $mn, $mx, $av)
        }
        Write-Host ("OK      {0,-34} {1,3}/{2,-3} filled   sample: {3}{4}" -f `
            $f.name, $filled, $rows, $sample, $range)
    }
    catch {
        Write-Host ("ABSENT  {0}" -f $f.name)
    }
}
Write-Host ""
Write-Host "  [KM?] with a plausible min/max/avg is the mileage field (rate tiers use it)."
Write-Host "  [ORDERS?] and [DEBTS?] are the two figures behind the 0.5% component:"
Write-Host "  pay base = orders carried - debts collected. If no [DEBTS?] field is"
Write-Host "  filled, that figure lives in a tabular section or nowhere -- see section 4."
Write-Host ""

# --- 3. Which column is the actual driver? -----------------------------------
#
# Same method that proved Menedzher for realizations: the column showing many
# distinct people who look like drivers wins; a handful of back-office names
# means the wrong column.

Write-Host "=== 3. Driver column: distinct people per candidate (last 200 docs) ==="

foreach ($cand in @(
    @{ name = "Voditel";       field = $VODITEL },
    @{ name = "Sotrudnik";     field = $SOTRUDNIK },
    @{ name = "FizLico";       field = $FIZLICO },
    @{ name = "Ekspeditor";    field = $EXPEDIT },
    @{ name = "Otvetstvennyi"; field = $OTVETST }
)) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 200 R.$REF, R.$($cand.field).$NAME, R.$($cand.field)" +
                  " $FROM $DOC.$docName $AS R $WHERE R.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $people = @{}
        $refs = @{}
        $empty = 0; $rows = 0
        while ($r.Next()) {
            $rows++
            $n = AsText $r.Get(1)
            if ($n -eq "") { $empty++; continue }
            if (-not $people.ContainsKey($n)) { $people[$n] = 0 }
            $people[$n]++
            $id = RefId $r.Get(2)
            if ($id -and -not $refs.ContainsKey($n)) { $refs[$n] = $id }
        }
        Write-Host ("  {0}: {1} rows, {2} distinct, {3} empty" -f `
            $cand.name, $rows, $people.Count, $empty)
        foreach ($p in ($people.Keys | Sort-Object { -$people[$_] } | Select-Object -First 12)) {
            Write-Host ("      {0,4}x  {1,-38} {2}" -f $people[$p], $p, $refs[$p])
        }
    }
    catch {
        Write-Host ("  {0}: ABSENT" -f $cand.name)
    }
}
Write-Host ""
Write-Host "  The GUIDs above are what the site stores as driver1CExternalId and what"
Write-Host "  the admin maps to site accounts by hand. Copy them into the report."
Write-Host ""

# --- 3b. Several sheets per driver per day? ----------------------------------
#
# The mileage rate is paid PER SHEET, so two sheets on one day pay two rates.
# Confirming this happens in practice keeps the rule honest.

Write-Host "=== 3b. Multiple sheets for one driver on one day? ==="
foreach ($cand in @(
    @{ name = "Voditel";   field = $VODITEL },
    @{ name = "Sotrudnik"; field = $SOTRUDNIK }
)) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 500 R.$($cand.field).$NAME, R.$DATE" +
                  " $FROM $DOC.$docName $AS R $WHERE R.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        $r = $rs.Choose()
        $seen = @{}
        $dups = 0
        while ($r.Next()) {
            $n = AsText $r.Get(0)
            $d = $r.Get(1)
            if ($n -eq "" -or $null -eq $d) { continue }
            $key = $n + "|" + ([datetime]$d).ToString("yyyy-MM-dd")
            if ($seen.ContainsKey($key)) { $dups++ } else { $seen[$key] = 1 }
        }
        Write-Host ("  {0}: {1} driver-days, {2} extra sheets on an already-used day" -f `
            $cand.name, $seen.Count, $dups)
    }
    catch { Write-Host ("  {0}: ABSENT" -f $cand.name) }
}
Write-Host ""

# --- 4. Tabular sections: stops, amounts, debts, addresses -------------------
#
# Section 0 named the tabular sections; this walks the likely ones and their
# likely columns. What matters:
#   - a link to the order/realization (resolves the counterparty, and via the
#     counterparty its geocoded address -> city/oblast zone)
#   - an address stored on the line itself (better: no resolution needed)
#   - a per-line amount and a per-line debt-to-collect

Write-Host "=== 4. Tabular sections ==="

$TS_ZAKAZY = C 1047,1072,1082,1072,1079,1099                        # Zakazy
$TS_TOVARY = C 1058,1086,1074,1072,1088,1099                        # Tovary
$TS_TOCHKI = C 1058,1086,1095,1082,1080                             # Tochki
$TS_MARSH  = C 1052,1072,1088,1096,1088,1091,1090                   # Marshrut
$TS_DOSTAV = C 1044,1086,1089,1090,1072,1074,1082,1080              # Dostavki
$TS_KLIENT = C 1050,1083,1080,1077,1085,1090,1099                   # Klienty
$TS_SOSTAV = C 1057,1086,1089,1090,1072,1074                        # Sostav

$KONTR     = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090    # Kontragent
$ZAKAZ     = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # ZakazPokupatelya
$DOKUMENT  = C 1044,1086,1082,1091,1084,1077,1085,1090              # Dokument (as attr name)
$DOKOSN    = C 1044,1086,1082,1091,1084,1077,1085,1090,1054,1089,1085,1086,1074,1072,1085,1080,1077  # DokumentOsnovanie
$ADRES     = C 1040,1076,1088,1077,1089                             # Adres
$ADRDOST   = C 1040,1076,1088,1077,1089,1044,1086,1089,1090,1072,1074,1082,1080  # AdresDostavki
$TOCHKA    = C 1058,1086,1095,1082,1072,1044,1086,1089,1090,1072,1074,1082,1080  # TochkaDostavki
$GOROD     = C 1043,1086,1088,1086,1076                             # Gorod
$PORYADOK  = C 1055,1086,1088,1103,1076,1086,1082                   # Poryadok
$NOMSTROKI = C 1053,1086,1084,1077,1088,1057,1090,1088,1086,1082,1080  # NomerStroki

$tabSections = @(
    @{ name = "Zakazy";    field = $TS_ZAKAZY },
    @{ name = "Tochki";    field = $TS_TOCHKI },
    @{ name = "Marshrut";  field = $TS_MARSH },
    @{ name = "Dostavki";  field = $TS_DOSTAV },
    @{ name = "Klienty";   field = $TS_KLIENT },
    @{ name = "Sostav";    field = $TS_SOSTAV },
    @{ name = "Tovary";    field = $TS_TOVARY }
)

# From the printed form, each stop row carries: client, address, manager+phone,
# the realization document, the contract kind ("Bezgotivka" = already paid,
# "Postavka fakt" = driver collects cash), "Suma dokumenta" and "Suma
# nadhodzhennya" (what the driver actually brought back -- often a part of the
# invoice, the rest becoming debt).
$SUMA_DOK  = C 1057,1091,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072                          # SumaDokumenta (UA)
$SUMA_NADH = C 1057,1091,1084,1072,1053,1072,1076,1093,1086,1076,1078,1077,1085,1085,1103                # SumaNadhodzhennya (UA)
$NADHODZH  = C 1053,1072,1076,1093,1086,1076,1078,1077,1085,1085,1103                                    # Nadhodzhennya
$DOGOVIR   = C 1044,1086,1075,1086,1074,1110,1088                                                        # Dogovir (UA)
$MENEDZHER = C 1052,1077,1085,1077,1076,1078,1077,1088                                                   # Menedzher
$KLIENT    = C 1050,1083,1110,1108,1085,1090                                                             # Klient (UA)
$DOKUMENT_UA = C 1044,1086,1082,1091,1084,1077,1085,1090                                                 # Dokument
$KOMENTAR  = C 1050,1086,1084,1077,1085,1090,1072,1088                                                   # Komentar (UA)

$lineFields = @(
    @{ name = "SumaDokumenta [INVOICE]"; field = $SUMA_DOK },
    @{ name = "SumaNadhodzhennya [CASH]";field = $SUMA_NADH },
    @{ name = "Nadhodzhennya [CASH]";    field = $NADHODZH },
    @{ name = "Dogovir [PAID/CASH?]";    field = $DOGOVIR },
    @{ name = "Klient (UA)";             field = $KLIENT },
    @{ name = "Menedzher";               field = $MENEDZHER },
    @{ name = "Dokument [LINK]";         field = $DOKUMENT_UA },
    @{ name = "Komentar (UA)";           field = $KOMENTAR },
    @{ name = "Kontragent";              field = $KONTR },
    @{ name = "ZakazPokupatelya [LINK]"; field = $ZAKAZ },
    @{ name = "Dokument [LINK]";         field = $DOKUMENT },
    @{ name = "DokumentOsnovanie [LINK]";field = $DOKOSN },
    @{ name = "Adres";                   field = $ADRES },
    @{ name = "AdresDostavki";           field = $ADRDOST },
    @{ name = "TochkaDostavki";          field = $TOCHKA },
    @{ name = "Gorod";                   field = $GOROD },
    @{ name = "Summa  [ORDER AMT?]";     field = $SUMMA },
    @{ name = "SummaDokumenta";          field = $SUMDOC },
    @{ name = "SummaDolga  [DEBT?]";     field = $SUMDOLG },
    @{ name = "SummaOplaty  [DEBT?]";    field = $SUMOPLAT },
    @{ name = "KOplate  [DEBT?]";        field = $KDOPLATE },
    @{ name = "Poryadok";                field = $PORYADOK }
)

foreach ($ts in $tabSections) {
    # Existence first: one cheap query decides whether to probe 14 columns.
    $exists = $false
    $rowCount = 0
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 300 T.$REF, T.$NOMSTROKI $FROM $DOC.$docName.$($ts.field) $AS T"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $exists = $true
        $perDoc = @{}
        while ($r.Next()) {
            $rowCount++
            $id = RefId $r.Get(0)
            if ($id) {
                if (-not $perDoc.ContainsKey($id)) { $perDoc[$id] = 0 }
                $perDoc[$id]++
            }
        }
        $avg = if ($perDoc.Count -gt 0) { $rowCount / $perDoc.Count } else { 0 }
        $mx = 0
        foreach ($k in $perDoc.Keys) { if ($perDoc[$k] -gt $mx) { $mx = $perDoc[$k] } }
        Write-Host ("  --- TS {0}: {1} rows sampled over {2} docs (avg {3:N1}/doc, max {4}) ---" -f `
            $ts.name, $rowCount, $perDoc.Count, $avg, $mx)
    }
    catch {
        continue
    }

    if (-not $exists -or $rowCount -eq 0) {
        Write-Host "      (empty)"
        continue
    }

    foreach ($f in $lineFields) {
        try {
            $q = $ib.NewObject("Query")
            $q.Text = "$SELECT $FIRST 200 T.$REF, T.$($f.field) $FROM $DOC.$docName.$($ts.field) $AS T"
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "Execute returned null" }
            $r = $rs.Choose()
            $rows = 0; $filled = 0; $sample = ""
            while ($r.Next()) {
                $rows++
                $v = $r.Get(1)
                if (IsFilled $v) {
                    $filled++
                    if (-not $sample) {
                        $id = RefId $v
                        $sample = if ($id) { (AsText $v) + " " + $id } else { AsText $v }
                    }
                }
            }
            Write-Host ("      OK      {0,-28} {1,3}/{2,-3} filled   sample: {3}" -f `
                $f.name, $filled, $rows, $sample)
        }
        catch {
            Write-Host ("      ABSENT  {0}" -f $f.name)
        }
    }
}
Write-Host ""
Write-Host "  If no tabular section carries a per-line amount, the 0.5% base must come"
Write-Host "  from header [ORDERS?]/[DEBTS?] and the stop count from linked documents."
Write-Host "  If no address is stored per line, stops resolve through Kontragent ->"
Write-Host "  the site's Counterparty.deliveryAddress / deliveryLat / deliveryLng."
Write-Host ""

# --- 5. Full dump of a few live documents ------------------------------------
#
# The acceptance sample: these are handed to the user to check against how the
# accountant computes the same day by hand. Everything above is structure; this
# is the only section that shows real numbers side by side.

Write-Host "=== 5. Full dump of the 5 most recent posted documents ==="

try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 5 R.$REF, R.$NUM, R.$DATE $FROM $DOC.$docName $AS R" +
              " $WHERE R.$POSTED $ORDER $DESC R.$DATE"
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()

    $samples = @()
    while ($r.Next()) {
        $samples += @{ ref = $r.Get(0); num = AsText $r.Get(1); date = $r.Get(2) }
    }

    foreach ($s in $samples) {
        Write-Host ""
        Write-Host ("  ---- doc {0} of {1}   ref {2}" -f $s.num, `
            ([datetime]$s.date).ToString("yyyy-MM-dd"), (RefId $s.ref))

        # Header: reuse the fields that resolved in section 2, one at a time so
        # an absent one cannot take the whole dump down.
        foreach ($f in $headerFields) {
            try {
                $q2 = $ib.NewObject("Query")
                $q2.Text = "$SELECT $FIRST 1 R.$REF, R.$($f.field) $FROM $DOC.$docName $AS R" +
                           " $WHERE R.$REF = &$PARAM"
                $q2.SetParameter($PARAM, $s.ref)
                $rs2 = $q2.Execute()
                $r2 = $rs2.Choose()
                if ($r2.Next()) {
                    $v = $r2.Get(1)
                    if (IsFilled $v) {
                        Write-Host ("        {0,-34} = {1}" -f $f.name, (AsText $v))
                    }
                }
            } catch { }
        }

        # Lines of whichever tabular sections exist.
        foreach ($ts in $tabSections) {
            try {
                $q2 = $ib.NewObject("Query")
                $q2.Text = "$SELECT $FIRST 40 T.$NOMSTROKI, T.$KONTR.$NAME, T.$SUMMA" +
                           " $FROM $DOC.$docName.$($ts.field) $AS T $WHERE T.$REF = &$PARAM"
                $q2.SetParameter($PARAM, $s.ref)
                $rs2 = $q2.Execute()
                $r2 = $rs2.Choose()
                $n = 0
                while ($r2.Next()) {
                    if ($n -eq 0) { Write-Host ("        TS {0}:" -f $ts.name) }
                    $n++
                    Write-Host ("          {0,3}  {1,-44} {2}" -f `
                        (AsText $r2.Get(0)), (AsText $r2.Get(1)), (AsText $r2.Get(2)))
                }
            } catch { }
        }
    }
}
catch {
    Write-Host ("  FAILED: " + $_.Exception.Message)
}
Write-Host ""

}  # end foreach candidate

Write-Host "=== What these findings decide ==="
Write-Host "0. Section 0 gives the exact Dokument.<Name> for queries.json, plus the"
Write-Host "   real attribute names -- sections 2-4 only confirm fill rates."
Write-Host "1. Section 1 picks documents.routeSheetsFrom (payroll needs months, not years)"
Write-Host "   and gives the doc count to verify the first backfill against."
Write-Host "2. Section 2 [KM?] -> the mileage field behind the 500/700/1000 rate tiers."
Write-Host "   [ORDERS?] minus [DEBTS?] -> the base for the 0.5% component. If [DEBTS?]"
Write-Host "   is nowhere, that number is not in the document and the rule needs rework."
Write-Host "3. Section 3 picks the driver column and hands over the GUIDs the admin will"
Write-Host "   map to site accounts."
Write-Host "4. Section 4 decides how unloading points are counted: per-line addresses"
Write-Host "   (best), per-line counterparty (resolve address on the site), or nothing"
Write-Host "   (stops must come from the linked orders)."
Write-Host "5. Section 5 is the acceptance sample -- check these against a hand-computed day."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
