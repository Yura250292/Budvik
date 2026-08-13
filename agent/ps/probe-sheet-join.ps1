# Confirm the link and shape the real ingest query.
#
# The breakthrough: RealizaciyaTovarovUslug.MarshrutnyjLyst EXISTS and is
# filled 5/5, and AdresDostavki exists too -- the "Adresa" column from the
# photo. So realizations DO know their sheet, and the earlier "no link"
# conclusion was an artefact of a poisoned COM session.
#
# What this probe settles before any ingest code is written:
#
#   1. Sheet 000001820 is dated 13.08 while its rows are realizations from
#      12.08 -- so the sheet gathers the PREVIOUS day's shipments. A date-based
#      rule would have got this wrong; the link gets it right.
#
#   2. Does the link reproduce the photo exactly? The photo shows 32 rows for
#      sheet 000001820. This counts realizations pointing AT that sheet.
#      32 means the link alone is enough for the ingest.
#
#   3. Reading a reference gives "System.__ComObject", so the sheet reference
#      on a realization must be converted to a GUID to be matched against
#      RouteSheet.externalId. UniqueIdentifier via XMLString is how extract.ps1
#      already does it -- verified here on real rows.
#
#   4. Returns: the photo's row 6 is "Vozvrat tovarov ot pokupatelya", so the
#      sheet carries returns as well as sales. Checked as a separate document.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-join.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-sheet-join.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $Number = "000001820"
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
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$T      = C 1058                                                   # T
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NOMER  = C 1053,1086,1084,1077,1088                               # Nomer
$DATA   = C 1044,1072,1090,1072                                    # Data
$KONTR  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$NAIM   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$SUMMA  = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$PROV   = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$ADRES  = C 1040,1076,1088,1077,1089,1044,1086,1089,1090,1072,1074,1082,1080  # AdresDostavki
$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$REAL   = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug
$VOZVR  = C 1042,1086,1079,1074,1088,1072,1090,1058,1086,1074,1072,1088,1086,1074,1054,1090,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # VozvratTovarovOtPokupatelya

function New-Ib {
    $c = New-Object -ComObject V82.COMConnector
    return @{ conn = $c; ib = $c.Connect($script:connString) }
}
function Close-Ib($h) {
    if ($null -eq $h) { return }
    if ($h.ib)   { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($h.ib) }
    if ($h.conn) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($h.conn) }
    [GC]::Collect()
}

# Same conversion extract.ps1 uses: a reference prints as System.__ComObject,
# so the GUID has to be pulled out explicitly to match RouteSheet.externalId.
function RefId($ib, $value) {
    # Copied verbatim from extract.ps1:67 -- the version proven on this build.
    # An empty sheet attribute comes back as the all-zero GUID, which must read
    # as "no link", not as a group key that lumps every unlinked doc together.
    if ($null -eq $value) { return $null }
    try {
        $s = $ib.XMLString($value)
        if ([string]::IsNullOrWhiteSpace($s)) { return $null }
        if ($s -eq "00000000-0000-0000-0000-000000000000") { return $null }
        return $s
    } catch {
        return $null
    }
}

Write-Host "=== Sheet $Number : do realizations point at it? ==="
Write-Host ""

# 1. The sheet's own GUID -- the value the join needs.
$sheetId = ""
$h = $null
try {
    $h = New-Ib
    $q = $h.ib.NewObject("Query")
    $q.Text = "$SELECT $T.$REF, $T.$NOMER, $T.$DATA $FROM $DOC.$RS $AS $T"
    $sel = $q.Execute().Choose()
    while ($sel.Next()) {
        if (([string]$sel.Get(1)).Trim() -eq $Number) {
            $sheetId = RefId $h.ib $sel.Get(0)
            Write-Host ("  sheet date : {0}" -f ([string]$sel.Get(2)))
            Write-Host ("  sheet GUID : {0}" -f $sheetId)
            break
        }
    }
}
catch { Write-Host ("  sheet lookup failed: " + $_.Exception.Message.Split("`n")[0]) }
finally { Close-Ib $h }

