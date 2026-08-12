# The tabular section of MarshrutnyjLyst -- clean run, fresh connection per probe.
#
# Hard lesson from the last three probes: on this build a failed Execute()
# poisons the session, and every later query answers with the same
# "Object reference not set" -- so a long probe reports false "absent" for
# everything after its first failure. That is why RealizaciyaTovarovUslug
# appeared to have a MarshrutnyjLyst attribute (40/40) in one probe and not in
# another: the 40/40 came before a failure, the "no attr" after one.
#
# Conclusion: realizations do NOT point at the sheet. The stops must therefore
# live INSIDE the sheet, in a tabular section whose name we have not hit yet.
#
# This script reconnects before every single probe. Slower, but each answer is
# independent and trustworthy -- which, after today, matters more than speed.
#
# It sweeps tabular-section names in Ukrainian, Russian and Latin. For each hit
# it prints the row count so a real section is distinguishable from an empty one.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-ts-clean.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-ts-clean.txt 2>&1

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
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NOMSTR = C 1053,1086,1084,1077,1088,1057,1090,1088,1086,1082,1080 # NomerStroki
$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst

# Candidate tabular-section names. The document itself is spelled in Ukrainian,
# so Ukrainian forms come first, but the attribute inside it (Voditel) is
# Russian -- this configuration mixes both, so neither can be assumed.
$candidates = @(
    @{ l = "Klienty_UA";      n = (C 1050,1083,1110,1108,1085,1090,1080) },
    @{ l = "Kliienty_UA2";    n = (C 1050,1083,1080,1108,1085,1090,1080) },
    @{ l = "Klienty_RU";      n = (C 1050,1083,1080,1077,1085,1090,1099) },
    @{ l = "Tovary_RU";       n = (C 1058,1086,1074,1072,1088,1099) },
    @{ l = "Tovary_UA";       n = (C 1058,1086,1074,1072,1088,1080) },
    @{ l = "Dokumenty_RU";    n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1099) },
    @{ l = "Dokumenty_UA";    n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1080) },
    @{ l = "Realizacii_RU";   n = (C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1080) },
    @{ l = "Realizacii_UA";   n = (C 1056,1077,1072,1083,1110,1079,1072,1094,1110,1111) },
    @{ l = "Nakladni_UA";     n = (C 1053,1072,1082,1083,1072,1076,1085,1110) },
    @{ l = "Nakladnye_RU";    n = (C 1053,1072,1082,1083,1072,1076,1085,1099,1077) },
    @{ l = "Tochki_RU";       n = (C 1058,1086,1095,1082,1080) },
    @{ l = "Adresy_UA";       n = (C 1040,1076,1088,1077,1089,1080) },
    @{ l = "Adresa_RU";       n = (C 1040,1076,1088,1077,1089,1072) },
    @{ l = "Sostav_RU";       n = (C 1057,1086,1089,1090,1072,1074) },
    @{ l = "Sklad_UA";        n = (C 1057,1082,1083,1072,1076) },
    @{ l = "Zamovlennya_UA";  n = (C 1047,1072,1084,1086,1074,1083,1077,1085,1085,1103) },
    @{ l = "Zakazy_RU";       n = (C 1047,1072,1082,1072,1079,1099) },
    @{ l = "Marshrut";        n = (C 1052,1072,1088,1096,1088,1091,1090) },
    @{ l = "Dostavka";        n = (C 1044,1086,1089,1090,1072,1074,1082,1072) },
    @{ l = "Dostavky_UA";     n = (C 1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "Rozvozka";        n = (C 1056,1086,1079,1074,1086,1079,1082,1072) },
    @{ l = "Spysok_UA";       n = (C 1057,1087,1080,1089,1086,1082) },
    @{ l = "Perelik_UA";      n = (C 1055,1077,1088,1077,1083,1110,1082) },
    @{ l = "Reestr_UA";       n = (C 1056,1077,1108,1089,1090,1088) },
    @{ l = "Stroki_RU";       n = (C 1057,1090,1088,1086,1082,1080) },
    @{ l = "Ryadky_UA";       n = (C 1056,1103,1076,1082,1080) },
    @{ l = "Tovary_lat";      n = "Tovary" },
    @{ l = "Klienty_lat";     n = "Klienty" },
    @{ l = "Stops_lat";       n = "Stops" },
    @{ l = "Lines_lat";       n = "Lines" }
)

Write-Host "Fresh connection per probe: a failed query poisons the whole session"
Write-Host "on this build, so batching them would produce false negatives."
Write-Host ""
Write-Host "=== Tabular sections of Dokument.MarshrutnyjLyst ==="

$found = @()

foreach ($cand in $candidates) {
    $connector = $null
    $ib = $null
    try {
        $connector = New-Object -ComObject V82.COMConnector
        $ib = $connector.Connect($connString)

        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 200 T.$REF, T.$NOMSTR $FROM $DOC.$RS.$($cand.n) $AS T"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()

        $rows = 0
        while ($r.Next()) { $rows++ }

        Write-Host ("  FOUND   {0,-18} {1} rows sampled" -f $cand.l, $rows)
        $found += @{ label = $cand.l; name = $cand.n; rows = $rows }
    }
    catch {
        Write-Host ("  absent  {0}" -f $cand.l)
    }
    finally {
        if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
        if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
        [GC]::Collect()
    }
}

Write-Host ""

if ($found.Count -eq 0) {
    Write-Host "No tabular section exists under any of these names."
    Write-Host ""
    Write-Host "That leaves one explanation: the print form gathers rows by querying"
    Write-Host "realizations by DRIVER and DATE, not by any stored link. We can do the"
    Write-Host "same -- realizations whose responsible person is the sheet's driver, on"
    Write-Host "the sheet's date. Slightly less exact than a link, but reproducible."
    Write-Host ""
    Write-Host "To be certain, in 1C open sheet 1817 and look at the form on screen:"
    Write-Host "is the client list an editable table inside the document, or does it"
    Write-Host "appear only when you press Print?"
} else {
    Write-Host ("{0} tabular section(s) found. Columns come next." -f $found.Count)
    foreach ($f in $found) {
        Write-Host ("  * {0}  ({1} rows)" -f $f.label, $f.rows)
    }
}

Write-Host ""
Write-Host "Reminder of what is already settled and does NOT need reprobing:"
Write-Host "  Dokument.MarshrutnyjLyst exists, 684 sheets, Voditel filled 100/100,"
Write-Host "  ten drivers with stable GUIDs, Kilometrazh filled only 2/40."
