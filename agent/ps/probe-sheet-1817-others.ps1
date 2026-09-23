# What ELSE belongs to sheet 1817 besides realizations.
#
# Established so far (probe-sheet-1817-rows): 1C and the site agree exactly --
# 17 realizations, 58 181,19 UAH, none unposted. So the form's 71 966,52 is not
# realizations we are missing. The arithmetic points somewhere specific:
#
#     58 181,19  realizations          (1C and site agree)
#      5 888,00  "Oplata zaborgovanosti 000001242"  (visible on the form)
#      7 897,33  ???
#     ---------
#     71 966,52  form total
#
# 5 888 is a cash receipt we already import (PKO, 12.08, Zadorozhnij Viktor).
# Nothing in our database matches 7 897,33 -- and the ingest only takes PKOs
# whose operation kind is OplataPokupatelya, so a receipt of any other kind is
# invisible to us by design.
#
# This probe asks 1C directly: which documents carry a MarshrutnyjLyst pointing
# at this sheet? Each candidate type is tested in its own connection, because a
# missing attribute throws and a failed Execute() poisons the whole session on
# this build -- that is exactly how earlier probes produced false "absent".
#
# If PKO rows show up and they sum with the realizations to 71 966,52, then the
# payroll base is 58 181,19 (what the site already computes) and the owner's
# 66 078,52 simply subtracted one debt payment out of two.
#
# READ-ONLY -- SELECT only, nothing is written, nothing is posted.
#
# 32-bit PowerShell, one line:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-1817-others.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $SheetNumber = "000001817",
    [string] $From = "2026-07-25",
    [string] $To   = "2026-08-25"
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
$FROM_  = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$KONTR  = C 1050,1086,1085,1090,1090,1088,1072,1075,1077,1085,1090 # (unused placeholder)
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS

# Candidate document types. Names are spelled out by code point; a wrong name
# throws on Execute(), which is why each one gets its own connection.
$TYPES = @(
    @{ label = "PrihodnyjKassovyjOrder (PKO)";
       name  = C 1055,1088,1080,1093,1086,1076,1085,1099,1081,1050,1072,1089,1089,1086,1074,1099,1081,1054,1088,1076,1077,1088 },
    @{ label = "VozvratTovarovOtPokupatelya";
       name  = C 1042,1086,1079,1074,1088,1072,1090,1058,1086,1074,1072,1088,1086,1074,1054,1090,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103 },
    @{ label = "RashodnyjKassovyjOrder (RKO)";
       name  = C 1056,1072,1089,1093,1086,1076,1085,1099,1081,1050,1072,1089,1089,1086,1074,1099,1081,1054,1088,1076,1077,1088 }
)

function RefId($ib, $value) {
    if ($null -eq $value) { return $null }
    try {
        $s = $ib.XMLString($value)
        if ([string]::IsNullOrWhiteSpace($s)) { return $null }
        if ($s -eq "00000000-0000-0000-0000-000000000000") { return $null }
        return $s
    } catch { return $null }
}

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

$dateFrom = [datetime]::ParseExact($From, "yyyy-MM-dd", $null)
$dateTo   = [datetime]::ParseExact($To,   "yyyy-MM-dd", $null)

# --- Step 1: the sheet GUID -------------------------------------------------

Write-Host ("=== 1. Sheet {0} ===" -f $SheetNumber)
$sheetId = $null
$h = New-Ib
try {
    $q = $h.ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 5 L.$REF, L.$NUM $FROM_ $DOC.$RS $AS L $WHERE L.$NUM = &SheetNum"
    $q.SetParameter("SheetNum", $SheetNumber)
    $res = $q.Execute()
    if ($null -eq $res) { throw "Execute() returned null" }
    $r = $res.Choose()
    if ($r.Next()) { $sheetId = RefId $h.ib $r.Get(0); Write-Host ("  GUID {0}" -f $sheetId) }
    else { Write-Host "  NOT FOUND" }
}
catch { Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0]) }
Close-Ib $h
Write-Host ""
if (-not $sheetId) { exit 0 }

# --- Step 2: every candidate type, one connection each ----------------------

Write-Host ("=== 2. Documents pointing at this sheet, {0}..{1} ===" -f $From, $To)
Write-Host ""

$grand = 0.0
foreach ($t in $TYPES) {
    Write-Host ("--- {0}" -f $t.label)
    $hh = New-Ib
    $found = 0
    $sum = 0.0
    try {
        $q = $hh.ib.NewObject("Query")
        # Same shape as the queries that work: no reference filter, no upper
        # bound, Cyrillic parameter name. The sheet match happens below.
        $q.Text = "$SELECT T.$RS, T.$SUMDOC, T.$DATE, T.$NUM, T.$POSTED" +
                  " $FROM_ $DOC." + $t.name + " $AS T $WHERE T.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $dateFrom)
        $res = $q.Execute()
        if ($null -eq $res) { throw "Execute() returned null" }
        $r = $res.Choose()
        while ($r.Next()) {
            $rid = RefId $hh.ib $r.Get(0)
            if ($rid -ne $sheetId) { continue }
            $d = [datetime]$r.Get(2)
            if ($d -ge $dateTo) { continue }

            $amount = 0.0
            try { $amount = [double]$r.Get(1) } catch { $amount = 0.0 }
            $isPosted = $true
            try { $isPosted = [bool]$r.Get(4) } catch { $isPosted = $true }

            $found++
            $sum += $amount
            Write-Host ("    {0,-14} {1:dd.MM} {2,12:N2}  {3}" -f `
                ([string]$r.Get(3)).Trim(), $d, $amount,
                $(if ($isPosted) { "posted" } else { "UNPOSTED" }))
        }
        if ($found -eq 0) { Write-Host "    none on this sheet" }
        else { Write-Host ("    {0} document(s), {1:N2}" -f $found, $sum) }
        $grand += $sum
    }
    catch {
        # A type without the attribute throws here -- that IS the answer for it.
        Write-Host ("    no such attribute / query failed: " + $_.Exception.Message.Split("`n")[0])
    }
    Close-Ib $hh
    Write-Host ""
}

# --- Step 3: does it add up -------------------------------------------------

Write-Host "=== 3. Verdict ==="
Write-Host ("  realizations (known) ..... {0,12:N2}" -f 58181.19)
Write-Host ("  other documents above .... {0,12:N2}" -f $grand)
Write-Host ("  together ................. {0,12:N2}" -f (58181.19 + $grand))
Write-Host ("  form total ............... {0,12:N2}" -f 71966.52)
Write-Host ""
if ([Math]::Abs(58181.19 + $grand - 71966.52) -lt 1.0) {
    Write-Host "  IT ADDS UP -> the form shows realizations plus these documents."
    Write-Host "  Payroll base is 58 181,19 (realizations only) -- what the site already uses."
    Write-Host "  The owner's 66 078,52 subtracted only one of them."
} else {
    Write-Host "  Still short. Something else sits on the form -- report the lines above."
}
