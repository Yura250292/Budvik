# Probe: is there any warranty / service accounting in this 1C base?
#
# UT 2.3 for Ukraine has no service module, so the working hypothesis is that
# warranty is handled physically -- goods are moved onto the "Remonty" or "Brak"
# warehouses and tracked in someone's head or on paper. This probe either
# confirms that or finds the real mechanism.
#
# Three independent angles, because a negative from one alone proves nothing:
#   - the service-looking warehouses and what actually moves them
#   - candidate service documents, by name
#   - serial numbers, without which per-item warranty is impossible anyway
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-warranty.ps1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Months = 12
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
$NOT    = C 1053,1045                                              # NE
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$SPR    = C 1057,1087,1088,1072,1074,1086,1095,1085,1080,1082      # Spravochnik
$REG    = C 1056,1077,1075,1080,1089,1090,1088,1053,1072,1082,1086,1087,1083,1077,1085,1080,1103  # RegistrNakopleniya

$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$DELMARK= C 1055,1086,1084,1077,1090,1082,1072,1059,1076,1072,1083,1077,1085,1080,1103  # PometkaUdaleniya
$PERIOD = C 1055,1077,1088,1080,1086,1076                          # Period
$REGISTRAR = C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088  # Registrator
$SKLADY = C 1057,1082,1083,1072,1076,1099                          # Sklady
$SKLAD  = C 1057,1082,1083,1072,1076                               # Sklad
$NOMENKL= C 1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1072  # Nomenklatura
$KOLVO  = C 1050,1086,1083,1080,1095,1077,1089,1090,1074,1086      # Kolichestvo
$TOVSKLAD = C 1058,1086,1074,1072,1088,1099,1053,1072,1057,1082,1083,1072,1076,1072,1093  # TovaryNaSkladah
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS

$since = (Get-Date).AddMonths(-$Months)

function AsText($value) {
    if ($null -eq $value) { return "" }
    return ([string]$value).Trim()
}

function RefId($value) {
    if ($null -eq $value) { return $null }
    try { return [string]$ib.XMLString($value) } catch { return $null }
}

# --- 1. Service-looking warehouses -------------------------------------------
#
# Matching is done in PS, not in the query: LIKE with Cyrillic patterns through
# COM is one more thing that can fail silently, and the warehouse list is tiny.

Write-Host "=== 1. Warehouses that look like service/defect storage ==="

# Substrings, uppercase Cyrillic. Both spellings where Ukrainian and Russian
# differ: the base is Ukrainian but the configuration is a Russian original, so
# warehouse names are a mix of the two.
$patterns = @(
    (C 1056,1045,1052,1054,1053,1058),                # REMONT
    (C 1041,1056,1040,1050),                          # BRAK
    (C 1055,1045,1056,1045,1054,1062),                # PEREOC
    (C 1057,1045,1056,1042,1048,1057),                # SERVIS (ru)
    (C 1057,1045,1056,1042,1030,1057),                # SERVIS (ua, with I)
    (C 1043,1040,1056,1040,1053,1058),                # GARANT
    (C 1059,1062,1030,1053,1050,1040),                # UCINKA (defect, ua)
    (C 1053,1045,1050,1054,1053,1044,1048,1062)       # NEKONDIC
)

$serviceWarehouses = @{}
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT S.$REF, S.$NAME, S.$DELMARK $FROM $SPR.$SKLADY $AS S"
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()
    $all = 0
    while ($r.Next()) {
        $all++
        $nm = AsText $r.Get(1)
        $up = $nm.ToUpper()
        foreach ($p in $patterns) {
            if ($up.Contains($p)) {
                $id = RefId $r.Get(0)
                $serviceWarehouses[$id] = $nm
                $del = if ([bool]$r.Get(2)) { " [deleted]" } else { "" }
                Write-Host ("  MATCH  {0}{1}" -f $nm, $del)
                break
            }
        }
    }
    Write-Host ("  ({0} warehouses total, {1} matched)" -f $all, $serviceWarehouses.Count)
}
catch {
    Write-Host ("FAILED: " + $_.Exception.Message)
}
Write-Host ""

