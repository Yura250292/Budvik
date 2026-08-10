# Probe #8: are the 9 424 outstanding-order rows current, or is 2021 still in
# there?
#
# READ ONLY.
#
# This decides the free-stock formula. If long-shipped 2021 orders still hold
# a balance, subtracting them would show zero for goods that are physically on
# the shelf -- the opposite error to overselling, and just as damaging.
#
# 9 424 order rows against 6 414 stock lines is the warning sign: there are
# more outstanding order lines than stocked positions.
#
# Note on this 1C build: "VYBRAT PERVYE 1 <single resource>" throws, while the
# same resource selected alongside a dimension works. Every probe here
# therefore selects at least two fields.
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-orders-age.ps1
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
$FROM    = C 0x418,0x417
$REGACC  = C 0x420,0x435,0x433,0x438,0x441,0x442,0x440,0x41D,0x430,0x43A,0x43E,0x43F,0x43B,0x435,0x43D,0x438,0x44F
$OSTATKI = C 0x41E,0x441,0x442,0x430,0x442,0x43A,0x438
$NOMENK  = C 0x41D,0x43E,0x43C,0x435,0x43D,0x43A,0x43B,0x430,0x442,0x443,0x440,0x430
$ZAKAZ   = C 0x417,0x430,0x43A,0x430,0x437,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x44F
$RES4    = C 0x417,0x430,0x43A,0x430,0x437,0x44B,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x435,0x439
$DATA    = C 0x414,0x430,0x442,0x430
$KOLOST  = C 0x41A,0x43E,0x43B,0x438,0x447,0x435,0x441,0x442,0x432,0x43E,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A
$ZAKRYT  = C 0x417,0x430,0x43A,0x440,0x44B,0x442                                    # Zakryt
$POMUD   = C 0x41F,0x43E,0x43C,0x435,0x442,0x43A,0x430,0x423,0x434,0x430,0x43B,0x435,0x43D,0x438,0x44F

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    $config.oneC.server, $config.oneC.base, $config.oneC.user, $config.oneC.password
$ib = $conn.Connect($cs)
Write-Host "CONNECTED"
Write-Host ""

# --- Age distribution of outstanding order rows ---------------------------
# Reads order date alongside quantity and buckets by year in PowerShell:
# grouping in the query language is another thing that misbehaves here.
Write-Host "-- age of outstanding order balances"
try {
    $q = $ib.NewObject("Query")
    $q.Text = [string]("$SELECT $ZAKAZ.$DATA, $KOLOST, $ZAKAZ.$POMUD $FROM $REGACC.$RES4.$OSTATKI")
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()

    $byYear = @{}
    $qtyByYear = @{}
    $deleted = 0
    $deletedQty = 0
    $total = 0
    $nullDate = 0

    while ($r.Next()) {
        $total++
        $d = $r.Get(0)
        $qty = 0
        try { $qty = [double]$r.Get(1) } catch { }
        $mark = $r.Get(2)

        if ($mark -eq $true) { $deleted++; $deletedQty += $qty }

        if ($null -eq $d) { $nullDate++; continue }
        $year = ([datetime]$d).Year
        if (-not $byYear.ContainsKey($year)) { $byYear[$year] = 0; $qtyByYear[$year] = 0 }
        $byYear[$year]++
        $qtyByYear[$year] += $qty
    }

    Write-Host ("  total rows: {0}   (no date: {1})" -f $total, $nullDate)
    Write-Host ("  rows on orders marked for deletion: {0}  qty={1}" -f $deleted, $deletedQty)
    Write-Host ""
    Write-Host "  year |   rows |        qty"
    foreach ($y in ($byYear.Keys | Sort-Object)) {
        Write-Host ("  {0,4} | {1,6} | {2,10:N0}" -f $y, $byYear[$y], $qtyByYear[$y])
    }
}
catch {
    Write-Host ("  -- failed: " + $_.Exception.Message)
}
Write-Host ""

# --- Is there a "closed" flag on the order document? ----------------------
# If 1C marks fulfilled orders as closed, that flag -- not the date -- is the
# correct filter for what still holds stock.
Write-Host "-- does ZakazPokupatelya have a Zakryt (closed) flag?"
try {
    $q = $ib.NewObject("Query")
    $q.Text = [string]("$SELECT $ZAKAZ.$DATA, $ZAKAZ.$ZAKRYT $FROM $REGACC.$RES4.$OSTATKI")
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()
    $closed = 0; $open = 0
    while ($r.Next()) {
        if ($r.Get(1) -eq $true) { $closed++ } else { $open++ }
    }
    Write-Host ("  OK  closed={0}  open={1}" -f $closed, $open)
}
catch {
    Write-Host ("  -- no Zakryt field: " + $_.Exception.Message)
}
Write-Host ""

Write-Host "DONE"
