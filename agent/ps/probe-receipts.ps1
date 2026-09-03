# Probe: Dokument.PostuplenieTovarovUslug -- what the goods-receipt document
# actually carries on THIS base.
#
# The purchase channel has a receiver on the site (purchase_doc ->
# PurchaseOrder) and, until now, no producer here at all: queries.json had no
# receipt query, PurchaseOrder was empty, and every purchase figure read zero.
#
# probe-coverage.ps1 already proved the essentials on live data: 918 posted
# documents worth 27,190,824.32 UAH over twelve months, and a Tovary tabular
# section carrying Nomenklatura/Kolichestvo/Cena/Summa. Those six header
# columns are therefore settled and are shipped by the agent as they are.
#
# What is NOT settled is everything optional -- warehouse, currency, rate,
# operation kind, deletion mark, line number. Guessing an attribute name is
# not cheap here: a wrong one fails Execute() with a bare
# NullReferenceException that names nothing, and takes the whole query with
# it. Hence every candidate below is its own query in its own try/catch, and
# section 11 prints the exact column set that is safe to append to
# receiptsSince.
#
# READ-ONLY -- every statement is a SELECT. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-receipts.ps1
#
# This file is pure ASCII on purpose: PowerShell 5 decodes .ps1 in the OEM
# codepage and mangles Cyrillic literals, so query text is built from char
# codes via C().

[CmdletBinding()]
param(
    [string] $ConfigPath = "C:\Users\fedyshyn\budvik-agent\ps\config.json",
    [int] $Years = 3,
    [int] $Months = 12
)

$ErrorActionPreference = "Stop"

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

# The agent has moved between layouts, so the config is searched rather than
# assumed: a wrong guess costs a whole round trip through the RDP session.
if (-not (Test-Path $ConfigPath)) {
    $candidates = @(
        "C:\Users\fedyshyn\budvik-agent\ps\config.json",
        "C:\Users\fedyshyn\budvik-agent\config.json",
        "C:\budvik-agent\ps\config.json",
        "C:\budvik-agent\config.json"
    )
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
    if ($here) { $candidates += (Join-Path $here "config.json") }

    $ConfigPath = $null
    foreach ($cand in $candidates) {
        if (Test-Path $cand) { $ConfigPath = $cand; break }
    }
    if (-not $ConfigPath) {
        foreach ($root in @("C:\Users\fedyshyn\budvik-agent", "C:\budvik-agent", "C:\Users\fedyshyn")) {
            if (-not (Test-Path $root)) { continue }
            $hit = Get-ChildItem -Path $root -Filter "config.json" -Recurse -ErrorAction SilentlyContinue |
                   Select-Object -First 1
            if ($hit) { $ConfigPath = $hit.FullName; break }
        }
    }
    if (-not $ConfigPath) {
        throw "config.json not found anywhere under budvik-agent. Pass -ConfigPath <full path>"
    }
    Write-Host "using config: $ConfigPath"
}

$config = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$connString = 'Srvr="' + $config.oneC.server + '";Ref="' + $config.oneC.base +
              '";Usr="' + $config.oneC.user + '";Pwd="' + $config.oneC.password + '";'

Write-Host "connecting..."
$connector = New-Object -ComObject V82.COMConnector
$ib = $connector.Connect($connString)
Write-Host "connected"
Write-Host ""

