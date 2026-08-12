# Dokument.MarshrutnyjLyst: the last two unknowns.
#
# Confirmed so far: the document exists (684 sheets over two years, 13-42 per
# month), Voditel is filled 100/100 and names ten real drivers with stable
# GUIDs. What is still missing:
#
#   1. THE TABULAR SECTION. None of the nine guessed names (Tovary, Klienty,
#      Zakazy, Tochki...) matched, yet the printed form clearly shows a stop
#      table. Section 1 sweeps a much wider list of Ukrainian and Russian
#      names. Without it there are no stops, no addresses and no per-line sums.
#
#   2. THE ODOMETER. The form has "Pochatkovyi spidometr" / "Kincevyi
#      spidometr" boxes, but no such header attribute exists -- and neither do
#      Probeg, Kilometrazh or Rasstoyanie. Either the boxes live in the tabular
#      part, or they are filled by hand on paper and never typed into 1C.
#      Section 2 brute-forces short attribute names to settle it.
#
# Section 3 then dumps one whole document -- header attributes discovered by
# section 2 plus every column of the tabular section found in section 1 -- so
# the mapping to the printed form can be checked line by line.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-route-details.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-route-details.txt 2>&1

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
$NOMSTR = C 1053,1086,1084,1077,1088,1057,1090,1088,1086,1082,1080 # NomerStroki
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS

# Confirmed name.
$RS = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst

# --- 1. Find the tabular section --------------------------------------------
#
# Ukrainian spellings first: the document name itself turned out to be
# Ukrainian, so its parts probably are too.

Write-Host "=== 1. Tabular sections: which name resolves? ==="

$tsNames = @(
    # Ukrainian
    @{ l = "Kliienty (UA)";      n = (C 1050,1083,1110,1108,1085,1090,1080) },
    @{ l = "Tovary (UA)";        n = (C 1058,1086,1074,1072,1088,1080) },
    @{ l = "Dokumenty (UA)";     n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1080) },
    @{ l = "Tochky (UA)";        n = (C 1058,1086,1095,1082,1080) },
    @{ l = "Adresy (UA)";        n = (C 1040,1076,1088,1077,1089,1080) },
    @{ l = "Realizacii (UA)";    n = (C 1056,1077,1072,1083,1110,1079,1072,1094,1110,1111) },
    @{ l = "Zamovlennya (UA)";   n = (C 1047,1072,1084,1086,1074,1083,1077,1085,1085,1103) },
    @{ l = "Marshrut (UA)";      n = (C 1052,1072,1088,1096,1088,1091,1090) },
    @{ l = "Sklad (UA)";         n = (C 1057,1082,1083,1072,1076) },
    @{ l = "Rozvantazhennya";    n = (C 1056,1086,1079,1074,1072,1085,1090,1072,1078,1077,1085,1085,1103) },
    @{ l = "Vygruzka";           n = (C 1042,1080,1075,1088,1091,1079,1082,1072) },
    @{ l = "Dostavka";           n = (C 1044,1086,1089,1090,1072,1074,1082,1072) },
    @{ l = "Dostavky (UA)";      n = (C 1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "Perelik";            n = (C 1055,1077,1088,1077,1083,1110,1082) },
    @{ l = "Spysok";             n = (C 1057,1087,1080,1089,1086,1082) },
    @{ l = "Reestr";             n = (C 1056,1077,1108,1089,1090,1088) },
    @{ l = "Nakladni";           n = (C 1053,1072,1082,1083,1072,1076,1085,1110) },
    @{ l = "Sostav (UA)";        n = (C 1057,1082,1083,1072,1076) },
    # Russian
    @{ l = "Klienty (RU)";       n = (C 1050,1083,1080,1077,1085,1090,1099) },
    @{ l = "Tovary (RU)";        n = (C 1058,1086,1074,1072,1088,1099) },
    @{ l = "Dokumenty (RU)";     n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1099) },
    @{ l = "Tochki (RU)";        n = (C 1058,1086,1095,1082,1080) },
    @{ l = "Adresa (RU)";        n = (C 1040,1076,1088,1077,1089,1072) },
    @{ l = "Zakazy (RU)";        n = (C 1047,1072,1082,1072,1079,1099) },
    @{ l = "Sostav (RU)";        n = (C 1057,1086,1089,1090,1072,1074) },
    @{ l = "Stroki";             n = (C 1057,1090,1088,1086,1082,1080) },
    @{ l = "Otgruzka";           n = (C 1054,1090,1075,1088,1091,1079,1082,1072) },
    # Latin
    @{ l = "Tovary (lat)";       n = "Tovary" },
    @{ l = "Klienty (lat)";      n = "Klienty" },
    @{ l = "Stops (lat)";        n = "Stops" },
    @{ l = "Rows (lat)";         n = "Rows" }
)

