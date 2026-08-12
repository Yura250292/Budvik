# List EVERY document type that has records, without guessing any names.
#
# The sanity check proved the name sweep works (known objects are found, fake
# ones throw), so the route sheet really is named something we have not tried.
# Guessing more names is a losing game -- 30 attempts already missed.
#
# This asks the database to name its own documents instead. Two independent
# routes, because either one alone can come up short:
#
#   1. ACCUMULATION REGISTERS. Every register row carries a Registrator -- the
#      document that wrote it. Reading distinct registrator types across the
#      standard registers enumerates every document that MOVES anything. A route
#      sheet that reserves goods, moves them between warehouses, or books
#      transport costs will appear here.
#
#   2. THE "ALL DOCUMENTS" JOURNAL. In 1C 8.2 the built-in journal is usually
#      called "Dokumenty"; the earlier probe tried that and three other names.
#      Here it is retried with the type read via XMLTypeOf on the reference,
#      which works even when the journal exposes no Tip column.
#
# XMLTypeOf is the key: given any reference, it returns the metadata object name
# ("DocumentRef.ZakazPokupatelya" style), so the configuration names itself.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-list-all-docs.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-all-docs.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Sample = 3000
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

$SELECT   = C 1042,1067,1041,1056,1040,1058,1068                   # VYBRAT
$FIRST    = C 1055,1045,1056,1042,1067,1045                        # PERVYE
$FROM     = C 1048,1047                                            # IZ
$AS       = C 1050,1040,1050                                       # KAK
$DOC      = C 1044,1086,1082,1091,1084,1077,1085,1090              # Dokument
$REG      = C 1056,1077,1075,1080,1089,1090,1088,1053,1072,1082,1086,1087,1083,1077,1085,1080,1103  # RegistrNakopleniya
$REGSVED  = C 1056,1077,1075,1080,1089,1090,1088,1057,1074,1077,1076,1077,1085,1080,1081  # RegistrSvedeniy
$JOURNAL  = C 1046,1091,1088,1085,1072,1083,1044,1086,1082,1091,1084,1077,1085,1090,1086,1074  # ZhurnalDokumentov
$REGISTRAR= C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088  # Registrator
$REF      = C 1057,1089,1099,1083,1082,1072                        # Ssylka

# Type name of a reference, e.g. "DocumentRef.ZakazPokupatelya".
function TypeOf($value) {
    if ($null -eq $value) { return $null }
    try {
        $t = $ib.XMLTypeOf($value)
        if ($null -ne $t) { return [string]$t.TypeName }
    } catch { }
    return $null
}

$allTypes = @{}

function Note($typeName, $where) {
    if (-not $typeName) { return }
    if (-not $allTypes.ContainsKey($typeName)) {
        $allTypes[$typeName] = @{ count = 0; where = @{} }
    }
    $allTypes[$typeName].count++
    $allTypes[$typeName].where[$where] = 1
}

# --- 1. Accumulation registers: who writes into them? ------------------------

Write-Host "=== 1. Documents seen as Registrator in accumulation registers ==="

$regNames = @(
    @{ l = "Prodazhi";          n = (C 1055,1088,1086,1076,1072,1078,1080) },
    @{ l = "TovaryNaSkladah";   n = (C 1058,1086,1074,1072,1088,1099,1053,1072,1057,1082,1083,1072,1076,1072,1093) },
    @{ l = "VzaimoraschetySKontragentami"; n = (C 1042,1079,1072,1080,1084,1086,1088,1072,1089,1095,1077,1090,1099,1057,1050,1086,1085,1090,1088,1072,1075,1077,1085,1090,1072,1084,1080) },
    @{ l = "ZakazyPokupateley"; n = (C 1047,1072,1082,1072,1079,1099,1055,1086,1082,1091,1087,1072,1090,1077,1083,1077,1081) },
    @{ l = "TovaryVRezerve";    n = (C 1058,1086,1074,1072,1088,1099,1042,1056,1077,1079,1077,1088,1074,1077) },
    @{ l = "DenezhnyeSredstva"; n = (C 1044,1077,1085,1077,1078,1085,1099,1077,1057,1088,1077,1076,1089,1090,1074,1072) },
    @{ l = "TovaryKPolucheniyu"; n = (C 1058,1086,1074,1072,1088,1099,1050,1055,1086,1083,1091,1095,1077,1085,1080,1102) },
    @{ l = "ZatratyNaVypusk";   n = (C 1047,1072,1090,1088,1072,1090,1099) }
)