# --- query vocabulary, built from char codes -------------------------------
$SELECT     = C 0x412,0x42b,0x411,0x420,0x410,0x422,0x42c # \u0412\u042b\u0411\u0420\u0410\u0422\u042c
$FIRST      = C 0x41f,0x415,0x420,0x412,0x42b,0x415 # \u041f\u0415\u0420\u0412\u042b\u0415
$FROM       = C 0x418,0x417 # \u0418\u0417
$AS         = C 0x41a,0x410,0x41a # \u041a\u0410\u041a
$WHERE      = C 0x413,0x414,0x415 # \u0413\u0414\u0415
$AND        = C 0x418  # \u0418
$DOC        = C 0x414,0x43e,0x43a,0x443,0x43c,0x435,0x43d,0x442 # \u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442
$POS        = C 0x41f,0x43e,0x441,0x442,0x443,0x43f,0x43b,0x435,0x43d,0x438,0x435,0x422,0x43e,0x432,0x430,0x440,0x43e,0x432,0x423,0x441,0x43b,0x443,0x433 # \u041f\u043e\u0441\u0442\u0443\u043f\u043b\u0435\u043d\u0438\u0435\u0422\u043e\u0432\u0430\u0440\u043e\u0432\u0423\u0441\u043b\u0443\u0433
$GOODS      = C 0x422,0x43e,0x432,0x430,0x440,0x44b # \u0422\u043e\u0432\u0430\u0440\u044b
$SERVICES   = C 0x423,0x441,0x43b,0x443,0x433,0x438 # \u0423\u0441\u043b\u0443\u0433\u0438
$REF        = C 0x421,0x441,0x44b,0x43b,0x43a,0x430 # \u0421\u0441\u044b\u043b\u043a\u0430
$NUM        = C 0x41d,0x43e,0x43c,0x435,0x440 # \u041d\u043e\u043c\u0435\u0440
$DATE       = C 0x414,0x430,0x442,0x430 # \u0414\u0430\u0442\u0430
$POSTED     = C 0x41f,0x440,0x43e,0x432,0x435,0x434,0x435,0x43d # \u041f\u0440\u043e\u0432\u0435\u0434\u0435\u043d
$DELMARK    = C 0x41f,0x43e,0x43c,0x435,0x442,0x43a,0x430,0x423,0x434,0x430,0x43b,0x435,0x43d,0x438,0x44f # \u041f\u043e\u043c\u0435\u0442\u043a\u0430\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u044f
$SUMDOC     = C 0x421,0x443,0x43c,0x43c,0x430,0x414,0x43e,0x43a,0x443,0x43c,0x435,0x43d,0x442,0x430 # \u0421\u0443\u043c\u043c\u0430\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430
$KONTR      = C 0x41a,0x43e,0x43d,0x442,0x440,0x430,0x433,0x435,0x43d,0x442 # \u041a\u043e\u043d\u0442\u0440\u0430\u0433\u0435\u043d\u0442
$NAME       = C 0x41d,0x430,0x438,0x43c,0x435,0x43d,0x43e,0x432,0x430,0x43d,0x438,0x435 # \u041d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435
$PARAM      = C 0x414,0x430,0x442,0x430,0x421 # \u0414\u0430\u0442\u0430\u0421
$SKLAD      = C 0x421,0x43a,0x43b,0x430,0x434 # \u0421\u043a\u043b\u0430\u0434
$VALUTA     = C 0x412,0x430,0x43b,0x44e,0x442,0x430,0x414,0x43e,0x43a,0x443,0x43c,0x435,0x43d,0x442,0x430 # \u0412\u0430\u043b\u044e\u0442\u0430\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430
$KURS       = C 0x41a,0x443,0x440,0x441,0x412,0x437,0x430,0x438,0x43c,0x43e,0x440,0x430,0x441,0x447,0x435,0x442,0x43e,0x432 # \u041a\u0443\u0440\u0441\u0412\u0437\u0430\u0438\u043c\u043e\u0440\u0430\u0441\u0447\u0435\u0442\u043e\u0432
$KRATN      = C 0x41a,0x440,0x430,0x442,0x43d,0x43e,0x441,0x442,0x44c,0x412,0x437,0x430,0x438,0x43c,0x43e,0x440,0x430,0x441,0x447,0x435,0x442,0x43e,0x432 # \u041a\u0440\u0430\u0442\u043d\u043e\u0441\u0442\u044c\u0412\u0437\u0430\u0438\u043c\u043e\u0440\u0430\u0441\u0447\u0435\u0442\u043e\u0432
$VIDOP      = C 0x412,0x438,0x434,0x41e,0x43f,0x435,0x440,0x430,0x446,0x438,0x438 # \u0412\u0438\u0434\u041e\u043f\u0435\u0440\u0430\u0446\u0438\u0438
$OTVET      = C 0x41e,0x442,0x432,0x435,0x442,0x441,0x442,0x432,0x435,0x43d,0x43d,0x44b,0x439 # \u041e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439
$COMMENT    = C 0x41a,0x43e,0x43c,0x43c,0x435,0x43d,0x442,0x430,0x440,0x438,0x439 # \u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439
$NDS_INCL   = C 0x421,0x443,0x43c,0x43c,0x430,0x412,0x43a,0x43b,0x44e,0x447,0x430,0x435,0x442,0x41d,0x414,0x421 # \u0421\u0443\u043c\u043c\u0430\u0412\u043a\u043b\u044e\u0447\u0430\u0435\u0442\u041d\u0414\u0421
$DOGOVOR    = C 0x414,0x43e,0x433,0x43e,0x432,0x43e,0x440,0x41a,0x43e,0x43d,0x442,0x440,0x430,0x433,0x435,0x43d,0x442,0x430 # \u0414\u043e\u0433\u043e\u0432\u043e\u0440\u041a\u043e\u043d\u0442\u0440\u0430\u0433\u0435\u043d\u0442\u0430
$ORG        = C 0x41e,0x440,0x433,0x430,0x43d,0x438,0x437,0x430,0x446,0x438,0x44f # \u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f
$NOMENKL    = C 0x41d,0x43e,0x43c,0x435,0x43d,0x43a,0x43b,0x430,0x442,0x443,0x440,0x430 # \u041d\u043e\u043c\u0435\u043d\u043a\u043b\u0430\u0442\u0443\u0440\u0430
$KOLVO      = C 0x41a,0x43e,0x43b,0x438,0x447,0x435,0x441,0x442,0x432,0x43e # \u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e
$CENA       = C 0x426,0x435,0x43d,0x430 # \u0426\u0435\u043d\u0430
$SUMMA      = C 0x421,0x443,0x43c,0x43c,0x430 # \u0421\u0443\u043c\u043c\u0430
$LINENO     = C 0x41d,0x43e,0x43c,0x435,0x440,0x421,0x442,0x440,0x43e,0x43a,0x438 # \u041d\u043e\u043c\u0435\u0440\u0421\u0442\u0440\u043e\u043a\u0438
$KOEF       = C 0x41a,0x43e,0x44d,0x444,0x444,0x438,0x446,0x438,0x435,0x43d,0x442 # \u041a\u043e\u044d\u0444\u0444\u0438\u0446\u0438\u0435\u043d\u0442
$STAVKANDS  = C 0x421,0x442,0x430,0x432,0x43a,0x430,0x41d,0x414,0x421 # \u0421\u0442\u0430\u0432\u043a\u0430\u041d\u0414\u0421
$SUMMANDS   = C 0x421,0x443,0x43c,0x43c,0x430,0x41d,0x414,0x421 # \u0421\u0443\u043c\u043c\u0430\u041d\u0414\u0421
$USLUGA     = C 0x423,0x441,0x43b,0x443,0x433,0x430 # \u0423\u0441\u043b\u0443\u0433\u0430
$EDIN       = C 0x415,0x434,0x438,0x43d,0x438,0x446,0x430,0x418,0x437,0x43c,0x435,0x440,0x435,0x43d,0x438,0x44f # \u0415\u0434\u0438\u043d\u0438\u0446\u0430\u0418\u0437\u043c\u0435\u0440\u0435\u043d\u0438\u044f
$POSTAV     = C 0x41f,0x43e,0x441,0x442,0x430,0x432,0x449,0x438,0x43a # \u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a
$POKUP      = C 0x41f,0x43e,0x43a,0x443,0x43f,0x430,0x442,0x435,0x43b,0x44c # \u041f\u043e\u043a\u0443\u043f\u0430\u0442\u0435\u043b\u044c
$COUNT      = C 0x41a,0x41e,0x41b,0x418,0x427,0x415,0x421,0x422,0x412,0x41e # \u041a\u041e\u041b\u0418\u0427\u0415\u0421\u0422\u0412\u041e
$SUM        = C 0x421,0x423,0x41c,0x41c,0x410 # \u0421\u0423\u041c\u041c\u0410
$GROUPBY    = C 0x421,0x413,0x420,0x423,0x41f,0x41f,0x418,0x420,0x41e,0x412,0x410,0x422,0x42c,0x20,0x41f,0x41e # \u0421\u0413\u0420\u0423\u041f\u041f\u0418\u0420\u041e\u0412\u0410\u0422\u042c \u041f\u041e
$HAVING     = C 0x418,0x41c,0x415,0x42e,0x429,0x418,0x415 # \u0418\u041c\u0415\u042e\u0429\u0418\u0415
$DISTINCT   = C 0x420,0x410,0x417,0x41b,0x418,0x427,0x41d,0x42b,0x415 # \u0420\u0410\u0417\u041b\u0418\u0427\u041d\u042b\u0415
$PRESENT    = C 0x41f,0x420,0x415,0x414,0x421,0x422,0x410,0x412,0x41b,0x415,0x41d,0x418,0x415 # \u041f\u0420\u0415\u0414\u0421\u0422\u0410\u0412\u041b\u0415\u041d\u0418\u0415
$YEAR       = C 0x413,0x41e,0x414 # \u0413\u041e\u0414
$SPRAV      = C 0x421,0x43f,0x440,0x430,0x432,0x43e,0x447,0x43d,0x438,0x43a # \u0421\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0438\u043a
$KONTRAGENTY = C 0x41a,0x43e,0x43d,0x442,0x440,0x430,0x433,0x435,0x43d,0x442,0x44b # \u041a\u043e\u043d\u0442\u0440\u0430\u0433\u0435\u043d\u0442\u044b
$KOD        = C 0x41a,0x43e,0x434 # Kod
$NOT        = C 0x41d,0x415 # NE