$foundTS = @()

foreach ($t in $tsNames) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 100 T.$REF, T.$NOMSTR $FROM $DOC.$RS.$($t.n) $AS T"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $rows = 0
        $docs = @{}
        while ($r.Next()) {
            $rows++
            try {
                $id = [string]$ib.XMLString($r.Get(0))
                if ($id) { $docs[$id] = 1 }
            } catch { }
        }
        $avg = if ($docs.Count -gt 0) { [Math]::Round($rows / $docs.Count, 1) } else { 0 }
        Write-Host ("  FOUND   TS {0,-22} {1} rows over {2} docs (avg {3}/doc)" -f `
            $t.l, $rows, $docs.Count, $avg)
        $foundTS += $t
    }
    catch { }
}

if ($foundTS.Count -eq 0) {
    Write-Host "  (no tabular section found -- the stop table may be built by the"
    Write-Host "   print form from linked documents rather than stored in the doc)"
}
Write-Host ""

# --- 2. Header attributes: short brute force --------------------------------
#
# Voditel was found; everything else was missed. Since the document speaks
# Ukrainian, retry the odometer and money fields in more spellings, plus the
# plainest possible names.

Write-Host "=== 2. More header attributes ==="

$attrs = @(
    @{ l = "Avto (UA)";          n = (C 1040,1074,1090,1086) },
    @{ l = "Avtomobil (UA)";     n = (C 1040,1074,1090,1086,1084,1086,1073,1110,1083,1100) },
    @{ l = "Mashyna (UA)";       n = (C 1052,1072,1096,1080,1085,1072) },
    @{ l = "Transport";          n = (C 1058,1088,1072,1085,1089,1087,1086,1088,1090) },
    @{ l = "Spidometr1";         n = (C 1057,1087,1110,1076,1086,1084,1077,1090,1088,49) },
    @{ l = "Spidometr2";         n = (C 1057,1087,1110,1076,1086,1084,1077,1090,1088,50) },
    @{ l = "SpidometrPoch";      n = (C 1057,1087,1110,1076,1086,1084,1077,1090,1088,1055,1086,1095) },
    @{ l = "SpidometrKin";       n = (C 1057,1087,1110,1076,1086,1084,1077,1090,1088,1050,1110,1085) },
    @{ l = "PochSpidometr";      n = (C 1055,1086,1095,1057,1087,1110,1076,1086,1084,1077,1090,1088) },
    @{ l = "KinSpidometr";       n = (C 1050,1110,1085,1057,1087,1110,1076,1086,1084,1077,1090,1088) },
    @{ l = "Pochatok";           n = (C 1055,1086,1095,1072,1090,1086,1082) },
    @{ l = "Kinec";              n = (C 1050,1110,1085,1077,1094,1100) },
    @{ l = "Probig (UA)";        n = (C 1055,1088,1086,1073,1110,1075) },
    @{ l = "Kilometrazh (UA)";   n = (C 1050,1110,1083,1086,1084,1077,1090,1088,1072,1078) },
    @{ l = "Vidstan (UA)";       n = (C 1042,1110,1076,1089,1090,1072,1085,1100) },
    @{ l = "Suma (UA)";          n = (C 1057,1091,1084,1072) },
    @{ l = "SumaDok (UA)";       n = (C 1057,1091,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072) },
    @{ l = "Komentar (UA)";      n = (C 1050,1086,1084,1077,1085,1090,1072,1088) },
    @{ l = "Prymitka";           n = (C 1055,1088,1080,1084,1110,1090,1082,1072) },
    @{ l = "Organizaciya";       n = (C 1054,1088,1075,1072,1085,1110,1079,1072,1094,1110,1103) },
    @{ l = "Organizaciya (RU)";  n = (C 1054,1088,1075,1072,1085,1080,1079,1072,1094,1080,1103) },
    @{ l = "Status";             n = (C 1057,1090,1072,1090,1091,1089) },
    @{ l = "Data (control)";     n = $DATE },
    @{ l = "Nomer (control)";    n = $NUM }
)

foreach ($a in $attrs) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 40 R.$REF, R.$($a.n) $FROM $DOC.$RS $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $rows = 0
        $filled = 0
        $sample = ""
        $nums = @()
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
                $d = 0.0
                if ([double]::TryParse($txt, [ref] $d)) { $nums += $d }
            }
        }
        $range = ""
        if ($nums.Count -gt 2) {
            $mn = ($nums | Measure-Object -Minimum).Minimum
            $mx = ($nums | Measure-Object -Maximum).Maximum
            $range = ("  min={0:N0} max={1:N0}" -f $mn, $mx)
        }
        Write-Host ("  OK      {0,-20} {1,2}/{2,-2} filled   {3}{4}" -f $a.l, $filled, $rows, $sample, $range)
    }
    catch {
        Write-Host ("  absent  {0}" -f $a.l)
    }
}
Write-Host ""

# --- 3. Dump one recent document --------------------------------------------
#
# The acceptance sample: this is what gets compared against the paper form.

Write-Host "=== 3. One recent sheet, in full ==="

$sampleRef = $null
$sampleNum = ""
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 1 R.$REF, R.$NUM, R.$DATE $FROM $DOC.$RS $AS R" +
              " $WHERE R.$POSTED $ORDER $DESC R.$DATE"
    $rs = $q.Execute()
    $r = $rs.Choose()
    if ($r.Next()) {
        $sampleRef = $r.Get(0)
        $sampleNum = ([string]$r.Get(1)).Trim()
        Write-Host ("  Sheet {0} dated {1}" -f $sampleNum, ([string]$r.Get(2)).Trim())
    }
} catch {
    Write-Host ("  could not fetch a sample: " + $_.Exception.Message.Split("`n")[0])
}