Write-Host ""
Write-Host "=== Realizations grouped by the sheet they point at ==="
Write-Host "The photo shows 32 rows for this sheet. Matching that count means the"
Write-Host "link alone drives the ingest -- no date heuristics needed."
Write-Host ""

# 2. Walk realizations, group by their sheet GUID. No WHERE on a reference:
#    that is the filter shape that fails on this build.
$h = $null
try {
    $h = New-Ib
    $q = $h.ib.NewObject("Query")
    $q.Text = "$SELECT $T.$NOMER, $T.$DATA, $T.$RS, $T.$KONTR.$NAIM, $T.$ADRES, $T.$SUMMA, $T.$PROV $FROM $DOC.$REAL $AS $T"
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $sel = $rs.Choose()

    $mine = @()
    $withSheet = 0
    $total = 0
    while ($sel.Next()) {
        $total++
        $sid = RefId $h.ib $sel.Get(2)
        if ($null -ne $sid) { $withSheet++ }
        if ($null -ne $sid -and $sid -eq $sheetId) {
            $mine += [pscustomobject]@{
                Num   = ([string]$sel.Get(0)).Trim()
                Date  = [string]$sel.Get(1)
                Name  = [string]$sel.Get(3)
                Addr  = [string]$sel.Get(4)
                Sum   = [string]$sel.Get(5)
                Post  = [string]$sel.Get(6)
            }
        }
    }

    Write-Host ("  realizations scanned      : {0}" -f $total)
    Write-Host ("  ... carrying a sheet link : {0}" -f $withSheet)
    Write-Host ("  ... pointing at $Number   : {0}   <-- photo shows 32" -f $mine.Count)
    Write-Host ""

    $i = 0
    foreach ($r in $mine) {
        $i++
        if ($i -gt 35) { break }
        Write-Host ("   {0,2}. {1,-14} {2,-28} {3,-38} {4,10}  posted={5}" -f $i, $r.Num, $r.Name, $r.Addr, $r.Sum, $r.Post)
    }
}
catch { Write-Host ("  join query failed: " + $_.Exception.Message.Split("`n")[0]) }
finally { Close-Ib $h }

# 3. Returns: photo row 6 is a return document, so they belong to sheets too.
Write-Host ""
Write-Host "=== Do returns carry the same link? (photo row 6 is a return) ==="
$h = $null
try {
    $h = New-Ib
    $q = $h.ib.NewObject("Query")
    $q.Text = "$SELECT $T.$NOMER, $T.$DATA, $T.$RS, $T.$KONTR.$NAIM, $T.$SUMMA $FROM $DOC.$VOZVR $AS $T"
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $sel = $rs.Choose()
    $n = 0; $linked = 0; $mine = 0
    while ($sel.Next()) {
        $n++
        $sid = RefId $h.ib $sel.Get(2)
        if ($null -ne $sid) { $linked++ }
        if ($null -ne $sid -and $sid -eq $sheetId) {
            $mine++
            Write-Host ("    {0,-14} {1,-28} {2}" -f ([string]$sel.Get(0)).Trim(), ([string]$sel.Get(3)), ([string]$sel.Get(4)))
        }
    }
    Write-Host ("  returns scanned: {0}, with sheet link: {1}, on this sheet: {2}" -f $n, $linked, $mine)
}
catch { Write-Host ("  returns query failed (attribute may not exist there): " + $_.Exception.Message.Split("`n")[0]) }
finally { Close-Ib $h }

Write-Host ""
Write-Host "If the count matches the photo, the ingest query is simply:"
Write-Host "  realizations + returns, selecting MarshrutnyjLyst, Kontragent,"
Write-Host "  AdresDostavki and SummaDokumenta -- grouped by the sheet GUID."