$sinceYears  = (Get-Date).AddYears(-$Years)
$sinceMonths = (Get-Date).AddMonths(-$Months)

function RefId($value) {
    if ($null -eq $value) { return $null }
    try { return [string]$ib.XMLString($value) } catch { return $null }
}

function AsText($value) {
    if ($null -eq $value) { return "" }
    return ([string]$value).Trim()
}

# An empty reference serializes to an all-zero GUID -- that is "not filled",
# not "filled with something".
function IsFilledRef($id) {
    if (-not $id) { return $false }
    return ($id -notmatch '^\{?[0-9a-fA-F-]*0{8}-0{4}-0{4}-0{4}-0{12}')
}

# Results of section 2 decide which later sections can run at all.
$hasSklad = $false; $hasCurrency = $false; $hasRate = $false; $hasMult = $false
$hasVidOp = $false; $hasDelMark = $false; $hasLineNo = $false

# ============================================================================
Write-Host ("=== 1. Volume by year (proven columns only), last {0} years ===" -f $Years)
# Baseline for verifying the import afterwards: the site must show the same
# document count and the same posted total for the same window.
$docExists = $false
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT P.$REF, P.$DATE, P.$SUMDOC, P.$POSTED $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM"
    $q.SetParameter($PARAM, $sinceYears)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()
    $docExists = $true

    $byYear = @{}
    $total = 0; $totalAmount = 0.0
    while ($r.Next()) {
        $d = $r.Get(1)
        $year = if ($null -eq $d) { 0 } else { ([datetime]$d).Year }
        if (-not $byYear.ContainsKey($year)) {
            $byYear[$year] = @{ docs = 0; posted = 0; amount = 0.0; postedAmount = 0.0 }
        }
        $amt = $r.Get(2)
        $amtVal = if ($null -eq $amt) { 0.0 } else { [double]$amt }
        $byYear[$year].docs++
        $byYear[$year].amount += $amtVal
        if ([bool]$r.Get(3)) {
            $byYear[$year].posted++
            $byYear[$year].postedAmount += $amtVal
        }
        $total++; $totalAmount += $amtVal
    }
    foreach ($y in ($byYear.Keys | Sort-Object)) {
        Write-Host ("  {0}  {1,6} docs ({2} posted)  {3,16:N2} UAH, {4,16:N2} posted" -f `
            $y, $byYear[$y].docs, $byYear[$y].posted, $byYear[$y].amount, $byYear[$y].postedAmount)
    }
    Write-Host ("  TOTAL {0} docs, {1:N2} UAH" -f $total, $totalAmount)
    Write-Host "  ^ this is the baseline the imported data must match."
}
catch {
    Write-Host ("ABSENT / FAILED: " + $_.Exception.Message)
    Write-Host "  Without the document itself there is nothing to sync -- stop and report."
}
Write-Host ""

if (-not $docExists) {
    if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
    if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
    [GC]::Collect()
    exit 0
}

# ============================================================================
Write-Host "=== 2. Header attributes: existence + fill rate (last 60 documents) ==="
# Two columns per query on purpose: "VYBRAT PERVYE 1 <single field>" is
# unreliable on this build, a second column makes it behave.
$headerFields = @(
    @{ key = "Sklad";              field = $SKLAD },
    @{ key = "ValyutaDokumenta";   field = $VALUTA },
    @{ key = "KursVzaimoraschetov";     field = $KURS },
    @{ key = "KratnostVzaimoraschetov"; field = $KRATN },
    @{ key = "VidOperacii";        field = $VIDOP },
    @{ key = "PometkaUdaleniya";   field = $DELMARK },
    @{ key = "Otvetstvennyi";      field = $OTVET },
    @{ key = "DogovorKontragenta"; field = $DOGOVOR },
    @{ key = "Organizaciya";       field = $ORG },
    @{ key = "SummaVklyuchaetNDS"; field = $NDS_INCL },
    @{ key = "Kommentariy";        field = $COMMENT }
)

foreach ($f in $headerFields) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 60 P.$REF, P.$($f.field) $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $sinceMonths)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $rows = 0; $filled = 0; $sample = ""
        while ($r.Next()) {
            $rows++
            $v = $r.Get(1)
            $id = RefId $v
            $txt = AsText $v
            $isFilled = $false
            if ($id) {
                if (IsFilledRef $id) { $isFilled = $true; if (-not $sample) { $sample = $id } }
            }
            elseif ($txt -ne "" -and $txt -ne "0" -and $txt -ne "0,00" -and $txt -ne "False") {
                $isFilled = $true
                if (-not $sample) { $sample = $txt }
            }
            if ($isFilled) { $filled++ }
        }
        Write-Host ("OK      {0,-26} {1,3}/{2,-3} filled   sample: {3}" -f $f.key, $filled, $rows, $sample)
        switch ($f.key) {
            "Sklad"                   { $script:hasSklad = $true }
            "ValyutaDokumenta"        { $script:hasCurrency = $true }
            "KursVzaimoraschetov"     { $script:hasRate = $true }
            "KratnostVzaimoraschetov" { $script:hasMult = $true }
            "VidOperacii"             { $script:hasVidOp = $true }
            "PometkaUdaleniya"        { $script:hasDelMark = $true }
        }
    }
    catch {
        Write-Host ("ABSENT  {0}" -f $f.key)
    }
}
Write-Host ""

# ============================================================================
Write-Host "=== 3. Currency split ==="
# A currency document keeps prices in the contract currency while the site
# counts in hryvnia. Without the rate from the document header those sums
# would sit in the same reports as hryvnia ones and nobody would see it.
if ($hasCurrency) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT P.$VALUTA.$KOD, $COUNT(*) $AS N, $SUM(P.$SUMDOC) $AS S" +
                  " $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM $AND P.$POSTED" +
                  " $GROUPBY P.$VALUTA.$KOD"
        $q.SetParameter($PARAM, $sinceMonths)
        $rs = $q.Execute()
        $r = $rs.Choose()
        while ($r.Next()) {
            $code = AsText $r.Get(0)
            if (-not $code) { $code = "(empty)" }
            Write-Host ("  currency {0,-8} {1,5} docs  {2,16:N2}" -f $code, $r.Get(1), $r.Get(2))
        }
        Write-Host "  980 = hryvnia. Anything else needs the rate below."
    } catch { Write-Host ("  FAILED -- " + $_.Exception.Message) }

    if ($hasRate) {
        try {
            $q = $ib.NewObject("Query")
            $q.Text = "$SELECT $FIRST 20 P.$NUM, P.$VALUTA.$KOD, P.$KURS" +
                      " $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM"
            $q.SetParameter($PARAM, $sinceMonths)
            $rs = $q.Execute()
            $r = $rs.Choose()
            $shown = 0
            while ($r.Next() -and $shown -lt 8) {
                $code = AsText $r.Get(1)
                if ($code -and $code -ne "980") {
                    Write-Host ("    #{0} currency {1} rate {2}" -f (AsText $r.Get(0)), $code, $r.Get(2))
                    $shown++
                }
            }
            if ($shown -eq 0) { Write-Host "    (no non-hryvnia documents in the sample)" }
        } catch { Write-Host ("  rate sample FAILED -- " + $_.Exception.Message) }
    }
} else {
    Write-Host "  ValyutaDokumenta absent -- every document is in the accounting currency."
}
Write-Host ""

# ============================================================================
Write-Host "=== 4. Operation kinds ==="
# Not every receipt is a purchase: commission and tolling arrive through the
# same document in some configurations, and those must not become purchases.
if ($hasVidOp) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $PRESENT(P.$VIDOP) $AS V, $COUNT(*) $AS N, $SUM(P.$SUMDOC) $AS S" +
                  " $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM $AND P.$POSTED" +
                  " $GROUPBY $PRESENT(P.$VIDOP)"
        $q.SetParameter($PARAM, $sinceMonths)
        $rs = $q.Execute()
        $r = $rs.Choose()
        while ($r.Next()) {
            Write-Host ("  {0,-40} {1,5} docs  {2,16:N2}" -f (AsText $r.Get(0)), $r.Get(1), $r.Get(2))
        }
    } catch { Write-Host ("  FAILED -- " + $_.Exception.Message) }
} else {
    Write-Host "  VidOperacii absent -- nothing to split by."
}
Write-Host ""

# ============================================================================
Write-Host ("=== 5. Posted / unposted / deletion-marked, last {0} months ===" -f $Months)
try {
    $sel = "$SELECT $COUNT(*) $AS N $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM"
    foreach ($case in @(
        @{ name = "all";      cond = "" },
        @{ name = "posted";   cond = " $AND P.$POSTED" },
        @{ name = "unposted"; cond = " $AND $NOT P.$POSTED" }
    )) {
        $q = $ib.NewObject("Query")
        $q.Text = $sel + $case.cond
        $q.SetParameter($PARAM, $sinceMonths)
        $rs = $q.Execute()
        $r = $rs.Choose()
        if ($r.Next()) { Write-Host ("  {0,-10} {1}" -f $case.name, $r.Get(0)) }
    }
    if ($hasDelMark) {
        $q = $ib.NewObject("Query")
        $q.Text = $sel + " $AND P.$DELMARK"
        $q.SetParameter($PARAM, $sinceMonths)
        $rs = $q.Execute()
        $r = $rs.Choose()
        if ($r.Next()) { Write-Host ("  {0,-10} {1}" -f "deleted", $r.Get(0)) }
    }
} catch { Write-Host ("  FAILED -- " + $_.Exception.Message) }
Write-Host ""

# ============================================================================
Write-Host "=== 6. Warehouses on receipts ==="
# The GUID must be the same one queries.warehouses hands out -- that is what
# StockLocation.externalId is matched on.
if ($hasSklad) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT P.$SKLAD.$NAME $AS W, $COUNT(*) $AS N $FROM $DOC.$POS $AS P" +
                  " $WHERE P.$DATE >= &$PARAM $AND P.$POSTED $GROUPBY P.$SKLAD.$NAME"
        $q.SetParameter($PARAM, $sinceMonths)
        $rs = $q.Execute()
        $r = $rs.Choose()
        while ($r.Next()) {
            Write-Host ("  {0,-40} {1,5} docs" -f (AsText $r.Get(0)), $r.Get(1))
        }
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 3 P.$NUM, P.$SKLAD $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM $AND P.$POSTED"
        $q.SetParameter($PARAM, $sinceMonths)
        $rs = $q.Execute()
        $r = $rs.Choose()
        while ($r.Next()) {
            Write-Host ("    #{0} warehouse GUID {1}" -f (AsText $r.Get(0)), (RefId $r.Get(1)))
        }
        Write-Host "  ^ compare with the GUIDs the warehouse channel already sends."
    } catch { Write-Host ("  FAILED -- " + $_.Exception.Message) }
} else {
    Write-Host "  Sklad absent in the header -- receipts cannot name a warehouse."
}
Write-Host ""

# ============================================================================
Write-Host "=== 7. Tabular section Tovary ==="
$itemFields = @(
    @{ key = "Nomenklatura";  field = $NOMENKL },
    @{ key = "Kolichestvo";   field = $KOLVO },
    @{ key = "Cena";          field = $CENA },
    @{ key = "Summa";         field = $SUMMA },
    @{ key = "NomerStroki";   field = $LINENO },
    @{ key = "Koefficient";   field = $KOEF },
    @{ key = "EdinicaIzmereniya"; field = $EDIN },
    @{ key = "StavkaNDS";     field = $STAVKANDS },
    @{ key = "SummaNDS";      field = $SUMMANDS }
)
foreach ($f in $itemFields) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 60 T.$REF, T.$($f.field) $FROM $DOC.$POS.$GOODS $AS T"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $rows = 0; $filled = 0; $sample = ""
        while ($r.Next()) {
            $rows++
            $v = $r.Get(1)
            $id = RefId $v
            $txt = AsText $v
            if ($id) {
                if (IsFilledRef $id) { $filled++; if (-not $sample) { $sample = $id } }
            }
            elseif ($txt -ne "" -and $txt -ne "0") {
                $filled++
                if (-not $sample) { $sample = $txt }
            }
        }
        Write-Host ("OK      {0,-20} {1,3}/{2,-3} filled   sample: {3}" -f $f.key, $filled, $rows, $sample)
        if ($f.key -eq "NomerStroki") { $script:hasLineNo = $true }
    }
    catch {
        Write-Host ("ABSENT  {0}" -f $f.key)
    }
}

# A separate Uslugi section would mean services never pollute Tovary -- which
# is exactly what the ingest assumes.
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $COUNT(*) $AS N $FROM $DOC.$POS.$SERVICES $AS T"
    $rs = $q.Execute()
    $r = $rs.Choose()
    if ($r.Next()) { Write-Host ("  separate Uslugi section EXISTS, {0} rows total" -f $r.Get(0)) }
} catch {
    Write-Host "  no separate Uslugi section (services, if any, sit in Tovary)"
}

# Lines whose price lives only in Summa would import at zero.
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 500 T.$KOLVO, T.$CENA, T.$SUMMA, T.$NOMENKL $FROM $DOC.$POS.$GOODS $AS T"
    $rs = $q.Execute()
    $r = $rs.Choose()
    $rows = 0; $zeroPrice = 0; $noProduct = 0
    while ($r.Next()) {
        $rows++
        $price = if ($null -eq $r.Get(1)) { 0 } else { [double]$r.Get(1) }
        $sum   = if ($null -eq $r.Get(2)) { 0 } else { [double]$r.Get(2) }
        if ($price -eq 0 -and $sum -ne 0) { $zeroPrice++ }
        if (-not (IsFilledRef (RefId $r.Get(3)))) { $noProduct++ }
    }
    Write-Host ("  of {0} sampled lines: {1} with Cena=0 but Summa<>0, {2} with no Nomenklatura" -f $rows, $zeroPrice, $noProduct)
} catch { Write-Host ("  line sanity FAILED -- " + $_.Exception.Message) }
Write-Host ""

# ============================================================================
Write-Host "=== 8. Five posted documents with their lines ==="
# Lines are read by date and grouped here: filtering a tabular section by
# document reference fails on this build (see _routeSheetsComment).
try {
    $heads = @{}
    $order = New-Object Collections.Generic.List[string]
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 5 P.$REF, P.$NUM, P.$DATE, P.$KONTR.$NAME, P.$SUMDOC" +
              " $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM $AND P.$POSTED"
    $q.SetParameter($PARAM, $sinceMonths)
    $rs = $q.Execute()
    $r = $rs.Choose()
    while ($r.Next()) {
        $id = RefId $r.Get(0)
        if (-not $id) { continue }
        $heads[$id] = @{ num = AsText $r.Get(1); date = $r.Get(2); cp = AsText $r.Get(3);
                         total = $r.Get(4); lines = 0; sum = 0.0 }
        [void]$order.Add($id)
    }

    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT T.$REF, T.$NOMENKL.$NAME, T.$KOLVO, T.$CENA, T.$SUMMA" +
              " $FROM $DOC.$POS.$GOODS $AS T $WHERE T.$REF.$DATE >= &$PARAM"
    $q.SetParameter($PARAM, $sinceMonths)
    $rs = $q.Execute()
    $r = $rs.Choose()
    $samples = @{}
    while ($r.Next()) {
        $docId = RefId $r.Get(0)
        if (-not $docId -or -not $heads.ContainsKey($docId)) { continue }
        $heads[$docId].lines++
        $s = $r.Get(4)
        $heads[$docId].sum += $(if ($null -eq $s) { 0.0 } else { [double]$s })
        if (-not $samples.ContainsKey($docId)) {
            $samples[$docId] = New-Object Collections.Generic.List[string]
        }
        if ($samples[$docId].Count -lt 3) {
            [void]$samples[$docId].Add(("{0} | qty {1} x {2} = {3}" -f (AsText $r.Get(1)), $r.Get(2), $r.Get(3), $s))
        }
    }

    foreach ($id in $order) {
        $h = $heads[$id]
        Write-Host ("  #{0} {1:yyyy-MM-dd} {2}" -f $h.num, $h.date, $h.cp)
        Write-Host ("     header total {0:N2}, {1} lines summing {2:N2}{3}" -f `
            $h.total, $h.lines, $h.sum, $(if ([Math]::Abs([double]$h.total - $h.sum) -gt 0.01) { "  <-- DIFFERS (VAT on top?)" } else { "" }))
        if ($samples.ContainsKey($id)) {
            foreach ($ln in $samples[$id]) { Write-Host ("       " + $ln) }
        }
    }
} catch { Write-Host ("  FAILED -- " + $_.Exception.Message) }
Write-Host ""

