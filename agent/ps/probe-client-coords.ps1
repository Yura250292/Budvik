# READ ONLY. Probe: does 1C hold GPS coordinates of customers?
#
# Why: a sales rep says he set the exact point of a customer by hand
# ("Skalotska, Bibrka"), yet the site has only the geocoder's city-centre
# guess, and in the site database there is no trace of a manual pin for that
# customer at all. The reps work in the mobile-trade app ("Impuls" = Mobi-C),
# which exchanges with 1C directly -- such apps usually store the outlet's
# GPS in 1C. Our sync never reads coordinates from 1C, so if they are there,
# every point the reps ever set in Impuls is invisible to the site.
#
# What it looks for, three independent ways (each works without the others):
#   1) metadata sweep: any attribute / dimension / resource whose name looks
#      like latitude, longitude, coordinates, GPS, geolocation -- in catalogs,
#      information registers, documents (metadata may be null through COM on
#      this build; then this part says so and the others still run);
#   2) the columns of the Counterparties catalog, taken from a query result;
#   3) the UT 2.3 "additional properties" (ChartOfCharacteristicTypes
#      ObjectProperties + InformationRegister ObjectPropertyValues) and the
#      ContactInformation register -- where mobile-trade apps usually put them.
# For whatever it finds it prints how many records are filled and the values
# for the three Skalotska cards (codes 000001222, 000003664, 000003425).
#
# Nothing is written to 1C: only Query.Execute() over SELECT texts and
# reading metadata names.
#
# Run with 32-bit PowerShell on the 1C server:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-client-coords.ps1
# The output is also saved next to the script as probe-client-coords.txt.

[CmdletBinding()]
param([string] $ConfigPath)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
try { Start-Transcript -Path (Join-Path $scriptDir "probe-client-coords.txt") -Force | Out-Null } catch { }

function Section($t) { Write-Host ""; Write-Host ("=== " + $t + " ===") }
function Done { Write-Host ""; Write-Host "Nothing was written to 1C."; try { Stop-Transcript | Out-Null } catch { } }

