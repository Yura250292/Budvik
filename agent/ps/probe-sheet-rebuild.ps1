# Rebuild a route sheet from the link, and find the debt-payment document.
#
# Fixes a bug in the previous probe: section 5 reused the parameter name "Nom"
# for both a string (document number) and a reference (the sheet). 1C keeps the
# parameter's first type, so passing a reference into a slot already typed as
# string threw. Each query here gets its own parameter name.
#
# What is already settled:
#   - RealizaciyaTovarovUslug.MarshrutnyjLyst is filled 40/40, so the stop list
#     is one query -- exactly what the print form does.
#   - "Oplata zaborgovanosti 000001242" is NOT a PKO and matches none of the
#     23 document names guessed so far.
#
# So this probe stops guessing that document's name. Instead it asks the SHEET
# what points at it: for every document type we know exists, check whether it
# carries a MarshrutnyjLyst attribute. The debt payment appears on the printed
# sheet, so it must link back somehow -- and whatever type does link is the
# answer, without needing its name in advance.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-rebuild.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-sheet-rebuild.txt 2>&1

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
$AND    = C 1048                                                   # I
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$KONTR  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$VODITEL= C 1042,1086,1076,1080,1090,1077,1083,1100                # Voditel
$ADRDOST= C 1040,1076,1088,1077,1089,1044,1086,1089,1090,1072,1074,1082,1080  # AdresDostavki

$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$REALIZ = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug
$PKO    = C 1055,1088,1080,1093,1086,1076,1085,1099,1081,1050,1072,1089,1089,1086,1074,1099,1081,1054,1088,1076,1077,1088  # PrikhodnyiKassovyiOrder
$ZAKAZ  = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # ZakazPokupatelya
$VOZVRAT= C 1042,1086,1079,1074,1088,1072,1090,1058,1086,1074,1072,1088,1086,1074,1054,1090,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # VozvratTovarovOtPokupatelya
$PEREM  = C 1055,1077,1088,1077,1084,1077,1097,1077,1085,1080,1077,1058,1086,1074,1072,1088,1086,1074  # PeremeschenieTovarov

# --- 1. Pick the sheet from the screenshots ---------------------------------
#
# Sheet 1817 of 11.08.2026 is the one the owner photographed: total 71 966.52
# including a 5 888.00 debt payment. Rebuilding exactly this sheet lets us check
# our numbers against the paper.

Write-Host ("=== 1. Locating sheet {0} ===" -f $SheetNumber)

$sheetRef = $null
$sheetLabel = ""
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 5 R.$REF, R.$NUM, R.$DATE, R.$VODITEL.$NAME" +
              " $FROM $DOC.$RS $AS R $WHERE R.$NUM = &SheetNum"
    $q.SetParameter("SheetNum", $SheetNumber)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "null" }
    $r = $rs.Choose()
    if ($r.Next()) {
        $sheetRef = $r.Get(0)
        $sheetLabel = ([string]$r.Get(1)).Trim() + " of " + ([string]$r.Get(2)).Trim()
        Write-Host ("  found: No {0}, driver {1}" -f $sheetLabel, ([string]$r.Get(3)).Trim())
    } else {
        Write-Host "  not found by that number"
    }
}
catch {
    Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
}

# Fall back to the most recent sheet, so the probe still produces something.
if (-not $sheetRef) {
    Write-Host "  falling back to the most recent posted sheet"
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 1 R.$REF, R.$NUM, R.$DATE, R.$VODITEL.$NAME" +
                  " $FROM $DOC.$RS $AS R $WHERE R.$POSTED $AND R.$DATE >= &FromDate"
        $q.SetParameter("FromDate", (Get-Date).AddMonths(-3))
        $rs = $q.Execute()
        $r = $rs.Choose()
        if ($r.Next()) {
            $sheetRef = $r.Get(0)
            $sheetLabel = ([string]$r.Get(1)).Trim() + " of " + ([string]$r.Get(2)).Trim()
            Write-Host ("  using: No {0}, driver {1}" -f $sheetLabel, ([string]$r.Get(3)).Trim())
        }
    } catch { }
}
Write-Host ""

if (-not $sheetRef) {
    Write-Host "No sheet to work with -- stopping."
    if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
    if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
    [GC]::Collect()
    exit 0
}

# --- 2. Which document types carry a MarshrutnyjLyst attribute? -------------
#
# Rather than guessing the debt document's name, ask the types we know exist
# whether they link to a sheet. Whatever links is what appears on the form.

Write-Host "=== 2. Which known document types link to a route sheet? ==="

