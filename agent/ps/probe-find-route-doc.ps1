# Wide scan: what is the route sheet actually called in this configuration?
#
# probe-route-sheets.ps1 tried nine likely document names and all nine came back
# absent, so the object exists under a name we have not guessed -- or it is not
# a Document at all (some configurations keep driver runs in a catalogue, or as
# a kind of a generic "task" document).
#
# $ib.Metadata is null through COM on this build, so the configuration cannot be
# enumerated. What CAN be done is ask about a name and see whether the query
# parser accepts it: an object that exists answers, one that does not throws.
# That turns discovery into a wide brute-force over plausible names -- which is
# cheap, because each probe is one "VYBRAT PERVYE 1" and costs nothing.
#
# Section 3 is the fallback that always works: it walks the document JOURNAL
# (Zhurnal Dokumentov), which lists every document type that has records,
# without needing to know any names in advance.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-find-route-doc.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-find-route.txt 2>&1

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

Write-Host "connecting..."
$connector = New-Object -ComObject V82.COMConnector
$ib = $connector.Connect($connString)
Write-Host "connected"
Write-Host ""

# This file must stay pure ASCII: PS5 reads .ps1 in the OEM codepage and mangles
# Cyrillic literals. Everything is built from char codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$CAT    = C 1057,1087,1088,1072,1074,1086,1095,1085,1080,1082      # Spravochnik
$JOURNAL= C 1046,1091,1088,1085,1072,1083,1044,1086,1082,1091,1084,1077,1085,1090,1086,1074  # ZhurnalDokumentov
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$DATE   = C 1044,1072,1090,1072                                    # Data
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie

function AsText($value) {
    if ($null -eq $value) { return "" }
    return ([string]$value).Trim()
}

# --- 1. Documents: wide name sweep -------------------------------------------
#
# Names are grouped by the idea behind them: the trip itself, the task to
# deliver, the shipment, and the generic "list/sheet" wordings. Latin names are
# included too -- some integrators name objects in Latin.

Write-Host "=== 1. Documents: which of these names exist? ==="

$docNames = @(
    # Marshrut* family
    @{ l = "MarshrutnyiList";        n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1099,1081,1051,1080,1089,1090) },
    @{ l = "MarshrutnyjList";        n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1086,1077,1047,1072,1076,1072,1085,1080,1077) },  # MarshrutnoeZadanie
    @{ l = "MarshrutDostavki";       n = (C 1052,1072,1088,1096,1088,1091,1090,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "MarshrutnyiList_";       n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1099,1081) },
    # Putevoi* family
    @{ l = "PutevoiList";            n = (C 1055,1091,1090,1077,1074,1086,1081,1051,1080,1089,1090) },
    @{ l = "PutListAvtomobilya";     n = (C 1055,1091,1090,1077,1074,1086,1081,1051,1080,1089,1090,1040,1074,1090,1086,1084,1086,1073,1080,1083,1103) },
    # Delivery / shipment
    @{ l = "Dostavka";               n = (C 1044,1086,1089,1090,1072,1074,1082,1072) },
    @{ l = "DostavkaTovarov";        n = (C 1044,1086,1089,1090,1072,1074,1082,1072,1058,1086,1074,1072,1088,1086,1074) },
    @{ l = "ZadanieNaDostavku";      n = (C 1047,1072,1076,1072,1085,1080,1077,1053,1072,1044,1086,1089,1090,1072,1074,1082,1091) },
    @{ l = "ZayavkaNaDostavku";      n = (C 1047,1072,1103,1074,1082,1072,1053,1072,1044,1086,1089,1090,1072,1074,1082,1091) },
    @{ l = "RasporyazhenieNaDostavku"; n = (C 1056,1072,1089,1087,1086,1088,1103,1078,1077,1085,1080,1077,1053,1072,1044,1086,1089,1090,1072,1074,1082,1091) },
    @{ l = "GrafikDostavki";         n = (C 1043,1088,1072,1092,1080,1082,1044,1086,1089,1090,1072,1074,1082,1080) },
    # Trip / run
    @{ l = "Reys";                   n = (C 1056,1077,1081,1089) },
    @{ l = "Poezdka";                n = (C 1055,1086,1077,1079,1076,1082,1072) },
    @{ l = "Perevozka";              n = (C 1055,1077,1088,1077,1074,1086,1079,1082,1072) },
    @{ l = "ZadanieNaPerevozku";     n = (C 1047,1072,1076,1072,1085,1080,1077,1053,1072,1055,1077,1088,1077,1074,1086,1079,1082,1091) },
    @{ l = "TransportnoeZadanie";    n = (C 1058,1088,1072,1085,1089,1087,1086,1088,1090,1085,1086,1077,1047,1072,1076,1072,1085,1080,1077) },
    @{ l = "TTN";                    n = (C 1058,1058,1053) },
    @{ l = "TovarnoTransportnaya";   n = (C 1058,1086,1074,1072,1088,1085,1086,1058,1088,1072,1085,1089,1087,1086,1088,1090,1085,1072,1103,1053,1072,1082,1083,1072,1076,1085,1072,1103) },
    # Expedition / driver
    @{ l = "ZadanieEkspeditoru";     n = (C 1047,1072,1076,1072,1085,1080,1077,1069,1082,1089,1087,1077,1076,1080,1090,1086,1088,1091) },
    @{ l = "ListVoditelya";          n = (C 1051,1080,1089,1090,1042,1086,1076,1080,1090,1077,1083,1103) },
    @{ l = "ZadanieVoditelyu";       n = (C 1047,1072,1076,1072,1085,1080,1077,1042,1086,1076,1080,1090,1077,1083,1102) },
    @{ l = "OtchetVoditelya";        n = (C 1054,1090,1095,1077,1090,1042,1086,1076,1080,1090,1077,1083,1103) },
    # Latin spellings used by some integrators
    @{ l = "RouteSheet";             n = "RouteSheet" },
    @{ l = "RouteList";              n = "RouteList" },
    @{ l = "Route";                  n = "Route" },
    @{ l = "DeliveryRoute";          n = "DeliveryRoute" },
    @{ l = "Delivery";               n = "Delivery" },
    @{ l = "Marshrut(lat)";          n = "Marshrut" },
    @{ l = "MarshrutniyList(lat)";   n = "MarshrutniyList" },
    @{ l = "PutList(lat)";           n = "PutList" }
)