# Every column of every tabular section that section 1 found.
if ($sampleRef -and $foundTS.Count -gt 0) {
    $lineCols = @(
        @{ l = "Kliient";      n = (C 1050,1083,1110,1108,1085,1090) },
        @{ l = "Kontragent";   n = (C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090) },
        @{ l = "Adresa";       n = (C 1040,1076,1088,1077,1089,1072) },
        @{ l = "Adres";        n = (C 1040,1076,1088,1077,1089) },
        @{ l = "Dokument";     n = (C 1044,1086,1082,1091,1084,1077,1085,1090) },
        @{ l = "Menedzher";    n = (C 1052,1077,1085,1077,1076,1078,1077,1088) },
        @{ l = "Telefon";      n = (C 1058,1077,1083,1077,1092,1086,1085) },
        @{ l = "Dogovir";      n = (C 1044,1086,1075,1086,1074,1110,1088) },
        @{ l = "Dogovor";      n = (C 1044,1086,1075,1086,1074,1086,1088) },
        @{ l = "Suma";         n = (C 1057,1091,1084,1072) },
        @{ l = "SumaDokumenta";n = (C 1057,1091,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072) },
        @{ l = "SumaNadhodzh"; n = (C 1057,1091,1084,1072,1053,1072,1076,1093,1086,1076,1078,1077,1085,1085,1103) },
        @{ l = "Nadhodzhennya";n = (C 1053,1072,1076,1093,1086,1076,1078,1077,1085,1085,1103) },
        @{ l = "Oplata";       n = (C 1054,1087,1083,1072,1090,1072) },
        @{ l = "Komentar";     n = (C 1050,1086,1084,1077,1085,1090,1072,1088) },
        @{ l = "Prymitka";     n = (C 1055,1088,1080,1084,1110,1090,1082,1072) }
    )

    foreach ($ts in $foundTS) {
        Write-Host ""
        Write-Host ("  --- TS {0}: which columns exist? ---" -f $ts.l)
        foreach ($col in $lineCols) {
            try {
                $q = $ib.NewObject("Query")
                $q.Text = "$SELECT $FIRST 20 T.$NOMSTR, T.$($col.n) $FROM $DOC.$RS.$($ts.n) $AS T" +
                          " $WHERE T.$REF = &$PARAM"
                $q.SetParameter($PARAM, $sampleRef)
                $rs = $q.Execute()
                if ($null -eq $rs) { throw "null" }
                $r = $rs.Choose()
                $vals = @()
                while ($r.Next()) {
                    $v = $r.Get(1)
                    if ($null -eq $v) { continue }
                    $txt = ([string]$v).Trim()
                    if ($txt -and $txt -ne "System.__ComObject") { $vals += $txt }
                    elseif ($txt -eq "System.__ComObject") { $vals += "(ref)" }
                }
                $shown = if ($vals.Count -gt 4) { ($vals[0..3] -join " | ") + " ..." } else { ($vals -join " | ") }
                Write-Host ("      OK      {0,-16} {1}" -f $col.l, $shown)
            }
            catch {
                Write-Host ("      absent  {0}" -f $col.l)
            }
        }
    }
}

Write-Host ""
Write-Host "=== What this settles ==="
Write-Host "Section 1: the tabular section name -> stops, addresses, per-line sums."
Write-Host "Section 2: whether the odometer is stored in 1C at all. If every"
Write-Host "  spidometr variant is absent, the boxes on the form are filled by hand"
Write-Host "  and mileage must come from somewhere else (driver app / Google Maps)."
Write-Host "Section 3: the sample to check against the paper sheet."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