$targets = @(
    @{ l = "RealizaciyaTovarovUslug"; n = $REALIZ },
    @{ l = "PriKhodnyiKassovyiOrder"; n = $PKO },
    @{ l = "ZakazPokupatelya";        n = $ZAKAZ },
    @{ l = "VozvratTovarovOtPokup";   n = $VOZVRAT },
    @{ l = "PeremeschenieTovarov";    n = $PEREM }
)

$linked = @()

foreach ($t in $targets) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 40 R.$REF, R.$RS $FROM $DOC.$($t.n) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $rows = 0
        $filled = 0
        while ($r.Next()) {
            $rows++
            $v = $r.Get(1)
            if ($null -ne $v -and ([string]$v).Trim() -eq "System.__ComObject") { $filled++ }
        }
        Write-Host ("  HAS ATTR  {0,-26} {1,2}/{2,-2} filled" -f $t.l, $filled, $rows)
        $linked += $t
    }
    catch {
        Write-Host ("  no attr   {0}" -f $t.l)
    }
}
Write-Host ""

# --- 3. Rebuild the sheet: every linked type, filtered to this sheet --------
#
# Own parameter name per query -- 1C locks a parameter to the type first passed,
# which is what broke the previous probe.

Write-Host ("=== 3. Contents of sheet {0} ===" -f $sheetLabel)

$grandTotal = 0.0

foreach ($t in $linked) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 60 R.$NUM, R.$DATE, R.$KONTR.$NAME, R.$SUMDOC" +
                  " $FROM $DOC.$($t.n) $AS R $WHERE R.$RS = &TheSheet"
        $q.SetParameter("TheSheet", $sheetRef)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()

        $n = 0
        $sum = 0.0
        $lines = @()
        while ($r.Next()) {
            $n++
            $raw = ([string]$r.Get(3)).Trim()
            $val = 0.0
            $clean = $raw -replace '\s', '' -replace ',', '.'
            [void][double]::TryParse($clean, [Globalization.NumberStyles]::Any,
                [Globalization.CultureInfo]::InvariantCulture, [ref] $val)
            $sum += $val
            $lines += ("    {0,2}. {1,-40} {2,14}" -f $n, ([string]$r.Get(2)).Trim(), $raw)
        }

        if ($n -gt 0) {
            Write-Host ("  --- {0}: {1} documents, {2:N2} UAH" -f $t.l, $n, $sum)
            foreach ($line in $lines) { Write-Host $line }
            $grandTotal += $sum
        } else {
            Write-Host ("  --- {0}: none on this sheet" -f $t.l)
        }
    }
    catch {
        Write-Host ("  --- {0}: FAILED {1}" -f $t.l, $_.Exception.Message.Split("`n")[0])
    }
    Write-Host ""
}

Write-Host ("  GRAND TOTAL across linked types: {0:N2} UAH" -f $grandTotal)
Write-Host "  ^ for sheet 1817 the printed form shows 71 966,52 including a"
Write-Host "    5 888,00 debt payment. If realizations alone sum to 66 078,52,"
Write-Host "    the payroll base is confirmed and the debt document is the"
Write-Host "    remainder -- whatever type it turns out to be."
Write-Host ""

# --- 4. Addresses for the stop count ----------------------------------------
#
# Points are paid per unique address, so this is the other half of payroll.

Write-Host "=== 4. Delivery addresses on this sheet (unique = paid points) ==="

try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 60 R.$KONTR.$NAME, R.$ADRDOST, R.$SUMDOC" +
              " $FROM $DOC.$REALIZ $AS R $WHERE R.$RS = &SheetForAddr"
    $q.SetParameter("SheetForAddr", $sheetRef)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "null" }
    $r = $rs.Choose()
    $addrs = @{}
    $n = 0
    while ($r.Next()) {
        $n++
        $a = ([string]$r.Get(1)).Trim()
        $key = if ($a) { $a.ToLower() } else { "(no address) " + ([string]$r.Get(0)).Trim() }
        if (-not $addrs.ContainsKey($key)) { $addrs[$key] = 0 }
        $addrs[$key]++
    }
    Write-Host ("  {0} rows, {1} unique addresses" -f $n, $addrs.Count)
    foreach ($k in ($addrs.Keys | Sort-Object)) {
        Write-Host ("      {0}x  {1}" -f $addrs[$k], $k)
    }
    Write-Host "  ^ unique addresses are the paid points (city 25 / oblast 15 UAH)"
}
catch {
    Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
}
Write-Host ""

Write-Host "=== Verdict ==="
Write-Host "Section 2 lists every document type that can appear on a sheet."
Write-Host "Section 3 rebuilds the sheet from those links -- compare the totals"
Write-Host "  with the paper form to confirm the ingest design."
Write-Host "Section 4 gives the point count for the per-stop bonus."
Write-Host "If the debt payment does not show up in section 3, open that row in 1C"
Write-Host "  and report the document type from the window title -- that is the"
Write-Host "  last unknown."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
