# Probe: why do 1C and the site disagree on WHICH July documents exist?
#
# Cost reconciled to 0.08% (3 305 457 in the register vs 3 308 091 on the
# site), and once the discount bug was fixed one rep matched to the hryvnia
# (Kulyk: 129 086 both sides). So the cost channel and the formula are sound.
#
# What still disagrees is the document SET:
#   site: 839 realizations totalling 3 861 252
#   1C:   818 realizations totalling 4 108 506
# More documents on our side, less money. Two separate errors, then, not one
# offset -- and both matter, because payroll is per rep.
#
# Prime suspect is the manager attribute. The register probe printed
# "Pats Valentyn" and "Levkovych Oleksandr" -- full names, where the site
# stores "Valentyn" and "Oleksandr". If a document's Menedzher is empty and
# 1C's report falls back to something else (Otvetstvennyi, the contract's
# manager, the client's manager), the split moves between people while the
# grand total stays put.
#
# Sections, in order:
#   1. Totals by posted flag -- are we simply counting different states?
#   2. Documents whose Menedzher is EMPTY, and what their other attributes say.
#   3. The exact document list for one rep, to diff against ours by number.
#   4. Sum by Otvetstvennyi, for comparison with the Menedzher split.
#
# READ-ONLY. 32-bit PowerShell, from the agent folder:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f .\probe-docset.ps1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $DayFrom = "2026-07-01",
    [string] $DayTo   = "2026-08-01"
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
$ib = (New-Object -ComObject V82.COMConnector).Connect($connString)
Write-Host "connected"

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT  = C 1042,1067,1041,1056,1040,1058,1068
$FROM    = C 1048,1047
$AS      = C 1050,1040,1050
$WHERE   = C 1043,1044,1045
$AND     = C 1048
$SUM     = C 1057,1059,1052,1052,1040
$COUNT   = C 1050,1054,1051,1048,1063,1045,1057,1058,1042,1054
$GROUPBY = (C 1057,1043,1056,1059,1055,1055,1048,1056,1054,1042,1040,1058,1068) + " " + (C 1055,1054)
$ORDERBY = (C 1059,1055,1054,1056,1071,1044,1054,1063,1048,1058,1068) + " " + (C 1055,1054)
$DESC    = C 1059,1041,1067,1042

$DOC          = C 1044,1086,1082,1091,1084,1077,1085,1090
$Realizaciya  = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075
$Menedzher    = C 1052,1077,1085,1077,1076,1078,1077,1088
$Otvetstv     = C 1054,1090,1074,1077,1090,1089,1090,1074,1077,1085,1085,1099,1081
$Naimenovanie = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077
$SummaDok     = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072
$Data         = C 1044,1072,1090,1072
$Nomer        = C 1053,1086,1084,1077,1088
$Proveden     = C 1055,1088,1086,1074,1077,1076,1077,1085
$Kontragent   = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090
$PometkaUdal  = C 1055,1086,1084,1077,1090,1082,1072,1059,1076,1072,1083,1077,1085,1080,1103

