# Sheet 1817, rebuilt from the link -- minimal, one thing at a time.
#
# Two probes gave contradictory answers about the same attribute:
#   probe-debt-payment-doc  ->  RealizaciyaTovarovUslug.MarshrutnyjLyst  40/40 filled
#   probe-sheet-rebuild     ->  "no attr" for the same document
#
# The generated query text is byte-identical in both (verified locally), so the
# attribute is real. What differed is the ORDER: in the failing probe the
# attribute check ran after a query that had already failed. On this build a
# failed Execute() appears to poison later queries in the same session -- the
# same "Object reference not set" then answers everything.
#
# So this script does the minimum, in strict order, and stops at the first
# failure instead of carrying on and reporting false absences:
#   1. locate sheet 1817
#   2. list its realizations through the link
#   3. count unique delivery addresses
#
# Nothing speculative, no name guessing, one query per step.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-1817.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-1817.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $SheetNumber = "000001817"
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

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$KONTR  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$VODITEL= C 1042,1086,1076,1080,1090,1077,1083,1100                # Voditel
$ADRDOST= C 1040,1076,1088,1077,1089,1044,1086,1089,1090,1072,1074,1082,1080  # AdresDostavki

$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$REALIZ = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug

# --- Step 1: the sheet ------------------------------------------------------

Write-Host ("=== 1. Sheet {0} ===" -f $SheetNumber)

$sheetRef = $null
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 5 R.$REF, R.$NUM, R.$DATE, R.$VODITEL.$NAME" +
              " $FROM $DOC.$RS $AS R $WHERE R.$NUM = &SheetNum"
    $q.SetParameter("SheetNum", $SheetNumber)
    $rs = $q.Execute()
    $r = $rs.Choose()
    if ($r.Next()) {
        $sheetRef = $r.Get(0)
        Write-Host ("  No {0} of {1}, driver: {2}" -f `
            ([string]$r.Get(1)).Trim(), ([string]$r.Get(2)).Trim(), ([string]$r.Get(3)).Trim())
    } else {
        Write-Host "  NOT FOUND -- stopping (nothing to rebuild)"
    }
}
catch {
    Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
}
Write-Host ""

if (-not $sheetRef) {
    if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
    if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
    [GC]::Collect()
    exit 0
}

# --- Step 2: its realizations, through the link -----------------------------
#
# The whole ingest design rests on this one query. If it answers, the stop list
# comes straight from 1C and no print-form logic has to be reverse-engineered.

Write-Host "=== 2. Realizations of this sheet ==="

$total = 0.0
$rows = 0
$addrCount = @{}

try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 80 R.$NUM, R.$DATE, R.$KONTR.$NAME, R.$SUMDOC, R.$ADRDOST" +
              " $FROM $DOC.$REALIZ $AS R $WHERE R.$RS = &Sheet"
    $q.SetParameter("Sheet", $sheetRef)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()

    while ($r.Next()) {
        $rows++
        $raw = ([string]$r.Get(3)).Trim()
        $val = 0.0
        $clean = $raw -replace '\s', '' -replace ',', '.'
        [void][double]::TryParse($clean, [Globalization.NumberStyles]::Any,
            [Globalization.CultureInfo]::InvariantCulture, [ref] $val)
        $total += $val

        $addr = ([string]$r.Get(4)).Trim()
        $key = if ($addr) { $addr.ToLower() } else { "(no address) " + ([string]$r.Get(2)).Trim() }
        if (-not $addrCount.ContainsKey($key)) { $addrCount[$key] = 0 }
        $addrCount[$key]++

        Write-Host ("  {0,2}. {1,-40} {2,13}   {3}" -f `
            $rows, ([string]$r.Get(2)).Trim(), $raw, $addr)
    }

    Write-Host ""
    Write-Host ("  {0} realizations, total {1:N2} UAH" -f $rows, $total)
}
catch {
    Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
    Write-Host "  (if this fails, the MarshrutnyjLyst attribute is not usable as a filter)"
}
Write-Host ""

# --- Step 3: what the numbers should be -------------------------------------

Write-Host "=== 3. Against the paper form ==="
Write-Host "  The photographed sheet 1817 shows:"
Write-Host "    total on the form ............ 71 966,52 UAH"
Write-Host "    of which debt payment ........  5 888,00 UAH  (Oplata zaborgovanosti 000001242)"
Write-Host "    so the payroll base should be   66 078,52 UAH"
Write-Host ""
if ($rows -gt 0) {
    Write-Host ("  Realizations above sum to ..... {0:N2} UAH" -f $total)
    $diff = 66078.52 - $total
    if ([Math]::Abs($diff) -lt 1.0) {
        Write-Host "  MATCH -- realizations alone equal the payroll base."
        Write-Host "  The debt payment is a separate document, correctly excluded."
    } else {
        Write-Host ("  Difference from 66 078,52: {0:N2} UAH" -f $diff)
        Write-Host "  Report this number -- it says what else the form counts."
    }
    Write-Host ""
    Write-Host ("  Unique delivery addresses: {0}  (= paid points)" -f $addrCount.Count)
    foreach ($k in ($addrCount.Keys | Sort-Object)) {
        Write-Host ("      {0}x  {1}" -f $addrCount[$k], $k)
    }
}

Write-Host ""
Write-Host "That is everything payroll needs from 1C except mileage."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
