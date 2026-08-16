# Probe: gross margin for July 2026, straight from the register.
#
# The site now imports cost and shows a margin per rep. Before that number is
# allowed anywhere near payroll it has to be reconciled against 1C itself --
# not against a screenshot, but against the same register the report reads.
#
# Three questions, in order of how much they can hurt:
#
#   1. Does the total match? The site says 591 873 UAH gross on 3 899 963
#      revenue for July (15.2%).
#   2. Does it match PER MANAGER? Payroll is paid per person, so a total that
#      matches while the split does not is worse than useless.
#   3. How does 1C treat RETURNS? The site's cost query filters to
#      realizations only, so returns take revenue away without giving cost
#      back -- 66 documents, 58 238 UAH in July. If the register carries cost
#      for returns too, the site is overstating margin and needs a second
#      query. Section 3 settles it.
#
# Manager comes from the document header (Menedzher), the same attribute the
# exchange uses for realizations -- see _salesRepComment in queries.json.
# Otvetstvennyi is the storekeeper who posts the shipment, not the seller.
#
# READ-ONLY. Run with 32-bit PowerShell from the agent folder:
#   cd C:\Users\fedyshyn\budvik-agent
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f .\probe-margin-july.ps1

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
$connector = New-Object -ComObject V82.COMConnector
$ib = $connector.Connect($connString)
Write-Host "connected"
Write-Host ""

# Cyrillic must not appear as a literal: PS5 reads .ps1 in the OEM codepage and
# mangles it. Everything is built from char codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT  = C 1042,1067,1041,1056,1040,1058,1068
$FROM    = C 1048,1047
$AS      = C 1050,1040,1050
$WHERE   = C 1043,1044,1045
$AND     = C 1048
$SUM     = C 1057,1059,1052,1052,1040
$COUNT   = C 1050,1054,1051,1048,1063,1045,1057,1058,1042,1054
$DIFFER  = C 1056,1040,1047,1051,1048,1063,1053,1067,1045
$GROUPBY = (C 1057,1043,1056,1059,1055,1055,1048,1056,1054,1042,1040,1058,1068) + " " + (C 1055,1054)
$ORDERBY = (C 1059,1055,1054,1056,1071,1044,1054,1063,1048,1058,1068) + " " + (C 1055,1054)
$DESC    = C 1059,1041,1067,1042
$REFOP   = C 1057,1057,1067,1051,1050,1040
$EXPRESS = C 1042,1067,1056,1040,1047,1048,1058,1068

$REG   = C 1056,1077,1075,1080,1089,1090,1088,1053,1072,1082,1086,1087,1083,1077,1085,1080,1103
$DOC   = C 1044,1086,1082,1091,1084,1077,1085,1090

$PS            = C 1055,1088,1086,1076,1072,1078,1080,1057,1077,1073,1077,1089,1090,1086,1080,1084,1086,1089,1090,1100
$Stoimost      = C 1057,1090,1086,1080,1084,1086,1089,1090,1100
$Registrator   = C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088
$Kolichestvo   = C 1050,1086,1083,1080,1095,1077,1089,1090,1074,1086
$Period        = C 1055,1077,1088,1080,1086,1076
$Realizaciya   = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075
$Vozvrat       = C 1042,1086,1079,1074,1088,1072,1090,1058,1086,1074,1072,1088,1086,1074,1054,1090,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103
$Menedzher     = C 1052,1077,1085,1077,1076,1078,1077,1088
$Naimenovanie  = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077
$SummaDok      = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072
$Nomer         = C 1053,1086,1084,1077,1088
$Data          = C 1044,1072,1090,1072