foreach ($reg in $regNames) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST $Sample R.$REGISTRAR $FROM $REG.$($reg.n) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $seen = @{}
        $n = 0
        while ($r.Next()) {
            $n++
            $t = TypeOf $r.Get(0)
            if ($t) {
                $seen[$t] = 1
                Note $t ("reg:" + $reg.l)
            }
        }
        if ($n -gt 0) {
            Write-Host ("  {0}: {1} rows, {2} distinct document types" -f $reg.l, $n, $seen.Count)
            foreach ($t in ($seen.Keys | Sort-Object)) { Write-Host ("      {0}" -f $t) }
        }
    }
    catch {
        Write-Host ("  {0}: not readable" -f $reg.l)
    }
}
Write-Host ""

# --- 2. Information registers often used by delivery add-ons -----------------

Write-Host "=== 2. Information registers with a Registrator ==="

$regSvedNames = @(
    @{ l = "GrafikDostavki";  n = (C 1043,1088,1072,1092,1080,1082,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "SostoyaniyaZakazov"; n = (C 1057,1086,1089,1090,1086,1103,1085,1080,1103,1047,1072,1082,1072,1079,1086,1074) },
    @{ l = "AdresaDostavki";  n = (C 1040,1076,1088,1077,1089,1072,1044,1086,1089,1090,1072,1074,1082,1080) }
)

foreach ($reg in $regSvedNames) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 200 R.$REGISTRAR $FROM $REGSVED.$($reg.n) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $seen = @{}
        while ($r.Next()) {
            $t = TypeOf $r.Get(0)
            if ($t) { $seen[$t] = 1; Note $t ("regsved:" + $reg.l) }
        }
        Write-Host ("  FOUND   {0}: {1} distinct types" -f $reg.l, $seen.Count)
        foreach ($t in ($seen.Keys | Sort-Object)) { Write-Host ("      {0}" -f $t) }
    }
    catch { }
}
Write-Host ""

# --- 3. The generic document journal -----------------------------------------

Write-Host "=== 3. Document journal ==="

$journalNames = @(
    @{ l = "Dokumenty";    n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1099) },
    @{ l = "Prodazhi";     n = (C 1055,1088,1086,1076,1072,1078,1080) },
    @{ l = "Zakupki";      n = (C 1047,1072,1082,1091,1087,1082,1080) },
    @{ l = "Sklad";        n = (C 1057,1082,1083,1072,1076) },
    @{ l = "Denezhnye";    n = (C 1044,1077,1085,1077,1078,1085,1099,1077,1057,1088,1077,1076,1089,1090,1074,1072) },
    @{ l = "Obshchie";     n = (C 1054,1073,1097,1080,1077) },
    @{ l = "Osnovnye";     n = (C 1054,1089,1085,1086,1074,1085,1099,1077) }
)

$journalWorked = $false
foreach ($j in $journalNames) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST $Sample J.$REF $FROM $JOURNAL.$($j.n) $AS J"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $seen = @{}
        $n = 0
        while ($r.Next()) {
            $n++
            $t = TypeOf $r.Get(0)
            if ($t) { $seen[$t] = 1; Note $t ("journal:" + $j.l) }
        }
        $journalWorked = $true
        Write-Host ("  FOUND   Journal.{0}: {1} rows, {2} distinct types" -f $j.l, $n, $seen.Count)
        foreach ($t in ($seen.Keys | Sort-Object)) { Write-Host ("      {0}" -f $t) }
    }
    catch { }
}
if (-not $journalWorked) { Write-Host "  (no journal readable -- registers above are the source)" }
Write-Host ""

# --- 4. Everything found, in one list ----------------------------------------

Write-Host "=== 4. ALL document types discovered ==="

if ($allTypes.Count -eq 0) {
    Write-Host "  (nothing discovered -- report this, it means the registers are"
    Write-Host "   unreadable too and we need a different approach entirely)"
} else {
    Write-Host ("  {0} distinct document types:" -f $allTypes.Count)
    Write-Host ""
    foreach ($t in ($allTypes.Keys | Sort-Object)) {
        Write-Host ("  {0,-52} seen in: {1}" -f $t, (($allTypes[$t].where.Keys | Sort-Object) -join ", "))
    }
}
Write-Host ""
Write-Host "Look through the list for anything that could be a driver's route sheet."
Write-Host "Then rerun: probe-route-sheets.ps1 -DocName <NameWithoutTheDocumentRefPrefix>"

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
