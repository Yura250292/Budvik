# Find the route sheet by what the printed form tells us.
#
# The user photographed the actual document: "Marshrutnyi list No 00000001819",
# with a Voditel field, START and END ODOMETER boxes, and a table of stops
# (client, address, manager/phone, realization document + date, contract type,
# "Suma dokumenta", "Suma nadhodzhennya"). In 1C it lives under
# Dokumenty -> Prodazhi -> Marshrutnyi list.
#
# So the document exists and my sweep missed it. Two likely reasons, both
# covered here:
#
#   1. The metadata NAME differs from the printed title. "Marshrutnyi list" is
#      the synonym shown to users; the object could be named anything. But the
#      NUMBER is a fact we now have -- 00000001819 -- and any document whose
#      number matches is the right one. Section 2 uses that: for each candidate
#      name, ask for a document with THAT number. A hit is proof, not a guess.
#
#   2. Mileage is not a "Probeg" attribute but two odometer readings, which is
#      why probing for Probeg/Rasstoyanie found nothing. Section 3 looks for
#      spidometr-flavoured attribute names once the document is identified.
#
# Section 1 first retries the obvious names with the number filter, since a
# name that exists but whose earlier probe silently returned nothing would now
# be caught.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-route-by-number.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-route-number.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $Number = "00000001819"
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
Write-Host ("Looking for a document numbered {0} (from the printed form)" -f $Number)
Write-Host ""

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$PARAM  = C 1053,1086,1084                                         # Nom (parameter name)

# Candidate names, widest list yet. The printed title is "Marshrutnyi list", so
# those spellings come first; the rest cover common variations including the
# possibility that the object name is Latin.
$names = @(
    @{ l = "MarshrutnyiList";     n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1099,1081,1051,1080,1089,1090) },
    @{ l = "MarshrutniyList";     n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1110,1081,1051,1080,1089,1090) },   # Ukrainian i
    @{ l = "MarshrutnyjLyst";     n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090) },
    @{ l = "MarshrutnyiLyst_UA";  n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090) },
    @{ l = "MarshrutListt";       n = (C 1052,1072,1088,1096,1088,1091,1090,1051,1080,1089,1090) },
    @{ l = "MarshrutnListt";      n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1051,1080,1089,1090) },
    @{ l = "Marshrutnyi";         n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1099,1081) },
    @{ l = "MarshrutnyiList2";    n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1099,1081,1076,1083,1103,1042,1086,1076,1080,1090,1077,1083,1103) },
    @{ l = "MarshrutList";        n = (C 1052,1072,1088,1096,1088,1091,1090,1083,1080,1089,1090) },
    @{ l = "MarshListt";          n = (C 1052,1072,1088,1096,1051,1080,1089,1090) },
    @{ l = "MarshrutnyiListLat";  n = "MarshrutnyiList" },
    @{ l = "MarshrutniyListLat";  n = "MarshrutniyList" },
    @{ l = "RouteListLat";        n = "RouteList" },
    @{ l = "RouteSheetLat";       n = "RouteSheet" },
    @{ l = "MarshrutLat";         n = "Marshrut" },
    @{ l = "ML_Lat";              n = "ML" },
    @{ l = "MarshLat";            n = "Marsh" },
    @{ l = "DostavkaLat";         n = "Dostavka" },
    @{ l = "Dostavka_UA";         n = (C 1044,1086,1089,1090,1072,1074,1082,1072) },
    @{ l = "ListMarshrutnyi";     n = (C 1051,1080,1089,1090,1052,1072,1088,1096,1088,1091,1090,1085,1099,1081) },
    @{ l = "ZayavkaNaDostavku";   n = (C 1047,1072,1103,1074,1082,1072,1053,1072,1044,1086,1089,1090,1072,1074,1082,1091) },
    @{ l = "RozvezennyaUA";       n = (C 1056,1086,1079,1074,1077,1079,1077,1085,1085,1103) },
    @{ l = "Rozvozka";            n = (C 1056,1086,1079,1074,1086,1079,1082,1072) }
)