Write-Host "READ ONLY probe: customer coordinates in 1C"
Write-Host ("Time:     " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host ("Computer: " + $env:COMPUTERNAME)

# --- config & connection -----------------------------------------------------
if (-not $ConfigPath) {
    $candidates = @(
        (Join-Path $scriptDir "config.json"),
        (Join-Path $env:USERPROFILE "budvik-agent\config.json"),
        "C:\Users\fedyshyn\budvik-agent\config.json",
        "C:\budvik-agent\config.json"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { $ConfigPath = $c; break } }
    if (-not $ConfigPath) { $ConfigPath = $candidates[0] }
}
Write-Host ("config.json: " + $ConfigPath)
if (-not (Test-Path $ConfigPath)) { Write-Host "config.json not found."; Done; exit 0 }

$ErrorActionPreference = "Stop"
$config = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$connString = 'Srvr="' + $config.oneC.server + '";Ref="' + $config.oneC.base +
              '";Usr="' + $config.oneC.user + '";Pwd="' + $config.oneC.password + '";'
Section "Connecting to the base (read-only)"
try {
    $connector = New-Object -ComObject V82.COMConnector
    $ib = $connector.Connect($connString)
    Write-Host "  connected"
} catch {
    Write-Host ("  CONNECT FAILED: " + $_.Exception.Message); Done; exit 1
}

# Cyrillic must not live in this file as literals (PS5 reads .ps1 with the
# OEM codepage), so every 1C name is assembled from char codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C @(1042,1067,1041,1056,1040,1058,1068)                  # VYBRAT
$FIRST  = C @(1055,1045,1056,1042,1067,1045)                       # PERVYE
$FROM   = C @(1048,1047)                                           # IZ
$AS     = C @(1050,1040,1050)                                      # KAK
$WHERE  = C @(1043,1044,1045)                                      # GDE
$IN     = C @(1042)                                                # V
$AND    = C @(1048)                                                # I
$COUNT  = C @(1050,1054,1051,1048,1063,1045,1057,1058,1042,1054)   # KOLICHESTVO
$CAT    = C @(1057,1087,1088,1072,1074,1086,1095,1085,1080,1082)   # Spravochnik
$IREG   = C @(1056,1077,1075,1080,1089,1090,1088,1057,1074,1077,1076,1077,1085,1080,1081)   # RegistrSvedeniy
$PVH    = C @(1055,1083,1072,1085,1042,1080,1076,1086,1074,1061,1072,1088,1072,1082,1090,1077,1088,1080,1089,1090,1080,1082)   # PlanVidovHarakteristik
$KONTR  = C @(1050,1086,1085,1090,1088,1072,1075,1077,1085,1090,1099)   # Kontragenty
$CODE   = C @(1050,1086,1076)                                      # Kod
$NAME   = C @(1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077)   # Naimenovanie
$REF    = C @(1057,1089,1099,1083,1082,1072)                       # Ssylka
$PROPS  = C @(1057,1074,1086,1081,1089,1090,1074,1072,1054,1073,1098,1077,1082,1090,1086,1074)   # SvoystvaObektov
$PVALS  = C @(1047,1085,1072,1095,1077,1085,1080,1103,1057,1074,1086,1081,1089,1090,1074,1054,1073,1098,1077,1082,1090,1086,1074)   # ZnacheniyaSvoystvObektov
$OBJ    = C @(1054,1073,1098,1077,1082,1090)                       # Obekt
$PROP   = C @(1057,1074,1086,1081,1089,1090,1074,1086)             # Svoystvo
$VAL    = C @(1047,1085,1072,1095,1077,1085,1080,1077)             # Znachenie
$CINFO  = C @(1050,1086,1085,1090,1072,1082,1090,1085,1072,1103,1048,1085,1092,1086,1088,1084,1072,1094,1080,1103)   # KontaktnayaInformaciya

# Name fragments that look like coordinates (matched case-insensitively).
$pattern = (@(
    (C @(1096,1080,1088,1086,1090)),                 # shirot
    (C @(1076,1086,1083,1075,1086,1090)),            # dolgot
    (C @(1076,1086,1074,1075,1086,1090)),            # dovgot (ukr)
    (C @(1082,1086,1086,1088,1076,1080,1085,1072,1090)),   # koordinat
    (C @(1075,1077,1086,1083,1086,1082)),            # geolok
    (C @(1075,1077,1086,1075,1088,1072,1092)),       # geograf
    "gps", "latit", "longit", "geo", "coord"
) -join "|")

$CODES = @("000001222", "000003664", "000003425")
$codesList = '"' + ($CODES -join '","') + '"'

function Q([string] $text) {
    $q = $ib.NewObject("Query"); $q.Text = $text; return $q.Execute()
}
function ColumnNames($res) {
    $names = @()
    $cols = $res.Columns
    for ($i = 0; $i -lt $cols.Count(); $i++) { $names += [string]$cols.Get($i).Name }
    return $names
}

# --- 1. Metadata sweep ---------------------------------------------------------
Section "1. Metadata sweep: attributes that look like coordinates"
$md = $null
try { $md = $ib.Metadata } catch { }
if ($null -eq $md) {
    Write-Host "  metadata is null through COM on this build -- skipping; parts 2 and 3 still run"
} else {
    $hitsMd = 0
    foreach ($kind in @("Catalogs", "InformationRegisters", "Documents", "ChartsOfCharacteristicTypes")) {
        try { $col = $md.$kind } catch { Write-Host ("  " + $kind + ": not readable"); continue }
        if ($null -eq $col) { continue }
        for ($i = 0; $i -lt $col.Count(); $i++) {
            $obj = $col.Get($i)
            $oname = [string]$obj.Name
            if ($oname -match $pattern) { Write-Host ("  >> {0}.{1} (the object name itself)" -f $kind, $oname); $hitsMd++ }
            foreach ($part in @("Attributes", "Dimensions", "Resources")) {
                $fields = $null
                try { $fields = $obj.$part } catch { }
                if ($null -eq $fields) { continue }
                for ($f = 0; $f -lt $fields.Count(); $f++) {
                    $fn = [string]$fields.Get($f).Name
                    if ($fn -match $pattern) { Write-Host ("  >> {0}.{1} : {2} {3}" -f $kind, $oname, $part, $fn); $hitsMd++ }
                }
            }
        }
    }
    Write-Host ("  metadata hits: " + $hitsMd)
}

# --- 2. Counterparties catalog: its columns and the three cards ---------------
Section "2. Counterparties catalog: columns, and the three Skalotska cards"
try {
    $res = Q ("$SELECT $FIRST 1 * $FROM $CAT.$KONTR")
    $cols = ColumnNames $res
    Write-Host ("  columns (" + $cols.Count + "): " + ($cols -join ", "))
    $coordCols = @($cols | Where-Object { $_ -match $pattern })
    Write-Host ("  columns that look like coordinates: " + ($(if ($coordCols.Count) { $coordCols -join ", " } else { "none" })))

    $sel = (Q ("$SELECT * $FROM $CAT.$KONTR $AS K $WHERE K.$CODE $IN ($codesList)")).Choose()
    while ($sel.Next()) {
        Write-Host ""
        for ($i = 0; $i -lt $cols.Count; $i++) {
            $v = ""
            try { $v = [string]$sel.Get($i) } catch { $v = "<unreadable>" }
            if ($v -and $v.Length -gt 120) { $v = $v.Substring(0, 120) + "..." }
            if ($v -ne "") { Write-Host ("    {0} = {1}" -f $cols[$i], $v) }
        }
    }
} catch { Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0]) }