# ============================================================================
Write-Host "=== 9. Document numbers: format and duplicates across years ==="
# PurchaseOrder.number is globally unique on the site, while a 1C number is
# unique only within its year. The ingest appends the year on collision --
# this section says how often that will actually happen.
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT P.$NUM, P.$DATE $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM"
    $q.SetParameter($PARAM, $sinceYears)
    $rs = $q.Execute()
    $r = $rs.Choose()
    $seen = @{}
    $dupYears = 0; $dupSame = 0; $rows = 0
    $minLen = 999; $maxLen = 0; $allDigits = $true
    while ($r.Next()) {
        $rows++
        $num = AsText $r.Get(0)
        $d = $r.Get(1)
        $year = if ($null -eq $d) { 0 } else { ([datetime]$d).Year }
        if ($num.Length -lt $minLen) { $minLen = $num.Length }
        if ($num.Length -gt $maxLen) { $maxLen = $num.Length }
        if ($num -notmatch '^[0-9]+$') { $allDigits = $false }
        if (-not $seen.ContainsKey($num)) { $seen[$num] = @{} }
        if ($seen[$num].ContainsKey($year)) { $dupSame++ } else { $seen[$num][$year] = 1 }
    }
    foreach ($k in $seen.Keys) { if ($seen[$k].Count -gt 1) { $dupYears++ } }
    Write-Host ("  {0} documents, number length {1}..{2}, digits only: {3}" -f $rows, $minLen, $maxLen, $allDigits)
    Write-Host ("  numbers repeating ACROSS years: {0}" -f $dupYears)
    Write-Host ("  numbers repeating WITHIN one year: {0}" -f $dupSame)
} catch { Write-Host ("  FAILED -- " + $_.Exception.Message) }
Write-Host ""