# --- 1. Which of these names exists at all? ---------------------------------

Write-Host "=== 1. Names that resolve ==="

$exists = @()

foreach ($d in $names) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 1 R.$REF, R.$NUM $FROM $DOC.$($d.n) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $has = $r.Next()
        $sampleNum = ""
        if ($has) { try { $sampleNum = ([string]$r.Get(1)).Trim() } catch { } }
        Write-Host ("  EXISTS  Dokument.{0,-22} {1}" -f $d.l,
            $(if ($has) { "sample number: $sampleNum" } else { "(no rows)" }))
        $exists += $d
    }
    catch { }
}

if ($exists.Count -eq 0) { Write-Host "  (none resolved)" }
Write-Host ""

# --- 2. Which one actually holds document number 00000001819? ---------------
#
# This is the decisive test: the number came off the printed form, so a match
# identifies the document beyond doubt.

Write-Host ("=== 2. Which document has number {0}? ===" -f $Number)

$winner = $null

foreach ($d in $exists) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 5 R.$REF, R.$NUM, R.$DATE $FROM $DOC.$($d.n) $AS R" +
                  " $WHERE R.$NUM = &$PARAM"
        $q.SetParameter($PARAM, $Number)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        if ($r.Next()) {
            $n = ([string]$r.Get(1)).Trim()
            $dt = ([string]$r.Get(2)).Trim()
            Write-Host ("  *** MATCH: Dokument.{0}  number {1}  dated {2}" -f $d.l, $n, $dt)
            if (-not $winner) { $winner = $d }
        }
    }
    catch { }
}

if (-not $winner) {
    Write-Host "  No document with that number among the names that resolved."
    Write-Host "  (The number may be padded differently -- the form shows 00000001819.)"
}
Write-Host ""

# --- 3. Odometer and driver attributes on the winning document --------------
#
# The printed form has "Nachalnyi spidometr" and "Kinceviy spidometr" boxes, so
# mileage is a DIFFERENCE of two readings -- which is exactly why probing for a
# single "Probeg" attribute found nothing anywhere.

