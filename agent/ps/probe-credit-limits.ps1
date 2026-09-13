# READ ONLY. Probe: does UT 2.3 keep a credit limit or a shipment stop per
# customer contract, and is it actually used?
#
# Why: the most frequent rep call to the office is likely "why is my client's
# order not shipped" -- if the office blocks debtors in 1C, the site could tell
# the rep before he promises delivery. In UT 2.3 the candidates live on
# Spravochnik.DogovoryKontragentov: KontrolirovatSummuZadolzhennosti /
# DopustimayaSummaZadolzhennosti and KontrolirovatChisloDneyZadolzhennosti /
# DopustimoeChisloDneyZadolzhennosti. Names differ between builds, so every
# field is tried as its own query first (a wrong name fails Execute() with a
# bare NullReferenceException that says nothing).
#
# Nothing is written to 1C: only Query.Execute() on SELECT texts.
#
# Run with 32-bit PowerShell on the 1C server, next to config.json:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-credit-limits.ps1

[CmdletBinding()]
param([string] $ConfigPath, [int] $Sample = 15)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir "config.json" }

$config = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$connString = 'Srvr="' + $config.oneC.server + '";Ref="' + $config.oneC.base +
              '";Usr="' + $config.oneC.user + '";Pwd="' + $config.oneC.password + '";'

Write-Host "READ ONLY probe: credit limits on customer contracts"
Write-Host "connecting..."
$connector = New-Object -ComObject V82.COMConnector
$ib = $connector.Connect($connString)
Write-Host "connected"
Write-Host ""

# Cyrillic must not live in this file (PS5 reads .ps1 with the OEM codepage),
# so every name is assembled from char codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT     = C 1042,1067,1041,1056,1040,1058,1068   # VYBRAT
$FIRST      = C 1055,1045,1056,1042,1067,1045   # PERVYE
$FROM       = C 1048,1047   # IZ
$AS         = C 1050,1040,1050   # KAK
$CAT        = C 1057,1087,1088,1072,1074,1086,1095,1085,1080,1082   # Spravochnik
$DOG        = C 1044,1086,1075,1086,1074,1086,1088,1099,1050,1086,1085,1090,1088,1072,1075,1077,1085,1090,1086,1074   # DogovoryKontragentov
$CTRL_SUM   = C 1050,1086,1085,1090,1088,1086,1083,1080,1088,1086,1074,1072,1090,1100,1057,1091,1084,1084,1091,1047,1072,1076,1086,1083,1078,1077,1085,1085,1086,1089,1090,1080   # KontrolirovatSummuZadolzhennosti
$SUM        = C 1044,1086,1087,1091,1089,1090,1080,1084,1072,1103,1057,1091,1084,1084,1072,1047,1072,1076,1086,1083,1078,1077,1085,1085,1086,1089,1090,1080   # DopustimayaSummaZadolzhennosti
$CTRL_DAYS  = C 1050,1086,1085,1090,1088,1086,1083,1080,1088,1086,1074,1072,1090,1100,1063,1080,1089,1083,1086,1044,1085,1077,1081,1047,1072,1076,1086,1083,1078,1077,1085,1085,1086,1089,1090,1080   # KontrolirovatChisloDneyZadolzhennosti
$DAYS       = C 1044,1086,1087,1091,1089,1090,1080,1084,1086,1077,1063,1080,1089,1083,1086,1044,1085,1077,1081,1047,1072,1076,1086,1083,1078,1077,1085,1085,1086,1089,1090,1080   # DopustimoeChisloDneyZadolzhennosti
$OWNER      = C 1042,1083,1072,1076,1077,1083,1077,1094   # Vladelec
$NAME       = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077   # Naimenovanie
$DEL        = C 1055,1086,1084,1077,1090,1082,1072,1059,1076,1072,1083,1077,1085,1080,1103   # PometkaUdaleniya
$KIND       = C 1042,1080,1076,1044,1086,1075,1086,1074,1086,1088,1072   # VidDogovora
$table = "$CAT.$DOG"

# --- 1. Which fields exist on this build -------------------------------------
Write-Host "=== Fields on $table ==="
$fields = [ordered]@{
    "ControlSum"  = $CTRL_SUM
    "AllowedSum"  = $SUM
    "ControlDays" = $CTRL_DAYS
    "AllowedDays" = $DAYS
    "Owner"       = $OWNER
    "Deleted"     = $DEL
    "Kind"        = $KIND
}
$present = @{}
foreach ($k in $fields.Keys) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 1 D.$($fields[$k]) $FROM $table $AS D"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $present[$k] = $true
        Write-Host ("OK      {0}" -f $k)
    }
    catch {
        $present[$k] = $false
        Write-Host ("ABSENT  {0}" -f $k)
    }
}
Write-Host ""

if (-not ($present["ControlSum"] -or $present["ControlDays"])) {
    Write-Host "No credit control fields on contracts -- nothing to read. Nothing was written to 1C."
    exit 0
}

# --- 2. How many contracts actually control debt -----------------------------
Write-Host "=== Contracts with debt control switched on ==="
$cols = @()
foreach ($k in @("ControlSum", "AllowedSum", "ControlDays", "AllowedDays", "Deleted")) {
    if ($present[$k]) { $cols += "D.$($fields[$k])" } else { $cols += "NULL" }
}
$cols += "D.$OWNER.$NAME"
$cols += "D.$NAME"

$q = $ib.NewObject("Query")
$q.Text = "$SELECT " + ($cols -join ", ") + " $FROM $table $AS D"
$r = $q.Execute().Choose()

$total = 0; $bySum = 0; $byDays = 0; $deleted = 0; $shown = 0
while ($r.Next()) {
    $total++
    $isDeleted = ($r.Get(4) -eq $true)
    if ($isDeleted) { $deleted++; continue }
    $ctrlSum = ($r.Get(0) -eq $true)
    $ctrlDays = ($r.Get(2) -eq $true)
    if ($ctrlSum) { $bySum++ }
    if ($ctrlDays) { $byDays++ }
    if (($ctrlSum -or $ctrlDays) -and $shown -lt $Sample) {
        $shown++
        Write-Host ("  {0} | {1} | sum {2} {3} | days {4} {5}" -f `
            $r.Get(5), $r.Get(6), $ctrlSum, $r.Get(1), $ctrlDays, $r.Get(3))
    }
}
Write-Host ""
Write-Host ("contracts total {0}, marked deleted {1}" -f $total, $deleted)
Write-Host ("sum limit controlled on {0}, days limit controlled on {1}" -f $bySum, $byDays)
Write-Host ""
Write-Host "Nothing was written to 1C."