# Dates are built field by field, not parsed.
#
# ParseExact with $null culture falls back to the server's locale, which here
# is Ukrainian and rejects "2026-07-01" outright ("String was not recognized
# as a valid DateTime"). InvariantCulture would fix that, but building the
# value from its parts cannot fail on locale at all -- and this probe must not
# die before it reaches the register.
function ParseDay([string] $s, [string] $label) {
    $m = [regex]::Match(([string]$s).Trim(), '^(\d{4})-(\d{2})-(\d{2})$')
    if (-not $m.Success) { throw ("{0}: expected yyyy-MM-dd, got '{1}'" -f $label, $s) }
    return New-Object DateTime([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, [int]$m.Groups[3].Value)
}

$dFrom = ParseDay $DayFrom "DayFrom"
$dTo   = ParseDay $DayTo   "DayTo"

Write-Host ("window: {0:yyyy-MM-dd} .. {1:yyyy-MM-dd} (excl.)" -f $dFrom, $dTo)

function Run {
    param([string] $Label, [string] $Text, [int] $Cols, [hashtable] $Params = @{}, [int] $Rows = 40)

    Write-Host ("-" * 78)
    Write-Host $Label
    try {
        $q = $ib.NewObject("Query")
        $q.Text = $Text
        foreach ($k in $Params.Keys) { $q.SetParameter($k, $Params[$k]) }
        $sel = $q.Execute().Choose()
        $out = @()
        while ($sel.Next() -and $out.Count -lt $Rows) {
            $vals = @()
            for ($i = 0; $i -lt $Cols; $i++) {
                $v = $sel.Get($i)
                if ($null -eq $v) { $vals += "NULL"; continue }
                $s = $v.ToString()
                if ($s -eq "System.__ComObject") {
                    $s = $null
                    try { $s = $ib.String($v) } catch { }
                    if (-not $s) { try { $s = $v.Naimenovanie } catch { } }
                    if (-not $s) { $s = "<ref>" }
                }
                $vals += $s
            }
            $out += ,$vals
        }
        Write-Host ("  rows: " + $out.Count)
        # ,$out (not $out): PowerShell unrolls a single-element array into the
        # element itself, and the caller's $r[0] would then index into a string.
        return ,$out
    } catch {
        Write-Host ("  FAIL: " + $_.Exception.Message.Split("`n")[0])
        return $null
    }
}

Write-Host "=============================================================================="
Write-Host (" MARGIN CHECK {0} .. {1} (excl. {1})" -f $DayFrom, $DayTo)
Write-Host "=============================================================================="

# --- 1. per manager, realizations only (what the site currently computes) ---
$rows = Run "1. Gross margin per manager -- REALIZATIONS only" @"
$SELECT
    $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Menedzher.$Naimenovanie $AS Mgr,
    $SUM(P.$Stoimost) $AS Cost,
    $COUNT($DIFFER P.$Registrator) $AS Docs
$FROM $REG.$PS $AS P
$WHERE P.$Period >= &D1 $AND P.$Period < &D2
    $AND P.$Registrator $REFOP $DOC.$Realizaciya
$GROUPBY $EXPRESS(P.$Registrator $AS $DOC.$Realizaciya).$Menedzher.$Naimenovanie
$ORDERBY $SUM(P.$Stoimost) $DESC
"@ -Cols 3 -Params @{ D1 = $dFrom; D2 = $dTo }

# Revenue lives on the document, not in the register, so it is summed
# separately over the same window and matched by manager name.
$revRows = Run "   (revenue per manager, from the documents themselves)" @"
$SELECT
    R.$Menedzher.$Naimenovanie $AS Mgr,
    $SUM(R.$SummaDok) $AS Revenue,
    $COUNT(*) $AS Docs
$FROM $DOC.$Realizaciya $AS R
$WHERE R.$Data >= &D1 $AND R.$Data < &D2
$GROUPBY R.$Menedzher.$Naimenovanie
"@ -Cols 3 -Params @{ D1 = $dFrom; D2 = $dTo }

if (-not $rows)    { Write-Host "`n  !! cost query returned nothing -- see FAIL above" }
if (-not $revRows) { Write-Host "`n  !! revenue query returned nothing -- see FAIL above" }

if ($rows -and $revRows) {
    $revBy = @{}
    foreach ($r in $revRows) { $revBy[$r[0]] = [double]($r[1] -replace ",", ".") }

    Write-Host ""
    Write-Host ("  {0,-26} {1,14} {2,14} {3,12} {4,7}" -f "Manager", "Revenue", "Cost", "GROSS", "%")
    Write-Host ("  " + ("-" * 76))
    $tR = 0.0; $tC = 0.0
    foreach ($r in $rows) {
        $mgr  = $r[0]
        $cost = [double]($r[1] -replace ",", ".")
        $rev  = 0.0
        if ($revBy.ContainsKey($mgr)) { $rev = $revBy[$mgr] }
        $gross = $rev - $cost
        $pct = 0.0
        if ($rev -ne 0) { $pct = 100.0 * $gross / $rev }
        $tR += $rev; $tC += $cost
        Write-Host ("  {0,-26} {1,14:N0} {2,14:N0} {3,12:N0} {4,6:N1}%" -f $mgr, $rev, $cost, $gross, $pct)
    }
    $tG = $tR - $tC
    $tP = 0.0
    if ($tR -ne 0) { $tP = 100.0 * $tG / $tR }
    Write-Host ("  " + ("-" * 76))
    Write-Host ("  {0,-26} {1,14:N0} {2,14:N0} {3,12:N0} {4,6:N1}%" -f "TOTAL", $tR, $tC, $tG, $tP)
    Write-Host ""
    Write-Host "  Site says for July: revenue 3 899 963, cost 3 308 091, gross 591 873 (15.2%)"
}

# --- 2. does the register carry cost for RETURNS? ---
Write-Host ""
Write-Host "=============================================================================="
Write-Host " 2. RETURNS: does the register hold their cost?"
Write-Host "=============================================================================="
Write-Host " The site subtracts return revenue but no return cost. If rows come"
Write-Host " back here, the exchange needs a second query and the margin above is"
Write-Host " overstated by roughly this much."
Write-Host ""

$retRows = Run "2a. cost of returns in the same window" @"
$SELECT
    $SUM(P.$Stoimost) $AS Cost,
    $COUNT($DIFFER P.$Registrator) $AS Docs
$FROM $REG.$PS $AS P
$WHERE P.$Period >= &D1 $AND P.$Period < &D2
    $AND P.$Registrator $REFOP $DOC.$Vozvrat
"@ -Cols 2 -Params @{ D1 = $dFrom; D2 = $dTo }

if ($retRows -and $retRows.Count -gt 0) {
    $rc = $retRows[0][0]
    $rd = $retRows[0][1]
    if ($rc -eq "NULL" -or [double]($rc -replace ",", ".") -eq 0) {
        Write-Host "  Returns carry NO cost in this register."
        Write-Host "  -> the site's number needs no correction for returns."
    } else {
        Write-Host ("  Returns DO carry cost: {0} over {1} document(s)." -f $rc, $rd)
        Write-Host "  -> the exchange must read returns too; margin above is overstated."
    }
}

# Return revenue, for scale.
$retRev = Run "2b. return revenue in the same window (for scale)" @"
$SELECT
    $SUM(V.$SummaDok) $AS Revenue,
    $COUNT(*) $AS Docs
$FROM $DOC.$Vozvrat $AS V
$WHERE V.$Data >= &D1 $AND V.$Data < &D2
"@ -Cols 2 -Params @{ D1 = $dFrom; D2 = $dTo }

if ($retRev -and $retRev.Count -gt 0) {
    Write-Host ("  Return revenue: {0} over {1} document(s). Site counted 58 238 over 66." -f $retRev[0][0], $retRev[0][1])
}

# --- 3. grand total, no manager split ---
Write-Host ""
Write-Host "=============================================================================="
Write-Host " 3. Grand total (sanity check against section 1)"
Write-Host "=============================================================================="

$tot = Run "3a. all realization cost in the window" @"
$SELECT
    $SUM(P.$Stoimost) $AS Cost,
    $COUNT($DIFFER P.$Registrator) $AS Docs,
    $COUNT(*) $AS Rows
$FROM $REG.$PS $AS P
$WHERE P.$Period >= &D1 $AND P.$Period < &D2
    $AND P.$Registrator $REFOP $DOC.$Realizaciya
"@ -Cols 3 -Params @{ D1 = $dFrom; D2 = $dTo }

if ($tot -and $tot.Count -gt 0) {
    Write-Host ("  cost {0} | documents {1} | register rows {2}" -f $tot[0][0], $tot[0][1], $tot[0][2])
    Write-Host "  Site: cost 3 308 091 over 818 documents, 3 624 costed lines."
}

Write-Host ""
Write-Host "=============================================================================="
Write-Host " DONE. Compare section 1 with the site's numbers, and read section 2."
Write-Host "=============================================================================="
