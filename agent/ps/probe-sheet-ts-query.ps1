# Tabular section of MarshrutnyjLyst -- found by QUERY, not by GetObject().
#
# Where the previous probe ended: the sheet is found reliably (1706 scanned,
# 000001820 matched, all three query shapes), but GetObject() answers
# "Object reference not set" on this build -- so Metadata() is unreachable and
# the section name cannot be asked for directly.
#
# So we go back to querying, the way production already reads tabular sections
# (queries.json -> orderItemsSince: "IZ Dokument.ZakazPokupatelya.Tovary KAK T").
#
# The old sweep probe-sheet-ts-clean.ps1 did try names this way and reported
# none -- but it read columns by NAME, which THROWS on this build
# ("Could not find member", proven two runs ago). A section could have existed
# and still been reported absent. This probe:
#
#   * reads positionally with Get(index)                -- the documented rule
#   * counts a name as FOUND only if rows actually come back
#   * on a hit, dumps the first rows so the columns are visible
#   * uses a fresh connection per name: a failed Execute() poisons the session
#
# The photo of sheet 000001820 shows 32 rows with Dokument / Kontragent /
# Adresa / Suma, so the data is definitely there under SOME name.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-ts-query.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-ts-query.txt 2>&1

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
$T      = C 1058                                                   # T
$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst

# Ukrainian first (the document name itself is Ukrainian: MarshrutnИйЛист),
# then Russian, then Latin. The header mixes both -- Voditel is Russian while
# Kilometrazh is Ukrainian -- so neither language can be assumed.
$candidates = @(
    @{ l = "Tovary_RU";       n = (C 1058,1086,1074,1072,1088,1099) },
    @{ l = "Tovary_UA";       n = (C 1058,1086,1074,1072,1088,1080) },
    @{ l = "Sostav_RU";       n = (C 1057,1086,1089,1090,1072,1074) },
    @{ l = "Sklad_UA";        n = (C 1057,1082,1083,1072,1076) },
    @{ l = "Dokumenty_RU";    n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1099) },
    @{ l = "Dokumenty_UA";    n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1080) },
    @{ l = "Dokumenti_UA2";   n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1110) },
    @{ l = "Klienty_RU";      n = (C 1050,1083,1080,1077,1085,1090,1099) },
    @{ l = "Klienty_UA";      n = (C 1050,1083,1110,1108,1085,1090,1080) },
    @{ l = "Kliienty_UA2";    n = (C 1050,1083,1080,1108,1085,1090,1080) },
    @{ l = "Kontragenty_RU";  n = (C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090,1099) },
    @{ l = "Kontragenty_UA";  n = (C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090,1080) },
    @{ l = "Realizacii_RU";   n = (C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1080) },
    @{ l = "Realizacii_UA";   n = (C 1056,1077,1072,1083,1110,1079,1072,1094,1110,1111) },
    @{ l = "Marshrut";        n = (C 1052,1072,1088,1096,1088,1091,1090) },
    @{ l = "MarshrutnyjList"; n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090) },
    @{ l = "Tochki_RU";       n = (C 1058,1086,1095,1082,1080) },
    @{ l = "Adresa_RU";       n = (C 1040,1076,1088,1077,1089,1072) },
    @{ l = "Adresy_UA";       n = (C 1040,1076,1088,1077,1089,1080) },
    @{ l = "Dostavka";        n = (C 1044,1086,1089,1090,1072,1074,1082,1072) },
    @{ l = "Rozvozka";        n = (C 1056,1086,1079,1074,1086,1079,1082,1072) },
    @{ l = "Spysok_UA";       n = (C 1057,1087,1080,1089,1086,1082) },
    @{ l = "Stroki_RU";       n = (C 1057,1090,1088,1086,1082,1080) },
    @{ l = "Reestr_UA";       n = (C 1056,1077,1108,1089,1090,1088) },
    @{ l = "Zakazy_RU";       n = (C 1047,1072,1082,1072,1079,1099) },
    @{ l = "Zamovlennya_UA";  n = (C 1047,1072,1084,1086,1074,1083,1077,1085,1085,1103) },
    @{ l = "Nakladnye_RU";    n = (C 1053,1072,1082,1083,1072,1076,1085,1099,1077) },
    @{ l = "Nakladni_UA";     n = (C 1053,1072,1082,1083,1072,1076,1085,1110) },
    @{ l = "Stranica1";       n = (C 1057,1090,1088,1072,1085,1080,1094,1072) + "1" },
    @{ l = "Tovary_lat";      n = "Tovary" },
    @{ l = "Klienty_lat";     n = "Klienty" },
    @{ l = "Stroki_lat";      n = "Stroki" }
)

