# Last hypothesis: is delivery info kept as ATTRIBUTES of the order?
#
# Everything found so far says the configuration has no transport subsystem:
# no route-sheet document among ~50 names tried, and no Voditeli / Avtomobili /
# Marshruty catalogues (all three throw, while FizicheskieLica and Polzovateli
# read fine -- so absence here is real, not another silent failure).
#
# One possibility remains before concluding the data is not in 1C: delivery may
# be recorded ON the order itself -- a driver attribute, a delivery date, an
# address, a route field. Plenty of configurations do exactly that instead of
# adding a document.
#
# This probes ZakazPokupatelya and RealizaciyaTovarovUslug attribute by
# attribute, each in its own try/catch, and reports fill rates. An attribute
# that exists but is empty everywhere is as useless as one that does not exist,
# so both numbers matter.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-order-delivery-attrs.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-order-attrs.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Rows = 200
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
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$DATE   = C 1044,1072,1090,1072                                    # Data
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS

$ZAKAZ  = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # ZakazPokupatelya
$REALIZ = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug

$since = (Get-Date).AddMonths(-6)

# Delivery-flavoured attribute names. Grouped by what they would tell us:
# who drove, when, where to, and how far.
$attrs = @(
    # who
    @{ l = "Voditel";            n = (C 1042,1086,1076,1080,1090,1077,1083,1100) },
    @{ l = "Ekspeditor";         n = (C 1069,1082,1089,1087,1077,1076,1080,1090,1086,1088) },
    @{ l = "Perevozchik";        n = (C 1055,1077,1088,1077,1074,1086,1079,1095,1080,1082) },
    @{ l = "Avtomobil";          n = (C 1040,1074,1090,1086,1084,1086,1073,1080,1083,1100) },
    @{ l = "TransportnoeSredstvo"; n = (C 1058,1088,1072,1085,1089,1087,1086,1088,1090,1085,1086,1077,1057,1088,1077,1076,1089,1090,1074,1086) },
    # when
    @{ l = "DataDostavki";       n = (C 1044,1072,1090,1072,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "DataOtgruzki";       n = (C 1044,1072,1090,1072,1054,1090,1075,1088,1091,1079,1082,1080) },
    @{ l = "VremyaDostavki";     n = (C 1042,1088,1077,1084,1103,1044,1086,1089,1090,1072,1074,1082,1080) },
    # where
    @{ l = "AdresDostavki";      n = (C 1040,1076,1088,1077,1089,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "Adres";              n = (C 1040,1076,1088,1077,1089) },
    @{ l = "Gorod";              n = (C 1043,1086,1088,1086,1076) },
    @{ l = "Marshrut";           n = (C 1052,1072,1088,1096,1088,1091,1090) },
    @{ l = "ZonaDostavki";       n = (C 1047,1086,1085,1072,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "TochkaDostavki";     n = (C 1058,1086,1095,1082,1072,1044,1086,1089,1090,1072,1074,1082,1080) },
    # how far / how much
    @{ l = "Rasstoyanie";        n = (C 1056,1072,1089,1089,1090,1086,1103,1085,1080,1077) },
    @{ l = "Probeg";             n = (C 1055,1088,1086,1073,1077,1075) },
    @{ l = "StoimostDostavki";   n = (C 1057,1090,1086,1080,1084,1086,1089,1090,1100,1044,1086,1089,1090,1072,1074,1082,1080) },
    # how
    @{ l = "SposobDostavki";     n = (C 1057,1087,1086,1089,1086,1073,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "VidDostavki";        n = (C 1042,1080,1076,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "Dostavka";           n = (C 1044,1086,1089,1090,1072,1074,1082,1072) },
    @{ l = "Kommentarii";        n = (C 1050,1086,1084,1084,1077,1085,1090,1072,1088,1080,1081) }
)

foreach ($docDef in @(
    @{ l = "ZakazPokupatelya";        n = $ZAKAZ },
    @{ l = "RealizaciyaTovarovUslug"; n = $REALIZ }
)) {
    Write-Host ("=== Dokument.{0}: delivery attributes ===" -f $docDef.l)

    foreach ($a in $attrs) {
        try {
            # Inline query: a helper that builds and returns one yields null here.
            $q = $ib.NewObject("Query")
            $q.Text = "$SELECT $FIRST $Rows R.$REF, R.$($a.n) $FROM $DOC.$($docDef.n) $AS R" +
                      " $WHERE R.$DATE >= &$PARAM"
            $q.SetParameter($PARAM, $since)
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
                # A COM object means a non-empty reference; a blank GUID would
                # have come back as an object too, so this over-counts slightly
                # -- good enough to tell "always empty" from "actually used".
                $isFilled = $false
                if ($txt -eq "System.__ComObject") {
                    $isFilled = $true
                    if (-not $sample) { $sample = "(reference)" }
                }
                elseif ($txt -ne "" -and $txt -ne "0" -and $txt -ne "0,00" -and
                        $txt -ne "False" -and $txt -notmatch '^01/01/0001') {
                    $isFilled = $true
                    if (-not $sample) { $sample = $txt }
                }
                if ($isFilled) { $filled++ }
            }
            Write-Host ("  OK      {0,-22} {1,3}/{2,-3} filled   {3}" -f $a.l, $filled, $rows, $sample)
        }
        catch {
            Write-Host ("  absent  {0}" -f $a.l)
        }
    }
    Write-Host ""
}

Write-Host "=== Verdict ==="
Write-Host "An attribute with a high fill rate is a real source we can sync."
Write-Host "If Voditel/Probeg/AdresDostavki are absent or always empty, delivery is"
Write-Host "  simply not recorded in this database, and the route sheets the drivers"
Write-Host "  use are made somewhere else (printed form, Excel, another program)."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