# --- 2. What actually moves those warehouses ---------------------------------
#
# A warehouse that exists but has had no movement in a year is a leftover, not a
# process. Raw register rows are read and filtered in PS: the virtual .Oboroty
# table with parameters is exactly the shape that failed for the debt register.

Write-Host ("=== 2. Movements on those warehouses, last {0} months ===" -f $Months)

if ($serviceWarehouses.Count -eq 0) {
    Write-Host "  (no service-looking warehouses found -- nothing to measure)"
}
else {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT D.$SKLAD, D.$NOMENKL, D.$KOLVO, D.$REGISTRAR, D.$PERIOD" +
                  " $FROM $REG.$TOVSKLAD $AS D $WHERE D.$PERIOD >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()

        $stats = @{}
        $scanned = 0
        while ($r.Next()) {
            $scanned++
            $wid = RefId $r.Get(0)
            if (-not $wid -or -not $serviceWarehouses.ContainsKey($wid)) { continue }

            $wname = $serviceWarehouses[$wid]
            if (-not $stats.ContainsKey($wname)) {
                $stats[$wname] = @{ rows = 0; qty = 0.0; docs = @{}; items = @{} }
            }
            $stats[$wname].rows++

            $qty = $r.Get(2)
            if ($null -ne $qty) { $stats[$wname].qty += [double]$qty }

            # Registrar type is what names the process: the document kind sits in
            # the XML ref string, e.g. "...PeremeshchenieTovarov...".
            $regId = RefId $r.Get(3)
            $kind = if ($regId -and $regId -match 'ref#([A-Za-z0-9_.]+)') { $Matches[1] } else { "<unknown>" }
            if (-not $stats[$wname].docs.ContainsKey($kind)) { $stats[$wname].docs[$kind] = 0 }
            $stats[$wname].docs[$kind]++

            $iid = RefId $r.Get(1)
            if ($iid) { $stats[$wname].items[$iid] = 1 }
        }

        Write-Host ("  (scanned {0} register rows)" -f $scanned)
        if ($stats.Count -eq 0) {
            Write-Host "  NO MOVEMENTS on any service warehouse in this window."
            Write-Host "  => these warehouses are dead leftovers, not a live process."
        }
        foreach ($w in ($stats.Keys | Sort-Object { -$stats[$_].rows })) {
            Write-Host ("  {0}: {1} rows, {2:N2} units net, {3} distinct products" -f `
                $w, $stats[$w].rows, $stats[$w].qty, $stats[$w].items.Count)
            foreach ($k in ($stats[$w].docs.Keys | Sort-Object { -$stats[$w].docs[$_] })) {
                Write-Host ("      {0,5}x  by {1}" -f $stats[$w].docs[$k], $k)
            }
        }
    }
    catch {
        Write-Host ("FAILED: " + $_.Exception.Message)
        Write-Host "  (if this failed, report it -- the fallback is a narrower date window)"
    }
}
Write-Host ""

# --- 3. Candidate service documents ------------------------------------------
#
# Existence only. A name that resolves means the configuration has the object;
# whether it is used is the row count next to it.

Write-Host "=== 3. Candidate service/quality documents ==="

$candidates = @(
    @{ name = "KorrektirovkaKachestvaTovarov"; field = (C 1050,1086,1088,1088,1077,1082,1090,1080,1088,1086,1074,1082,1072,1050,1072,1095,1077,1089,1090,1074,1072,1058,1086,1074,1072,1088,1086,1074) },
    @{ name = "PeremeshchenieTovarov";         field = (C 1055,1077,1088,1077,1084,1077,1097,1077,1085,1080,1077,1058,1086,1074,1072,1088,1086,1074) },
    @{ name = "VnutrenniiZakaz";               field = (C 1042,1085,1091,1090,1088,1077,1085,1085,1080,1081,1047,1072,1082,1072,1079) },
    @{ name = "ZayavkaNaRemont";               field = (C 1047,1072,1103,1074,1082,1072,1053,1072,1056,1077,1084,1086,1085,1090) },
    @{ name = "PriemNaObsluzhivanie";          field = (C 1055,1088,1080,1077,1084,1053,1072,1054,1073,1089,1083,1091,1078,1080,1074,1072,1085,1080,1077) },
    @{ name = "VydachaIzObsluzhivaniya";       field = (C 1042,1099,1076,1072,1095,1072,1048,1079,1054,1073,1089,1083,1091,1078,1080,1074,1072,1085,1080,1103) },
    @{ name = "VozvratTovarovPostavshchiku";   field = (C 1042,1086,1079,1074,1088,1072,1090,1058,1086,1074,1072,1088,1086,1074,1055,1086,1089,1090,1072,1074,1097,1080,1082,1091) },
    @{ name = "SpisanieTovarov";               field = (C 1057,1087,1080,1089,1072,1085,1080,1077,1058,1086,1074,1072,1088,1086,1074) }
)

$DATE = C 1044,1072,1090,1072                                      # Data

foreach ($c in $candidates) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT D.$REF, D.$DATE $FROM $DOC.$($c.field) $AS D $WHERE D.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $n = 0
        while ($r.Next()) { $n++ }
        Write-Host ("OK      {0,-32} {1} docs in last {2} months" -f $c.name, $n, $Months)
    }
    catch {
        Write-Host ("ABSENT  {0}" -f $c.name)
    }
}
Write-Host ""

# --- 4. Serial numbers -------------------------------------------------------
#
# Per-item warranty ("this exact drill, sold on this date") is impossible
# without serials. If the reference is empty, the answer to the warranty
# question is settled regardless of anything else.

Write-Host "=== 4. Serial numbers ==="

$SERII   = C 1057,1077,1088,1080,1080,1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1099  # SeriiNomenklatury
$SERIYA  = C 1057,1077,1088,1080,1103,1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1099  # SeriyaNomenklatury
$REALIZ  = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug
$GOODS   = C 1058,1086,1074,1072,1088,1099                          # Tovary

# Two spellings: an ABSENT on one name alone would wrongly read as "no serials".
$SERII_ALT = C 1057,1077,1088,1080,1080                             # Serii

foreach ($cat in @(
    @{ name = "SeriiNomenklatury"; field = $SERII },
    @{ name = "Serii";             field = $SERII_ALT }
)) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT S.$REF, S.$NAME $FROM $SPR.$($cat.field) $AS S"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $n = 0
        while ($r.Next()) { $n++ }
        Write-Host ("OK      Spravochnik.{0}: {1} entries" -f $cat.name, $n)
        if ($n -eq 0) {
            Write-Host "        => empty: per-item warranty tracking does not exist in 1C."
        }
    }
    catch {
        Write-Host ("ABSENT  Spravochnik.{0}" -f $cat.name)
    }
}

try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 200 T.$REF, T.$SERIYA $FROM $DOC.$REALIZ.$GOODS $AS T"
    $rs = $q.Execute()
    $r = $rs.Choose()
    $rows = 0
    $filled = 0
    while ($r.Next()) {
        $rows++
        $id = RefId $r.Get(1)
        if ($id -and $id -notmatch '^\{?[0-9a-fA-F-]*0{8}-0{4}-0{4}-0{4}-0{12}') { $filled++ }
    }
    Write-Host ("OK      SeriyaNomenklatury on realization lines: {0}/{1} filled" -f $filled, $rows)
}
catch {
    Write-Host "ABSENT  SeriyaNomenklatury on realization lines"
}
Write-Host ""

Write-Host "=== Reading the result ==="
Write-Host "Expected outcome: no service documents, empty serials, and the"
Write-Host "'Remonty'/'Brak' warehouses moved only by PeremeshchenieTovarov or"
Write-Host "SpisanieTovarov. That means warranty is a physical process with no"
Write-Host "record in 1C -- the site can only surface those warehouse balances,"
Write-Host "which it already imports as LocationStock."
Write-Host "If instead a service document shows a real document count, stop and"
Write-Host "design a proper read for it."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
