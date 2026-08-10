# Probe #6: is "reservations: 2" real, or are we reading the wrong register?
#
# READ ONLY.
#
# Two reserved rows across 39 sales reps and 6 414 stock lines is either an
# honest number (reservations are rare or short-lived here) or a sign that
# reservations live somewhere else -- most likely in ZakazyPokupateley, whose
# balance is "left to ship" per order.
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-reserve2.ps1
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1.

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$configPath = Join-Path $scriptDir "config.json"
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$NAIM    = C 0x41D,0x430,0x438,0x43C,0x435,0x43D,0x43E,0x432,0x430,0x43D,0x438,0x435
$SELECT  = C 0x412,0x42B,0x411,0x420,0x410,0x422,0x42C
$TOP     = C 0x41F,0x415,0x420,0x412,0x42B,0x415
$FROM    = C 0x418,0x417
$WHERE   = C 0x413,0x414,0x415
$COUNT   = C 0x41A,0x41E,0x41B,0x418,0x427,0x415,0x421,0x422,0x412,0x41E
$SUM     = C 0x421,0x423,0x41C,0x41C,0x410
$AS      = C 0x41A,0x410,0x41A
$REGACC  = C 0x420,0x435,0x433,0x438,0x441,0x442,0x440,0x41D,0x430,0x43A,0x43E,0x43F,0x43B,0x435,0x43D,0x438,0x44F
$OSTATKI = C 0x41E,0x441,0x442,0x430,0x442,0x43A,0x438
$NOMENK  = C 0x41D,0x43E,0x43C,0x435,0x43D,0x43A,0x43B,0x430,0x442,0x443,0x440,0x430
$SKLAD   = C 0x421,0x43A,0x43B,0x430,0x434
$ZAKAZ   = C 0x417,0x430,0x43A,0x430,0x437,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x44F
$KOLOST  = C 0x41A,0x43E,0x43B,0x438,0x447,0x435,0x441,0x442,0x432,0x43E,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A
$PERIOD  = C 0x41F,0x435,0x440,0x438,0x43E,0x434
$DOC     = C 0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442
$PROVED  = C 0x41F,0x440,0x43E,0x432,0x435,0x434,0x435,0x43D
$DATA    = C 0x414,0x430,0x442,0x430

$RES1 = C 0x422,0x43E,0x432,0x430,0x440,0x44B,0x412,0x420,0x435,0x437,0x435,0x440,0x432,0x435,0x41D,0x430,0x421,0x43A,0x43B,0x430,0x434,0x430,0x445
$RES4 = C 0x417,0x430,0x43A,0x430,0x437,0x44B,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x435,0x439

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
    if (-not $maxRows) { $maxRows = 10 }
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

# --- What is actually in the reservation register? ------------------------
Write-Host "-- TovaryVRezerveNaSkladah: all balance rows"
Probe "reserve_all" "$SELECT $NOMENK, $SKLAD, $KOLOST $FROM $REGACC.$RES1.$OSTATKI" 3 20
Write-Host ""

# Movements, ignoring balances: shows whether the mechanism is used at all,
# or merely empty right now.
Write-Host "-- reservation MOVEMENTS (is the mechanism used at all?)"
Probe "reserve_moves" "$SELECT $TOP 10 $PERIOD, $NOMENK, $KOLOST $FROM $REGACC.$RES1" 3 10
Write-Host ""

# --- ZakazyPokupateley: the likelier home of "reserved" -------------------
# Its balance is what remains to be shipped on an order, which is exactly the
# quantity a rep has effectively taken out of free stock.
Write-Host "-- ZakazyPokupateley: outstanding order balances"
Probe "orders_outstanding" `
    "$SELECT $TOP 15 $ZAKAZ, $NOMENK, $KOLOST $FROM $REGACC.$RES4.$OSTATKI" 3 15
Write-Host ""

Write-Host "-- ZakazyPokupateley: how many rows in total"
Probe "orders_count" "$SELECT $COUNT(*) $FROM $REGACC.$RES4.$OSTATKI" 1 1
Write-Host ""

# Does that register carry a warehouse dimension? Without one, order balances
# cannot be subtracted per warehouse.
Write-Host "-- does ZakazyPokupateley have a warehouse dimension?"
Probe "orders_warehouse" "$SELECT $TOP 3 $SKLAD $FROM $REGACC.$RES4.$OSTATKI" 1 3
Write-Host ""

# --- Recent unshipped orders, for a human sanity check --------------------
Write-Host "-- recent posted customer orders (are there any open ones?)"
Probe "recent_orders" `
    "$SELECT $TOP 10 $DATA, $PROVED $FROM $DOC.$ZAKAZ $WHERE $PROVED" 2 10
Write-Host ""

Write-Host "DONE"