$foundDocs = @()

foreach ($d in $docNames) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 1 R.$REF, R.$DATE $FROM $DOC.$($d.n) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $has = $r.Next()
        $when = if ($has) { AsText $r.Get(1) } else { "" }
        Write-Host ("  FOUND   Dokument.{0,-28} {1}" -f $d.l, $(if ($has) { "has rows, sample date $when" } else { "EMPTY" }))
        $foundDocs += $d
    }
    catch { }
}

if ($foundDocs.Count -eq 0) { Write-Host "  (none of these document names exists)" }
Write-Host ""

# --- 2. Catalogues -----------------------------------------------------------
#
# Some configurations keep routes as a catalogue (a fixed list of directions)
# and hang the daily run on a different object. Worth one cheap sweep.

Write-Host "=== 2. Catalogues with route-ish names ==="

$catNames = @(
    @{ l = "Marshruty";        n = (C 1052,1072,1088,1096,1088,1091,1090,1099) },
    @{ l = "Marshrut";         n = (C 1052,1072,1088,1096,1088,1091,1090) },
    @{ l = "MarshrutyDostavki";n = (C 1052,1072,1088,1096,1088,1091,1090,1099,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "Voditeli";         n = (C 1042,1086,1076,1080,1090,1077,1083,1080) },
    @{ l = "Avtomobili";       n = (C 1040,1074,1090,1086,1084,1086,1073,1080,1083,1080) },
    @{ l = "TransportnyeSredstva"; n = (C 1058,1088,1072,1085,1089,1087,1086,1088,1090,1085,1099,1077,1057,1088,1077,1076,1089,1090,1074,1072) },
    @{ l = "Ekspeditory";      n = (C 1069,1082,1089,1087,1077,1076,1080,1090,1086,1088,1099) },
    @{ l = "ZonyDostavki";     n = (C 1047,1086,1085,1099,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "AdresaDostavki";   n = (C 1040,1076,1088,1077,1089,1072,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "TochkiDostavki";   n = (C 1058,1086,1095,1082,1080,1044,1086,1089,1090,1072,1074,1082,1080) }
)

foreach ($c in $catNames) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 5 S.$REF, S.$NAME $FROM $CAT.$($c.n) $AS S"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $samples = @()
        while ($r.Next()) {
            $v = AsText $r.Get(1)
            if ($v) { $samples += $v }
        }
        Write-Host ("  FOUND   Spravochnik.{0,-24} samples: {1}" -f $c.l,
            $(if ($samples.Count) { ($samples -join " | ") } else { "(empty)" }))
    }
    catch { }
}
Write-Host ""

# --- 3. The document journal: what document types actually exist? ------------
#
# This is the section that does not depend on guessing at all. The standard
# journal "Dokumenty" (or any journal the configuration defines) exposes a Tip
# column naming the document type of every record. Reading distinct values of
# that column lists the real document types in use -- including custom ones.

Write-Host "=== 3. Document journal: distinct document types ==="

$journalNames = @(
    @{ l = "Dokumenty";  n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1099) },
    @{ l = "Obshchij";   n = (C 1054,1073,1097,1080,1081) },
    @{ l = "Prodazhi";   n = (C 1055,1088,1086,1076,1072,1078,1080) },
    @{ l = "Sklad";      n = (C 1057,1082,1083,1072,1076) }
)

$journalWorked = $false

foreach ($j in $journalNames) {
    try {
        # No date filter: a journal is cheap to scan and the first 4000 rows are
        # enough to see which document types exist.
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 4000 J.$REF, J.$DATE $FROM $JOURNAL.$($j.n) $AS J"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()

        # The type of a journal row is read from the reference itself: XMLType
        # names the metadata object, which is exactly what we are after.
        $types = @{}
        $n = 0
        while ($r.Next() -and $n -lt 4000) {
            $n++
            $ref = $r.Get(0)
            $t = ""
            try { $t = [string]$ib.XMLTypeOf($ref).TypeName } catch { }
            if (-not $t) { try { $t = [string]$ref.Metadata().Name } catch { } }
            if (-not $t) { continue }
            if (-not $types.ContainsKey($t)) { $types[$t] = 0 }
            $types[$t]++
        }

        if ($types.Count -gt 0) {
            $journalWorked = $true
            Write-Host ("  Journal '{0}': {1} rows sampled, {2} distinct types" -f $j.l, $n, $types.Count)
            foreach ($t in ($types.Keys | Sort-Object { -$types[$_] })) {
                Write-Host ("      {0,6}x  {1}" -f $types[$t], $t)
            }
            Write-Host ""
        }
    }
    catch { }
}

if (-not $journalWorked) {
    Write-Host "  (no journal could be read -- section 1/2 results are all we have)"
}
Write-Host ""

Write-Host "=== What to do with this ==="
Write-Host "If section 1 or 3 names the route sheet, rerun the main probe:"
Write-Host "  probe-route-sheets.ps1 -DocName <ExactName>"
Write-Host "If nothing here looks like a route sheet, the driver runs may not be"
Write-Host "kept in 1C as a document at all -- say so and we will plan around it."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