function ParseDay([string] $s) {
    $m = [regex]::Match(([string]$s).Trim(), '^(\d{4})-(\d{2})-(\d{2})$')
    if (-not $m.Success) { throw ("expected yyyy-MM-dd, got '" + $s + "'") }
    return New-Object DateTime([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, [int]$m.Groups[3].Value)
}
$d1 = ParseDay $DayFrom
$d2 = ParseDay $DayTo
Write-Host ("window: {0:yyyy-MM-dd} .. {1:yyyy-MM-dd} (excl.)" -f $d1, $d2)

# Result goes into a script-scope variable: a PowerShell function returns
# everything unconsumed, and one stray value corrupts the shape.
function Run {
    param([string] $Label, [string] $Text, [int] $Cols, [int] $Rows = 60)

    Write-Host ("-" * 78)
    Write-Host $Label
    $script:Result = New-Object Collections.ArrayList
    try {
        $q = $ib.NewObject("Query")
        $q.Text = $Text
        $q.SetParameter("D1", $d1)
        $q.SetParameter("D2", $d2)
        $sel = $q.Execute().Choose()
        while ($sel.Next() -and $script:Result.Count -lt $Rows) {
            $vals = New-Object Collections.ArrayList
            for ($i = 0; $i -lt $Cols; $i++) {
                $v = $sel.Get($i)
                if ($null -eq $v) { [void]$vals.Add(""); continue }
                $str = "$v"
                if ($str -eq "System.__ComObject") {
                    $str = $null
                    try { $str = $ib.String($v) } catch { }
                    if (-not $str) { $str = "<ref>" }
                }
                [void]$vals.Add($str)
            }
            [void]$script:Result.Add($vals)
        }
        Write-Host ("  rows: " + $script:Result.Count)
    } catch {
        Write-Host ("  FAIL: " + $_.Exception.Message.Split("`n")[0])
    }
}

Write-Host ""
Write-Host "=============================================================================="
Write-Host " 1. Totals by posted / deletion flag"
Write-Host "=============================================================================="
Write-Host " Site counts only posted, non-deleted. If 1C's 818 includes or excludes"
Write-Host " something else, the difference shows up right here."
Write-Host ""

Run "1a. count and sum, split by Proveden and PometkaUdaleniya" @"
$SELECT
    R.$Proveden,
    R.$PometkaUdal,
    $COUNT(*),
    $SUM(R.$SummaDok)
$FROM $DOC.$Realizaciya $AS R
$WHERE R.$Data >= &D1 $AND R.$Data < &D2
$GROUPBY R.$Proveden, R.$PometkaUdal
"@ 4
foreach ($r in $script:Result) {
    Write-Host ("  posted={0,-6} deleted={1,-6} docs={2,5} sum={3}" -f $r[0], $r[1], $r[2], $r[3])
}
Write-Host "  Site has: 839 documents, 3 861 252 (posted only)."

Write-Host ""
Write-Host "=============================================================================="
Write-Host " 2. Documents with an EMPTY Menedzher"
Write-Host "=============================================================================="
Write-Host " These are the ones whose margin can land on the wrong person."
Write-Host ""

Run "2a. how many, and for how much" @"
$SELECT
    $COUNT(*),
    $SUM(R.$SummaDok)
$FROM $DOC.$Realizaciya $AS R
$WHERE R.$Data >= &D1 $AND R.$Data < &D2
    $AND R.$Proveden
    $AND R.$Menedzher.$Naimenovanie = ""
"@ 2
foreach ($r in $script:Result) { Write-Host ("  empty-manager docs={0} sum={1}" -f $r[0], $r[1]) }

Run "2b. a few of them, with Otvetstvennyi for comparison" @"
$SELECT
    R.$Nomer,
    R.$Data,
    R.$SummaDok,
    R.$Otvetstv.$Naimenovanie,
    R.$Kontragent.$Naimenovanie
$FROM $DOC.$Realizaciya $AS R
$WHERE R.$Data >= &D1 $AND R.$Data < &D2
    $AND R.$Proveden
    $AND R.$Menedzher.$Naimenovanie = ""
$ORDERBY R.$SummaDok $DESC
"@ 5 10
foreach ($r in $script:Result) {
    Write-Host ("  {0} {1} sum={2,12} otv={3} client={4}" -f $r[0], $r[1], $r[2], $r[3], $r[4])
}

Write-Host ""
Write-Host "=============================================================================="
Write-Host " 3. Same split, but by Otvetstvennyi instead of Menedzher"
Write-Host "=============================================================================="
Write-Host " If this matches the site's split better than Menedzher does, the"
Write-Host " report reads a different attribute than the exchange."
Write-Host ""

Run "3a. sum by Otvetstvennyi" @"
$SELECT
    R.$Otvetstv.$Naimenovanie,
    $COUNT(*),
    $SUM(R.$SummaDok)
$FROM $DOC.$Realizaciya $AS R
$WHERE R.$Data >= &D1 $AND R.$Data < &D2
    $AND R.$Proveden
$GROUPBY R.$Otvetstv.$Naimenovanie
$ORDERBY $SUM(R.$SummaDok) $DESC
"@ 3 20
foreach ($r in $script:Result) {
    Write-Host ("  {0,-32} docs={1,5} sum={2}" -f $r[0], $r[1], $r[2])
}

Write-Host ""
Write-Host "=============================================================================="
Write-Host " 4. Valentyn's documents by number (to diff against the site's 28)"
Write-Host "=============================================================================="

Run "4a. documents where Menedzher name contains 'Valentyn'" @"
$SELECT
    R.$Nomer,
    R.$Data,
    R.$SummaDok,
    R.$Menedzher.$Naimenovanie
$FROM $DOC.$Realizaciya $AS R
$WHERE R.$Data >= &D1 $AND R.$Data < &D2
    $AND R.$Proveden
    $AND R.$Menedzher.$Naimenovanie $(C 1055,1054,1044,1054,1041,1053,1054) "%$(C 1042,1072,1083,1077,1085,1090,1080,1085)%"
$ORDERBY R.$SummaDok $DESC
"@ 4 40
Write-Host ("  (site has 28 documents for Valentyn totalling 641 527)")
foreach ($r in $script:Result) {
    Write-Host ("  {0} {1} sum={2,12} mgr={3}" -f $r[0], $r[1], $r[2], $r[3])
}

Write-Host ""
Write-Host "=============================================================================="
Write-Host " DONE."
Write-Host "=============================================================================="