# --- 3a. Additional properties (UT 2.3) ---------------------------------------
Section "3a. Additional properties: which of them look like coordinates"
$propNames = @()
try {
    $sel = (Q ("$SELECT P.$REF, P.$NAME $FROM $PVH.$PROPS $AS P")).Choose()
    $all = 0
    while ($sel.Next()) {
        $all++
        $n = [string]$sel.Get(1)
        if ($n -match $pattern) { $propNames += $n; Write-Host ("  >> property: " + $n) }
    }
    Write-Host ("  properties total: {0}, look like coordinates: {1}" -f $all, $propNames.Count)
} catch { Write-Host ("  not available: " + $_.Exception.Message.Split("`n")[0]) }

if ($propNames.Count -gt 0) {
    Section "3b. Values of those properties: how many customers, and the three cards"
    foreach ($pn in $propNames) {
        try {
            $pnq = $pn.Replace('"', '""')
            $cnt = (Q ("$SELECT $COUNT(*) $FROM $IREG.$PVALS $AS V $WHERE V.$PROP.$NAME = ""$pnq""")).Choose()
            if ($cnt.Next()) { Write-Host ("  '{0}': records {1}" -f $pn, $cnt.Get(0)) }
            $s = (Q ("$SELECT V.$OBJ.$CODE, V.$OBJ.$NAME, V.$VAL $FROM $IREG.$PVALS $AS V $WHERE V.$PROP.$NAME = ""$pnq"" $AND V.$OBJ.$CODE $IN ($codesList)")).Choose()
            while ($s.Next()) { Write-Host ("    {0} | {1} | {2}" -f $s.Get(0), $s.Get(1), $s.Get(2)) }
            $s = (Q ("$SELECT $FIRST 5 V.$OBJ, V.$VAL $FROM $IREG.$PVALS $AS V $WHERE V.$PROP.$NAME = ""$pnq""")).Choose()
            while ($s.Next()) { Write-Host ("    sample: {0} | {1}" -f $s.Get(0), $s.Get(1)) }
        } catch { Write-Host ("  '{0}': FAILED {1}" -f $pn, $_.Exception.Message.Split("`n")[0]) }
    }
}

# --- 3c. Contact information register ----------------------------------------
Section "3c. ContactInformation register: columns, and rows of the three cards"
try {
    $res = Q ("$SELECT $FIRST 1 * $FROM $IREG.$CINFO")
    $cols = ColumnNames $res
    Write-Host ("  columns: " + ($cols -join ", "))
    $sel = (Q ("$SELECT * $FROM $IREG.$CINFO $AS CI $WHERE CI.$OBJ.$CODE $IN ($codesList)")).Choose()
    $rows = 0
    while ($sel.Next()) {
        $rows++
        $line = @()
        for ($i = 0; $i -lt $cols.Count; $i++) {
            $v = ""; try { $v = [string]$sel.Get($i) } catch { }
            if ($v) { $line += ($cols[$i] + "=" + $v) }
        }
        Write-Host ("    " + ($line -join " | "))
    }
    Write-Host ("  rows for the three cards: " + $rows)
} catch { Write-Host ("  not available: " + $_.Exception.Message.Split("`n")[0]) }

Done