if ($winner) {
    Write-Host ("=== 3. Attributes of Dokument.{0} ===" -f $winner.l)

    $attrs = @(
        @{ l = "Voditel";              n = (C 1042,1086,1076,1080,1090,1077,1083,1100) },
        @{ l = "Vodij_UA";             n = (C 1042,1086,1076,1110,1081) },
        @{ l = "SpidometrNachalnyi";   n = (C 1053,1072,1095,1072,1083,1100,1085,1099,1081,1057,1087,1080,1076,1086,1084,1077,1090,1088) },
        @{ l = "SpidometrPochatkovyi"; n = (C 1055,1086,1095,1072,1090,1082,1086,1074,1080,1081,1057,1087,1110,1076,1086,1084,1077,1090,1088) },
        @{ l = "SpidometrNach2";       n = (C 1057,1087,1080,1076,1086,1084,1077,1090,1088,1053,1072,1095,1072,1083,1100,1085,1099,1081) },
        @{ l = "SpidometrKonechnyi";   n = (C 1050,1086,1085,1077,1095,1085,1099,1081,1057,1087,1080,1076,1086,1084,1077,1090,1088) },
        @{ l = "SpidometrKincevyi";    n = (C 1050,1110,1085,1094,1077,1074,1080,1081,1057,1087,1110,1076,1086,1084,1077,1090,1088) },
        @{ l = "SpidometrKon2";        n = (C 1057,1087,1080,1076,1086,1084,1077,1090,1088,1050,1086,1085,1077,1095,1085,1099,1081) },
        @{ l = "SpidometrNa";          n = (C 1057,1087,1080,1076,1086,1084,1077,1090,1088) },
        @{ l = "Probeg";               n = (C 1055,1088,1086,1073,1077,1075) },
        @{ l = "Avtomobil";            n = (C 1040,1074,1090,1086,1084,1086,1073,1080,1083,1100) },
        @{ l = "Avto";                 n = (C 1040,1074,1090,1086) },
        @{ l = "Otvetstvennyi";        n = (C 1054,1090,1074,1077,1090,1089,1090,1074,1077,1085,1085,1099,1081) },
        @{ l = "Proveden";             n = (C 1055,1088,1086,1074,1077,1076,1077,1085) },
        @{ l = "Kommentarii";          n = (C 1050,1086,1084,1084,1077,1085,1090,1072,1088,1080,1081) },
        @{ l = "SummaDokumenta";       n = (C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072) }
    )

    foreach ($a in $attrs) {
        try {
            $q = $ib.NewObject("Query")
            $q.Text = "$SELECT $FIRST 30 R.$REF, R.$($a.n) $FROM $DOC.$($winner.n) $AS R"
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "null" }
            $r = $rs.Choose()
            $rows = 0
            $filled = 0
            $sample = ""
            while ($r.Next()) {
                $rows++
                $v = $r.Get(1)
                if ($null -eq $v) { continue }
                $txt = ([string]$v).Trim()
                if ($txt -eq "System.__ComObject") {
                    $filled++
                    if (-not $sample) { $sample = "(reference)" }
                }
                elseif ($txt -ne "" -and $txt -ne "0" -and $txt -ne "0,00" -and $txt -ne "False") {
                    $filled++
                    if (-not $sample) { $sample = $txt }
                }
            }
            Write-Host ("  OK      {0,-22} {1,2}/{2,-2} filled   {3}" -f $a.l, $filled, $rows, $sample)
        }
        catch {
            Write-Host ("  absent  {0}" -f $a.l)
        }
    }
    Write-Host ""

    # Tabular sections: the form shows a stop table, so one must exist.
    Write-Host "=== 4. Tabular sections ==="
    $tabs = @(
        @{ l = "Tovary";     n = (C 1058,1086,1074,1072,1088,1099) },
        @{ l = "Klienty";    n = (C 1050,1083,1080,1077,1085,1090,1099) },
        @{ l = "Dokumenty";  n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1099) },
        @{ l = "Tochki";     n = (C 1058,1086,1095,1082,1080) },
        @{ l = "Marshrut";   n = (C 1052,1072,1088,1096,1088,1091,1090) },
        @{ l = "Sostav";     n = (C 1057,1086,1089,1090,1072,1074) },
        @{ l = "Realizacii"; n = (C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1080) },
        @{ l = "Zakazy";     n = (C 1047,1072,1082,1072,1079,1099) },
        @{ l = "Adresa";     n = (C 1040,1076,1088,1077,1089,1072) }
    )
    $NOMSTR = C 1053,1086,1084,1077,1088,1057,1090,1088,1086,1082,1080  # NomerStroki
    foreach ($t in $tabs) {
        try {
            $q = $ib.NewObject("Query")
            $q.Text = "$SELECT $FIRST 50 T.$REF, T.$NOMSTR $FROM $DOC.$($winner.n).$($t.n) $AS T"
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "null" }
            $r = $rs.Choose()
            $n = 0
            while ($r.Next()) { $n++ }
            Write-Host ("  FOUND   TS {0,-14} {1} rows sampled" -f $t.l, $n)
        }
        catch {
            Write-Host ("  absent  TS {0}" -f $t.l)
        }
    }
}
else {
    Write-Host "=== 3-4 skipped: document not identified ==="
    Write-Host "In 1C open the route sheet, then use Vse funkcii / About the object"
    Write-Host "to read its metadata name, and rerun with -DocName."
}

Write-Host ""
Write-Host "Once the document and its attributes are known, the main probe runs with:"
Write-Host "  probe-route-sheets.ps1 -DocName <Name>"

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
