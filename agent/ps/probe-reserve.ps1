# Probe #5: find the reservation register, so stock can be shipped as
# free = physical - reserved.
#
# READ ONLY.
#
# Why this matters: TovaryNaSkladah is the PHYSICAL balance. With 5 on the
# shelf and 3 reserved for customer A, it still reports 5, while the manager
# in 1C sees 2. Shipping 5 to the site lets a second rep sell stock that is
# already promised.
#
# UT 2.3 keeps reservations in one of several places depending on build, so
# each candidate is probed separately.
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-reserve.ps1
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1.

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$configPath = Join-Path $scriptDir "config.json"
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$NAIM   = C 0x41D,0x430,0x438,0x43C,0x435,0x43D,0x43E,0x432,0x430,0x43D,0x438,0x435
$SELECT = C 0x412,0x42B,0x411,0x420,0x410,0x422,0x42C
$TOP    = C 0x41F,0x415,0x420,0x412,0x42B,0x415
$FROM   = C 0x418,0x417
$WHERE  = C 0x413,0x414,0x415
$REGACC = C 0x420,0x435,0x433,0x438,0x441,0x442,0x440,0x41D,0x430,0x43A,0x43E,0x43F,0x43B,0x435,0x43D,0x438,0x44F
$DOC    = C 0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442

$OSTATKI = C 0x41E,0x441,0x442,0x430,0x442,0x43A,0x438
$NOMENK  = C 0x41D,0x43E,0x43C,0x435,0x43D,0x43A,0x43B,0x430,0x442,0x443,0x440,0x430
$SKLAD   = C 0x421,0x43A,0x43B,0x430,0x434
$ZAKAZ   = C 0x417,0x430,0x43A,0x430,0x437,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x44F
$PERIOD  = C 0x41F,0x435,0x440,0x438,0x43E,0x434

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    $config.oneC.server, $config.oneC.base, $config.oneC.user, $config.oneC.password
$ib = $conn.Connect($cs)
Write-Host "CONNECTED"
Write-Host ""

function Show($v) {
    if ($null -eq $v) { return "<null>" }
    $s = [string]$v
    if ($s -ne "System.__ComObject") { return $s }
    try {
        $p = $v.$NAIM
        if ($null -ne $p) {
            $ps = [string]$p
            if ($ps -and $ps -ne "System.__ComObject") { return $ps }
        }
    } catch { }
    return "<ref>"
}

function Probe($label, $queryText, $cols, $maxRows) {
    if (-not $maxRows) { $maxRows = 5 }
    try {
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queryText
        $rs = $q.Execute()
        if ($null -eq $rs) { Write-Host ("  -- {0}: Execute returned null" -f $label); return }
        $r = $rs.Choose()
        $n = 0
        $lines = @()
        while ($r.Next()) {
            $n++
            if ($n -le $maxRows) {
                $parts = @()
                for ($i = 0; $i -lt $cols; $i++) { $parts += (Show $r.Get($i)) }
                $lines += ("       " + ($parts -join " | "))
            }
        }
        Write-Host ("  OK {0}   rows={1}" -f $label, $n)
        $lines | ForEach-Object { Write-Host $_ }
    }
    catch {
        Write-Host ("  -- {0}: {1}" -f $label, $_.Exception.Message)
    }
}

# --- Candidate reservation registers --------------------------------------
# TovaryVRezerveNaSkladah is the usual UT name; the others are variants seen
# across builds and localisations.
$RES1 = C 0x422,0x43E,0x432,0x430,0x440,0x44B,0x412,0x420,0x435,0x437,0x435,0x440,0x432,0x435,0x41D,0x430,0x421,0x43A,0x43B,0x430,0x434,0x430,0x445  # TovaryVRezerveNaSkladah
$RES2 = C 0x422,0x43E,0x432,0x430,0x440,0x44B,0x412,0x420,0x435,0x437,0x435,0x440,0x432,0x435  # TovaryVRezerve
$RES3 = C 0x420,0x435,0x437,0x435,0x440,0x432,0x44B,0x422,0x43E,0x432,0x430,0x440,0x43E,0x432  # RezervyTovarov
$RES4 = C 0x417,0x430,0x43A,0x430,0x437,0x44B,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x435,0x439  # ZakazyPokupateley

Write-Host "-- candidate registers (just existence)"
Probe "res_TovaryVRezerveNaSkladah" "$SELECT $TOP 1 $NOMENK $FROM $REGACC.$RES1.$OSTATKI" 1 1
Probe "res_TovaryVRezerve"          "$SELECT $TOP 1 $NOMENK $FROM $REGACC.$RES2.$OSTATKI" 1 1
Probe "res_RezervyTovarov"          "$SELECT $TOP 1 $NOMENK $FROM $REGACC.$RES3.$OSTATKI" 1 1
Probe "res_ZakazyPokupateley"       "$SELECT $TOP 1 $NOMENK $FROM $REGACC.$RES4.$OSTATKI" 1 1
Write-Host ""

# --- Resource names on the reservation register ---------------------------
# The balance resource is usually KolichestvoOstatok, but reservation
# registers sometimes name it differently.
$KOLOST = C 0x41A,0x43E,0x43B,0x438,0x447,0x435,0x441,0x442,0x432,0x43E,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A
$KOLRES = C 0x41A,0x43E,0x43B,0x438,0x447,0x435,0x441,0x442,0x432,0x43E,0x412,0x420,0x435,0x437,0x435,0x440,0x432,0x435,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A  # KolichestvoVRezerveOstatok

Write-Host "-- reservation register: shape (product | warehouse | qty)"
Probe "res1_full"     "$SELECT $TOP 5 $NOMENK, $SKLAD, $KOLOST $FROM $REGACC.$RES1.$OSTATKI" 3 5
Probe "res1_qtyres"   "$SELECT $TOP 1 $KOLRES $FROM $REGACC.$RES1.$OSTATKI" 1 1
Probe "res1_order"    "$SELECT $TOP 3 $ZAKAZ $FROM $REGACC.$RES1.$OSTATKI" 1 3
Write-Host ""

# Same shape check for the orders register, which in many UT builds is where
# "reserved" actually lives (dimension: order, resource: qty to ship).
$KOLZAK = C 0x41A,0x43E,0x43B,0x438,0x447,0x435,0x441,0x442,0x432,0x43E,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A
$RAZMES = C 0x420,0x430,0x437,0x43C,0x435,0x449,0x435,0x43D,0x438,0x435  # Razmeschenie

Write-Host "-- ZakazyPokupateley register: shape"
Probe "zak_product"  "$SELECT $TOP 3 $NOMENK, $KOLZAK $FROM $REGACC.$RES4.$OSTATKI" 2 3
Probe "zak_order"    "$SELECT $TOP 3 $ZAKAZ $FROM $REGACC.$RES4.$OSTATKI" 1 3
Write-Host ""

# --- Does the reservation register expose Period (for incremental reads)? --
Write-Host "-- incremental support on reservations"
Probe "res1_period" "$SELECT $TOP 3 $PERIOD $FROM $REGACC.$RES1" 1 3
Probe "zak_period"  "$SELECT $TOP 3 $PERIOD $FROM $REGACC.$RES4" 1 3
Write-Host ""

Write-Host "DONE"