# ============================================================================
Write-Host "=== 10. Are receipt counterparties flagged as suppliers? ==="
# The site refuses a receipt whose supplier it cannot find, and its supplier
# picker lists SUPPLIER/BOTH only. If receipts come from counterparties the
# catalogue does not flag, the ingest must promote them on the document.
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $DISTINCT P.$KONTR, P.$KONTR.$POSTAV, P.$KONTR.$POKUP, P.$KONTR.$NAME" +
              " $FROM $DOC.$POS $AS P $WHERE P.$DATE >= &$PARAM $AND P.$POSTED"
    $q.SetParameter($PARAM, $sinceMonths)
    $rs = $q.Execute()
    $r = $rs.Choose()
    $total = 0; $flagged = 0; $notFlagged = 0
    $examples = New-Object Collections.Generic.List[string]
    while ($r.Next()) {
        $total++
        if ([bool]$r.Get(1)) { $flagged++ }
        else {
            $notFlagged++
            if ($examples.Count -lt 5) { [void]$examples.Add((AsText $r.Get(3))) }
        }
    }
    Write-Host ("  {0} counterparties supplied goods; {1} flagged Postavshchik, {2} NOT" -f $total, $flagged, $notFlagged)
    foreach ($e in $examples) { Write-Host ("    not flagged: " + $e) }
} catch { Write-Host ("  FAILED -- " + $_.Exception.Message) }
Write-Host ""

