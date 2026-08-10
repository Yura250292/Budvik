# Probe #4: same questions as probe-docs2, minus its two mistakes.
#
# READ ONLY.
#
# Fixes vs probe-docs2:
#   * $NAIM was declared *after* the function that used it, so every reference
#     printed as bare "ref:" -- the data was there, the label was empty.
#   * UPORYADOCHIT (ORDER BY) made Execute() throw on this build, the same way a
#     parameterised query inside a function returns null. Dropped it; ordering
#     happens in PowerShell instead.
#
# Key question: is Otvetstvennyy the sales rep who took the order at the
# customer, or the office manager who imported and posted it? Counting the
# distinct values answers that -- a handful means managers, dozens means reps.
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-docs3.ps1
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1.

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$configPath = Join-Path $scriptDir "config.json"
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

# Declared before any function that uses them -- see the header note.
$NAIM   = C 0x41D,0x430,0x438,0x43C,0x435,0x43D,0x43E,0x432,0x430,0x43D,0x438,0x435
$SELECT = C 0x412,0x42B,0x411,0x420,0x410,0x422,0x42C
$TOP    = C 0x41F,0x415,0x420,0x412,0x42B,0x415
$FROM   = C 0x418,0x417
$WHERE  = C 0x413,0x414,0x415
$DIFF   = C 0x420,0x410,0x417,0x41B,0x418,0x427,0x41D,0x42B,0x415                    # RAZLICHNYE
$DOC    = C 0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442
$CAT    = C 0x421,0x43F,0x440,0x430,0x432,0x43E,0x447,0x43D,0x438,0x43A
$REGACC = C 0x420,0x435,0x433,0x438,0x441,0x442,0x440,0x41D,0x430,0x43A,0x43E,0x43F,0x43B,0x435,0x43D,0x438,0x44F

$ZAKAZ  = C 0x417,0x430,0x43A,0x430,0x437,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x44F
$TOVARY = C 0x422,0x43E,0x432,0x430,0x440,0x44B
$DATA   = C 0x414,0x430,0x442,0x430
$NOMER  = C 0x41D,0x43E,0x43C,0x435,0x440
$SUMMA  = C 0x421,0x443,0x43C,0x43C,0x430,0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442,0x430
$KONTR  = C 0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442
$OTVET  = C 0x41E,0x442,0x432,0x435,0x442,0x441,0x442,0x432,0x435,0x43D,0x43D,0x44B,0x439
$PROVED = C 0x41F,0x440,0x43E,0x432,0x435,0x434,0x435,0x43D

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    $config.oneC.server, $config.oneC.base, $config.oneC.user, $config.oneC.password
$ib = $conn.Connect($cs)
Write-Host "CONNECTED"
Write-Host ""

# Renders a reference by asking it for its presentation; falls back to the
# raw value for primitives.
function Show($v) {
    if ($null -eq $v) { return "<null>" }
    $s = [string]$v
    if ($s -ne "System.__ComObject") { return $s }
    foreach ($prop in @($NAIM, "Metadata")) {
        try {
            $p = $v.$prop
            if ($null -ne $p) {
                $ps = [string]$p
                if ($ps -and $ps -ne "System.__ComObject") { return $ps }
            }
        } catch { }
    }
    try { return [string]$v.ToString() } catch { return "<ref>" }
}

function Probe($label, $queryText, $cols, $maxRows) {
    if (-not $maxRows) { $maxRows = 20 }
    try {
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queryText
        $rs = $q.Execute()
        if ($null -eq $rs) { Write-Host ("  -- {0}: Execute returned null" -f $label); return }
        $r = $rs.Choose()
        $n = 0
        Write-Host ("  OK {0}" -f $label)
        while ($r.Next()) {
            $n++
            if ($n -le $maxRows) {
                $parts = @()
                for ($i = 0; $i -lt $cols; $i++) { $parts += (Show $r.Get($i)) }
                Write-Host ("       " + ($parts -join " | "))
            }
        }
        Write-Host ("       total rows: {0}" -f $n)
    }
    catch {
        Write-Host ("  -- {0}: {1}" -f $label, $_.Exception.Message)
    }
}

# --- Q3: is SummaDokumenta populated? (no ORDER BY this time) -------------
Write-Host "-- Q3: orders sample (number | date | sum | posted)"
Probe "orders_sample" `
    "$SELECT $TOP 8 $NOMER, $DATA, $SUMMA, $PROVED $FROM $DOC.$ZAKAZ" 4 8
Write-Host ""

# --- Q1: how many distinct Otvetstvennyy values exist? --------------------
# A short list means office managers; a long one means the reps themselves.
Write-Host "-- Q1: distinct Otvetstvennyy across all orders"
Probe "distinct_responsible" `
    "$SELECT $DIFF $OTVET $FROM $DOC.$ZAKAZ" 1 40
Write-Host ""

Write-Host "-- Q1b: users catalogue"
$POLZ = C 0x41F,0x43E,0x43B,0x44C,0x437,0x43E,0x432,0x430,0x442,0x435,0x43B,0x438
Probe "users" "$SELECT $TOP 40 $NAIM $FROM $CAT.$POLZ" 1 40
Write-Host ""

# --- Q2: warehouse -- header attribute under another name? ----------------
Write-Host "-- Q2: warehouse candidates"
$SKLADORD = C 0x421,0x43A,0x43B,0x430,0x434,0x41E,0x440,0x434,0x435,0x440    # SkladOrder
$SKLADGRP = C 0x421,0x43A,0x43B,0x430,0x434,0x413,0x440,0x443,0x43F,0x43F,0x430  # SkladGruppa
Probe "ord_sklad_order" "$SELECT $TOP 1 $SKLADORD $FROM $DOC.$ZAKAZ" 1 1
Probe "ord_sklad_group" "$SELECT $TOP 1 $SKLADGRP $FROM $DOC.$ZAKAZ" 1 1
Write-Host ""

# --- Q4: debt per counterparty (no ORDER BY) ------------------------------
Write-Host "-- Q4: debt rows (counterparty | settlements sum | mgmt sum)"
$VZAIMO  = C 0x412,0x437,0x430,0x438,0x43C,0x43E,0x440,0x430,0x441,0x447,0x435,0x442,0x44B,0x421,0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442,0x430,0x43C,0x438
$OSTATKI = C 0x41E,0x441,0x442,0x430,0x442,0x43A,0x438
$SUMOST  = C 0x421,0x443,0x43C,0x43C,0x430,0x412,0x437,0x430,0x438,0x43C,0x43E,0x440,0x430,0x441,0x447,0x435,0x442,0x43E,0x432,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A
$SUMUPR  = C 0x421,0x443,0x43C,0x43C,0x430,0x423,0x43F,0x440,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A

Probe "debt_rows" `
    "$SELECT $TOP 10 $KONTR, $SUMOST, $SUMUPR $FROM $REGACC.$VZAIMO.$OSTATKI" 3 10
Write-Host ""

Write-Host "DONE"
