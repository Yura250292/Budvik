# Sanity check: is the name-sweep method itself working?
#
# The wide sweep came back empty on ALL three sections -- including catalogues
# like Avtomobili and Voditeli, and including the document journal. Everything
# being absent at once is more likely to mean the METHOD is broken than that the
# configuration has none of those objects.
#
# So this script probes names that are KNOWN to exist, because the live exchange
# reads them every five minutes (see queries.json):
#     Dokument.ZakazPokupatelya, Dokument.RealizaciyaTovarovUslug,
#     Spravochnik.Kontragenty, Spravochnik.Nomenklatura
#
# If these come back "absent" too, the sweep is lying and the real problem is in
# how the query text is assembled -- most likely the Cyrillic built from char
# codes, or the alias syntax. If they come back "found", the sweep works and the
# route sheet genuinely is not among the names tried.
#
# Section 2 then prints the exact query text as hex so any encoding damage is
# visible rather than guessed at.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-name-sweep-sanity.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-sanity.txt 2>&1

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
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$CAT    = C 1057,1087,1088,1072,1074,1086,1095,1085,1080,1082      # Spravochnik
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$DATE   = C 1044,1072,1090,1072                                    # Data
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie

# Known-good names, taken from queries.json (the live exchange reads these).
$ZAKAZ    = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # ZakazPokupatelya
$REALIZ   = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug
$KONTRAG  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090,1099  # Kontragenty
$NOMENKL  = C 1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1072  # Nomenklatura

Write-Host "=== 1. Known-good names: does the sweep find what certainly exists? ==="

foreach ($t in @(
    @{ kind = $DOC; kindLabel = "Dokument";    label = "ZakazPokupatelya";        name = $ZAKAZ;   col = $DATE },
    @{ kind = $DOC; kindLabel = "Dokument";    label = "RealizaciyaTovarovUslug"; name = $REALIZ;  col = $DATE },
    @{ kind = $CAT; kindLabel = "Spravochnik"; label = "Kontragenty";             name = $KONTRAG; col = $NAME },
    @{ kind = $CAT; kindLabel = "Spravochnik"; label = "Nomenklatura";            name = $NOMENKL; col = $NAME }
)) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 1 R.$REF, R.$($t.col) $FROM $($t.kind).$($t.name) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $has = $r.Next()
        $sample = if ($has) { ([string]$r.Get(1)).Trim() } else { "(no rows)" }
        Write-Host ("  FOUND   {0}.{1,-26} sample: {2}" -f $t.kindLabel, $t.label, $sample)
    }
    catch {
        Write-Host ("  ABSENT  {0}.{1,-26} <-- IMPOSSIBLE: {2}" -f $t.kindLabel, $t.label, $_.Exception.Message)
    }
}
Write-Host ""
Write-Host "  If any line above says ABSENT, the sweep method is broken -- not the"
Write-Host "  configuration. Section 2 then shows where the query text got damaged."
Write-Host ""

# --- 2. Show the assembled query text ---------------------------------------
#
# Printing the text is not enough: a mangled Cyrillic letter still LOOKS like a
# letter in the console. Hex makes the damage explicit -- every Cyrillic char
# must be in the 0410-044F range, and anything in 003F (question mark) means the
# codepage ate it.

Write-Host "=== 2. Query text integrity ==="

$sampleText = "$SELECT $FIRST 1 R.$REF, R.$DATE $FROM $DOC.$ZAKAZ $AS R"
Write-Host ("  text: {0}" -f $sampleText)
$hex = ($sampleText.ToCharArray() | ForEach-Object { "{0:X4}" -f [int]$_ }) -join " "
Write-Host ("  hex : {0}" -f $hex)
Write-Host ""
Write-Host "  Every Cyrillic character must land in 0410-044F. A 003F (?) means"
Write-Host "  PowerShell replaced it -- that would explain every name looking absent."
Write-Host ""

# --- 3. Does Execute() throw, or return null, on a name that truly does not exist?
#
# The sweep treats "throws" as absent. If a bad name instead returns an empty
# result set without throwing, every probe would look successful -- and if it
# throws in a way the catch does not see, every probe looks absent. Pin it down.

Write-Host "=== 3. Behaviour on a deliberately fake name ==="

$FAKE = C 1053,1077,1057,1091,1097,1077,1089,1090,1074,1091,1077,1090  # NeSushchestvuet
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 1 R.$REF $FROM $DOC.$FAKE $AS R"
    $rs = $q.Execute()
    if ($null -eq $rs) {
        Write-Host "  Execute() returned NULL for a fake name (does not throw)."
    } else {
        Write-Host "  Execute() SUCCEEDED for a fake name -- absence cannot be detected this way!"
    }
}
catch {
    Write-Host ("  Execute() threw for a fake name, as expected: {0}" -f
        $_.Exception.Message.Split("`n")[0])
}
Write-Host ""

Write-Host "=== Verdict ==="
Write-Host "Section 1 all FOUND + section 3 throws  => sweep is sound, the route"
Write-Host "  sheet is simply not among the names tried; we need its real name."
Write-Host "Section 1 any ABSENT                    => sweep is broken; fix that first."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