# ============================================================================
Write-Host "=== 11. RECOMMENDED COLUMN SET for receiptsSince ==="
Write-Host "  Fixed (already shipped): Ssylka, Nomer, Data, Kontragent, SummaDokumenta, Proveden"
$optional = New-Object Collections.Generic.List[string]
if ($hasDelMark)  { [void]$optional.Add("PometkaUdaleniya  (position 6)") }
if ($hasSklad)    { [void]$optional.Add("Sklad             (position 7)") }
if ($hasCurrency) { [void]$optional.Add("ValyutaDokumenta.Kod (position 8)") }
if ($hasRate)     { [void]$optional.Add("KursVzaimoraschetov  (position 9)") }
if ($hasMult)     { [void]$optional.Add("KratnostVzaimoraschetov (position 10)") }
if ($optional.Count -eq 0) {
    Write-Host "  No optional column is safe on this base -- ship the six proven ones only."
} else {
    Write-Host "  Safe to append, in THIS order:"
    foreach ($o in $optional) { Write-Host ("    " + $o) }
}
if (-not $hasLineNo) {
    Write-Host "  NomerStroki is ABSENT -- drop it from receiptItemsSince and do not send lineNo."
}
Write-Host ""
Write-Host "=== What to do with these findings ==="
Write-Host "1. Section 1 = the baseline to verify the import against."
Write-Host "2. Section 11 = the exact columns to append to receiptsSince in queries.json."
Write-Host "3. Section 3: any non-980 currency means the rate column is mandatory,"
Write-Host "   otherwise the site logs FOREIGN_CURRENCY_NO_RATE and leaves sums as they are."
Write-Host "4. Section 4: operation kinds that are not purchases (commission, tolling)"
Write-Host "   would need a filter in receiptsSince."
Write-Host "5. Section 10: unflagged suppliers are promoted to BOTH by the ingest;"
Write-Host "   a large number here is expected, not a problem."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
