# Probe #3: fill the gaps left by probe-docs.ps1 before writing stage-2 queries.
#
# READ ONLY.
#
# Open questions this answers:
#   1. Where does the salesperson live? (no Menedzher field in the order header)
#   2. Where does the warehouse live? (not in the header -- likely in the lines)
#   3. Is SummaDokumenta actually populated, or was that "1" a real order?
#   4. What dimensions does the settlements register have, and is debt per
#      counterparty in UAH or in contract currency?
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-docs2.ps1
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1, so every
# Cyrillic string is built from [char] codes.

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$configPath = Join-Path $scriptDir "config.json"
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 0x412,0x42B,0x411,0x420,0x410,0x422,0x42C
$TOP    = C 0x41F,0x415,0x420,0x412,0x42B,0x415
$FROM   = C 0x418,0x417
$WHERE  = C 0x413,0x414,0x415
$ORDER  = C 0x423,0x41F,0x41E,0x420,0x42F,0x414,0x41E,0x427,0x418,0x422,0x42C
$DESC   = C 0x423,0x411,0x42B,0x412
$AND    = C 0x418
$DOC    = C 0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442
$CAT    = C 0x421,0x43F,0x440,0x430,0x432,0x43E,0x447,0x43D,0x438,0x43A
$REGACC = C 0x420,0x435,0x433,0x438,0x441,0x442,0x440,0x41D,0x430,0x43A,0x43E,0x43F,0x43B,0x435,0x43D,0x438,0x44F

$ZAKAZ  = C 0x417,0x430,0x43A,0x430,0x437,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x44F
$TOVARY = C 0x422,0x43E,0x432,0x430,0x440,0x44B
$DATA   = C 0x414,0x430,0x442,0x430
$NOMER  = C 0x41D,0x43E,0x43C,0x435,0x440
$SUMMA  = C 0x421,0x443,0x43C,0x43C,0x430,0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442,0x430
$KONTR  = C 0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    $config.oneC.server, $config.oneC.base, $config.oneC.user, $config.oneC.password
$ib = $conn.Connect($cs)
Write-Host "CONNECTED"
Write-Host ""

# Reports several columns, because these questions are about how fields relate
# to each other, not merely whether a name resolves.
function Probe($label, $queryText, $cols) {
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
            $parts = @()
            for ($i = 0; $i -lt $cols; $i++) {
                $v = $r.Get($i)
                if ($null -eq $v) { $parts += "<null>" }
                else {
                    $s = [string]$v
                    if ($s -eq "System.__ComObject") {
                        # A reference: its presentation is what a human needs here.
                        try { $s = "ref:" + [string]$v.$NAIM } catch { $s = "ref" }
                    }
                    $parts += $s
                }
            }
            Write-Host ("       " + ($parts -join " | "))
        }
        if ($n -eq 0) { Write-Host "       (no rows)" }
    }
    catch {
        Write-Host ("  -- {0}: {1}" -f $label, $_.Exception.Message)
    }
}

# --- Q1/Q3: recent orders, is SummaDokumenta populated? -------------------
Write-Host "-- Q3: recent orders (number | date | sum | posted)"
$PROVED = C 0x41F,0x440,0x43E,0x432,0x435,0x434,0x435,0x43D
Probe "orders_recent" `
    "$SELECT $TOP 5 $NOMER, $DATA, $SUMMA, $PROVED $FROM $DOC.$ZAKAZ $ORDER $DATA $DESC" 4
Write-Host ""

# --- Q1: who is the salesperson? -----------------------------------------
# Candidate attribute names seen across UT 2.3 builds.
Write-Host "-- Q1: salesperson candidates on the order"
$AUTHOR  = C 0x410,0x432,0x442,0x43E,0x440
$OTVET   = C 0x41E,0x442,0x432,0x435,0x442,0x441,0x442,0x432,0x435,0x43D,0x43D,0x44B,0x439
$MENPROD = C 0x41C,0x435,0x43D,0x435,0x434,0x436,0x435,0x440,0x41F,0x440,0x43E,0x434,0x430,0x436   # MenedzherProdazh
$TORGPR  = C 0x422,0x43E,0x440,0x433,0x43E,0x432,0x44B,0x439,0x41F,0x440,0x435,0x434,0x441,0x442,0x430,0x432,0x438,0x442,0x435,0x43B,0x44C  # TorgovyyPredstavitel
$PODRAZD = C 0x41F,0x43E,0x434,0x440,0x430,0x437,0x434,0x435,0x43B,0x435,0x43D,0x438,0x435
$NAIM    = C 0x41D,0x430,0x438,0x43C,0x435,0x43D,0x43E,0x432,0x430,0x43D,0x438,0x435

Probe "ord_author"   "$SELECT $TOP 3 $AUTHOR $FROM $DOC.$ZAKAZ" 1
Probe "ord_respons"  "$SELECT $TOP 3 $OTVET $FROM $DOC.$ZAKAZ" 1
Probe "ord_mgr_sale" "$SELECT $TOP 1 $MENPROD $FROM $DOC.$ZAKAZ" 1
Probe "ord_agent"    "$SELECT $TOP 1 $TORGPR $FROM $DOC.$ZAKAZ" 1
Probe "ord_division" "$SELECT $TOP 1 $PODRAZD $FROM $DOC.$ZAKAZ" 1
Write-Host ""

# --- Q2: where is the warehouse? -----------------------------------------
Write-Host "-- Q2: warehouse on order lines"
$SKLAD = C 0x421,0x43A,0x43B,0x430,0x434
Probe "line_warehouse" "$SELECT $TOP 3 $SKLAD $FROM $DOC.$ZAKAZ.$TOVARY" 1
Write-Host ""

# --- Q4: settlements register shape --------------------------------------
Write-Host "-- Q4: debt per counterparty (top 5 by balance)"
$VZAIMO  = C 0x412,0x437,0x430,0x438,0x43C,0x43E,0x440,0x430,0x441,0x447,0x435,0x442,0x44B,0x421,0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442,0x430,0x43C,0x438
$OSTATKI = C 0x41E,0x441,0x442,0x430,0x442,0x43A,0x438
$SUMOST  = C 0x421,0x443,0x43C,0x43C,0x430,0x412,0x437,0x430,0x438,0x43C,0x43E,0x440,0x430,0x441,0x447,0x435,0x442,0x43E,0x432,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A
$DOGOVOR = C 0x414,0x43E,0x433,0x43E,0x432,0x43E,0x440,0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442,0x430

Probe "debt_by_cp" `
    "$SELECT $TOP 5 $KONTR, $SUMOST $FROM $REGACC.$VZAIMO.$OSTATKI $ORDER $SUMOST" 2
Probe "debt_has_contract" `
    "$SELECT $TOP 1 $DOGOVOR $FROM $REGACC.$VZAIMO.$OSTATKI" 1

# Is the balance kept in UAH or in the contract currency? A currency-bearing
# resource would change how debt must be aggregated.
$SUMUPR = C 0x421,0x443,0x43C,0x43C,0x430,0x423,0x43F,0x440,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A  # SummaUprOstatok
Probe "debt_mgmt_sum" "$SELECT $TOP 1 $SUMUPR $FROM $REGACC.$VZAIMO.$OSTATKI" 1
Write-Host ""

Write-Host "DONE"
