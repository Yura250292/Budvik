# Probe #7: the exact shape of RegistrNakopleniya.ZakazyPokupateley.
#
# READ ONLY.
#
# Why: TovaryVRezerveNaSkladah holds 2 rows in the whole base, while
# ZakazyPokupateley holds many with realistic quantities (22, 40, 194). The
# latter is where this company's "reserve" actually lives -- what a rep has
# taken out of free stock by placing an order.
#
# Before subtracting it from stock we must know:
#   1. Which resources exist? A register may carry both "ordered" and
#      "shipped", and subtracting the wrong one double-counts.
#   2. Are closed orders excluded from the balance? If 2021 orders are still
#      in there, we would zero out stock that is physically available.
#   3. How many rows and what total quantity -- a sanity check against the
#      6 414 stock lines.
#
# Note: COUNT(*) and a bare register name without .Ostatki both failed on this
# build, so every probe here goes through .Ostatki with explicit fields.
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-orders-reg.ps1
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
$REGACC  = C 0x420,0x435,0x433,0x438,0x441,0x442,0x440,0x41D,0x430,0x43A,0x43E,0x43F,0x43B,0x435,0x43D,0x438,0x44F
$OSTATKI = C 0x41E,0x441,0x442,0x430,0x442,0x43A,0x438
$NOMENK  = C 0x41D,0x43E,0x43C,0x435,0x43D,0x43A,0x43B,0x430,0x442,0x443,0x440,0x430
$ZAKAZ   = C 0x417,0x430,0x43A,0x430,0x437,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x44F
$RES4    = C 0x417,0x430,0x43A,0x430,0x437,0x44B,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x435,0x439
$DOC     = C 0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442
$DATA    = C 0x414,0x430,0x442,0x430

# Candidate resource names on the orders register.
$KOLOST   = C 0x41A,0x43E,0x43B,0x438,0x447,0x435,0x441,0x442,0x432,0x43E,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A                          # KolichestvoOstatok
$KOTGROST = C 0x41A,0x41E,0x442,0x433,0x440,0x443,0x437,0x43A,0x435,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A                                # KOtgruzkeOstatok
$OTGROST  = C 0x41E,0x442,0x433,0x440,0x443,0x436,0x435,0x43D,0x43E,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A                                # OtgruzhenoOstatok
$RAZMOST  = C 0x420,0x430,0x437,0x43C,0x435,0x449,0x435,0x43D,0x43E,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A                                # RazmeschenoOstatok
$KOPLOST  = C 0x41A,0x41E,0x043F,0x043B,0x430,0x442,0x435,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A                                          # KOplateOstatok

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

# Counts every row and sums column $sumCol (or -1 for none), so we learn the
# size of the register without COUNT(*), which fails on this build.
function ProbeCount($label, $queryText, $cols, $sumCol, $maxRows) {
    if (-not $maxRows) { $maxRows = 5 }
    try {
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queryText
        $rs = $q.Execute()
        if ($null -eq $rs) { Write-Host ("  -- {0}: Execute returned null" -f $label); return }
        $r = $rs.Choose()
        $n = 0
        $total = 0
        $lines = @()
        while ($r.Next()) {
            $n++
            if ($sumCol -ge 0) {
                $v = $r.Get($sumCol)
                if ($null -ne $v) { try { $total += [double]$v } catch { } }
            }
            if ($n -le $maxRows) {
                $parts = @()
                for ($i = 0; $i -lt $cols; $i++) { $parts += (Show $r.Get($i)) }
                $lines += ("       " + ($parts -join " | "))
            }
        }
        if ($sumCol -ge 0) {
            Write-Host ("  OK {0}   rows={1}  sum={2}" -f $label, $n, $total)
        } else {
            Write-Host ("  OK {0}   rows={1}" -f $label, $n)
        }
        $lines | ForEach-Object { Write-Host $_ }
    }
    catch {
        Write-Host ("  -- {0}: {1}" -f $label, $_.Exception.Message)
    }
}

# --- Q1: which resources does the register expose? ------------------------
Write-Host "-- available resources on ZakazyPokupateley.Ostatki"
ProbeCount "KolichestvoOstatok" "$SELECT $TOP 1 $KOLOST $FROM $REGACC.$RES4.$OSTATKI" 1 -1 1
ProbeCount "KOtgruzkeOstatok"   "$SELECT $TOP 1 $KOTGROST $FROM $REGACC.$RES4.$OSTATKI" 1 -1 1
ProbeCount "OtgruzhenoOstatok"  "$SELECT $TOP 1 $OTGROST $FROM $REGACC.$RES4.$OSTATKI" 1 -1 1
ProbeCount "RazmeschenoOstatok" "$SELECT $TOP 1 $RAZMOST $FROM $REGACC.$RES4.$OSTATKI" 1 -1 1
ProbeCount "KOplateOstatok"     "$SELECT $TOP 1 $KOPLOST $FROM $REGACC.$RES4.$OSTATKI" 1 -1 1
Write-Host ""

# --- Q2: total size and quantity ------------------------------------------
# Compare against 6 414 stock lines: a register several times larger would
# mean it holds long-closed orders.
Write-Host "-- full size of the outstanding-orders register"
ProbeCount "all_rows" "$SELECT $NOMENK, $KOLOST $FROM $REGACC.$RES4.$OSTATKI" 2 1 0
Write-Host ""

# --- Q3: are these orders recent, or is 2021 still hanging around? --------
# The order reference carries its own date, so reading it tells us whether
# balances are cleared on shipment or accumulate forever.
Write-Host "-- dates of orders still holding a balance (oldest first is fine)"
$ZAKDATA = "$ZAKAZ.$DATA"
ProbeCount "order_dates" "$SELECT $TOP 20 $ZAKDATA, $KOLOST $FROM $REGACC.$RES4.$OSTATKI" 2 -1 20
Write-Host ""

Write-Host "DONE"