Write-Host "=== Tabular sections of Dokument.MarshrutnyjLyst, probed by QUERY ==="
Write-Host "Reading positionally (Get(index)) -- named access throws on this build,"
Write-Host "which is why the earlier sweep reported everything as absent."
Write-Host ""

$found = @()

foreach ($cand in $candidates) {
    $connector = $null
    $ib = $null
    try {
        $connector = New-Object -ComObject V82.COMConnector
        $ib = $connector.Connect($connString)

        $q = $ib.NewObject("Query")
        # Only Ssylka + NomerStroki: every tabular section has both, so this
        # tests the NAME without guessing any column.
        $q.Text = "$SELECT $FIRST 50 $T.$REF, $T.$NOMSTR $FROM $DOC.$RS.$($cand.n) $AS $T"

        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $sel = $rs.Choose()
        if ($null -eq $sel) { throw "Choose returned null" }

        $rows = 0
        while ($sel.Next()) { $rows++ }

        # A section that exists but is empty everywhere is not the one from the
        # photo, so the row count is the real signal -- not mere existence.
        Write-Host ("  FOUND   {0,-18} rows sampled: {1}" -f $cand.l, $rows)
        $found += @{ label = $cand.l; name = $cand.n; rows = $rows }
    }
    catch {
        $msg = $_.Exception.Message.Split("`n")[0]
        Write-Host ("  absent  {0,-18} {1}" -f $cand.l, $msg)
    }
    finally {
        if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
        if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
        [GC]::Collect()
    }
}

Write-Host ""

if ($found.Count -eq 0) {
    Write-Host "No tabular section answered under any of these names."
    Write-Host "Next step is the print form: it builds the very table seen in the"
    Write-Host "photo, so its data source names the section for us."
    return
}

# For each hit with rows, widen the SELECT one column at a time. Column names
# are unknown, so we ask for a generous slice by position: whatever the section
# holds, Get(i) prints it.
Write-Host "=== Columns of the sections that returned rows ==="

foreach ($f in $found) {
    if ($f.rows -le 0) { continue }

    Write-Host ""
    Write-Host ("--- {0} ({1})" -f $f.label, $f.name)

    $connector = $null
    $ib = $null
    try {
        $connector = New-Object -ComObject V82.COMConnector
        $ib = $connector.Connect($connString)

        # T.* is the only way to see unknown columns: with no metadata access
        # and no column names, a star select is what reveals the shape.
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 5 $T.* $FROM $DOC.$RS.$($f.name) $AS $T"

        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }

        # Column names live on the result set itself -- available even when the
        # document object is not.
        try {
            $cols = $rs.Columns
            Write-Host ("    columns: {0}" -f $cols.Count())
            for ($c = 0; $c -lt $cols.Count(); $c++) {
                Write-Host ("      [{0}] {1}" -f $c, ([string]$cols.Get($c).Name))
            }
        } catch {
            Write-Host "    (column names unavailable; values follow)"
        }

        $sel = $rs.Choose()
        $n = 0
        while ($sel.Next() -and $n -lt 5) {
            $n++
            $vals = @()
            for ($c = 0; $c -lt 12; $c++) {
                try { $vals += ("[{0}] {1}" -f $c, [string]$sel.Get($c)) } catch { break }
            }
            Write-Host ("    row {0}: {1}" -f $n, ($vals -join " | "))
        }
    }
    catch {
        Write-Host ("    star-select failed: " + $_.Exception.Message.Split("`n")[0])
    }
    finally {
        if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
        if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
        [GC]::Collect()
    }
}

Write-Host ""
Write-Host "Sections with rows are the ingest target: their column names go into"
Write-Host "queries.json so the exchange carries stops, not just the header."
