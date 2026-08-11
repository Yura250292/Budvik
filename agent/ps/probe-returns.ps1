# Probe: Dokument.VozvratTovarovOtPokupatelya -- does it exist, what does it
# carry, and can a return be tied back to the realization it reverses?
#
# The exchange reads three documents today (orders, realizations, PKO). Returns
# are not read at all, so every rep's turnover is overstated by exactly the
# returned amount -- while the debt figure, which comes from the settlement
# register, already nets them out. The two numbers disagree by construction.
#
# Before wiring returnsSince into queries.json the field names must be PROVEN,
# not guessed: a wrong attribute name fails Execute() with a bare
# NullReferenceException that names nothing. Hence every candidate is its own
# query in its own try/catch.
#
# Section 3 answers a question that decides the sales-rep mapping: realizations
# take the rep from Menedzher (Otvetstvennyi is the storekeeper who posts the
# shipment -- see _salesRepComment in queries.json). Whether the same holds for
# returns cannot be assumed.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-returns.ps1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Years = 3
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

# Cyrillic must not appear as a literal in this file: PS5 reads .ps1 in the OEM
# codepage and mangles it (or breaks the parser). Everything is built from char
# codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$AND    = C 1048                                                   # I
$REFOP  = C 1057,1057,1067,1051,1050,1040                          # SSYLKA (operator)
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REG    = C 1056,1077,1075,1080,1089,1090,1088,1053,1072,1082,1086,1087,1083,1077,1085,1080,1103  # RegistrNakopleniya

$RET    = C 1042,1086,1079,1074,1088,1072,1090,1058,1086,1074,1072,1088,1086,1074,1054,1090,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # VozvratTovarovOtPokupatelya
$GOODS  = C 1058,1086,1074,1072,1088,1099                          # Tovary

$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$DELMARK= C 1055,1086,1084,1077,1090,1082,1072,1059,1076,1072,1083,1077,1085,1080,1103  # PometkaUdaleniya
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$PERIOD = C 1055,1077,1088,1080,1086,1076                          # Period
$REGISTRAR = C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088  # Registrator
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS

$since = (Get-Date).AddYears(-$Years)

function RefId($value) {
    if ($null -eq $value) { return $null }
    try { return [string]$ib.XMLString($value) } catch { return $null }
}

function AsText($value) {
    if ($null -eq $value) { return "" }
    return ([string]$value).Trim()
}

# --- 1. Does the document exist, and how much of it is there? ----------------
#
# If this section fails, the document is absent from the configuration and the
# whole returns workstream is moot -- stop and report that.

Write-Host ("=== 1. VozvratTovarovOtPokupatelya volume, last {0} years ===" -f $Years)

$docExists = $false
$totalDocs = 0
$totalAmount = 0.0
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT V.$REF, V.$DATE, V.$SUMDOC, V.$POSTED, V.$DELMARK" +
              " $FROM $DOC.$RET $AS V $WHERE V.$DATE >= &$PARAM"
    $q.SetParameter($PARAM, $since)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()

    $docExists = $true
    $byYear = @{}
    while ($r.Next()) {
        $d = $r.Get(1)
        $year = if ($null -eq $d) { 0 } else { ([datetime]$d).Year }
        if (-not $byYear.ContainsKey($year)) {
            $byYear[$year] = @{ docs = 0; posted = 0; deleted = 0; amount = 0.0; postedAmount = 0.0 }
        }
        $byYear[$year].docs++
        $totalDocs++

        $amt = $r.Get(2)
        $amtVal = if ($null -eq $amt) { 0.0 } else { [double]$amt }
        $byYear[$year].amount += $amtVal
        $totalAmount += $amtVal

        if ([bool]$r.Get(3)) {
            $byYear[$year].posted++
            $byYear[$year].postedAmount += $amtVal
        }
        if ([bool]$r.Get(4)) { $byYear[$year].deleted++ }
    }

    foreach ($y in ($byYear.Keys | Sort-Object)) {
        Write-Host ("  {0}  {1,6} docs ({2} posted, {3} deleted)  {4,14:N2} UAH total, {5,14:N2} posted" -f `
            $y, $byYear[$y].docs, $byYear[$y].posted, $byYear[$y].deleted, `
            $byYear[$y].amount, $byYear[$y].postedAmount)
    }
    if ($totalDocs -eq 0) {
        Write-Host "  (document exists but has no rows in this window)"
    } else {
        Write-Host ("  TOTAL {0} docs, {1:N2} UAH" -f $totalDocs, $totalAmount)
        Write-Host "  ^ these two numbers are the baseline for verifying the import later."
    }
}
catch {
    Write-Host ("ABSENT / FAILED: " + $_.Exception.Message)
    Write-Host "  If the document does not exist, returns cannot be synced at all."
    Write-Host "  Stop here and report; sections below will most likely fail too."
}
Write-Host ""

if (-not $docExists) {
    if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
    if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
    [GC]::Collect()
    exit 0
}

# --- 2. Header attributes ----------------------------------------------------
#
# Two phases per candidate: does the name resolve at all, and if so how often is
# it actually filled. An attribute that exists but is empty in 90% of documents
# is not a usable link.

Write-Host "=== 2. Header attributes (existence + fill rate over last 60 docs) ==="

$KONTR   = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$OTVETST = C 1054,1090,1074,1077,1090,1089,1090,1074,1077,1085,1085,1099,1081  # Otvetstvennyi
$MENEDZH = C 1052,1077,1085,1077,1076,1078,1077,1088                # Menedzher
$SKLAD   = C 1057,1082,1083,1072,1076                               # Sklad
$VIDOP   = C 1042,1080,1076,1054,1087,1077,1088,1072,1094,1080,1080 # VidOperacii
$SDELKA  = C 1057,1076,1077,1083,1082,1072                          # Sdelka
$OSNOV   = C 1054,1089,1085,1086,1074,1072,1085,1080,1077           # Osnovanie
$DOKOSN  = C 1044,1086,1082,1091,1084,1077,1085,1090,1054,1089,1085,1086,1074,1072,1085,1080,1077  # DokumentOsnovanie
$DOKREAL = C 1044,1086,1082,1091,1084,1077,1085,1090,1056,1077,1072,1083,1080,1079,1072,1094,1080,1080  # DokumentRealizacii
$DOGOVOR = C 1044,1086,1075,1086,1074,1086,1088,1050,1086,1085,1090,1088,1072,1075,1077,1085,1090,1072  # DogovorKontragenta
$VALUTA  = C 1042,1072,1083,1102,1090,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # ValyutaDokumenta

$headerFields = @(
    @{ name = "Kontragent";         field = $KONTR },
    @{ name = "SummaDokumenta";     field = $SUMDOC },
    @{ name = "Otvetstvennyi";      field = $OTVETST },
    @{ name = "Menedzher";          field = $MENEDZH },
    @{ name = "Sklad";              field = $SKLAD },
    @{ name = "VidOperacii";        field = $VIDOP },
    @{ name = "ValyutaDokumenta";   field = $VALUTA },
    @{ name = "DogovorKontragenta"; field = $DOGOVOR },
    @{ name = "Sdelka  [LINK?]";            field = $SDELKA },
    @{ name = "Osnovanie  [LINK?]";         field = $OSNOV },
    @{ name = "DokumentOsnovanie  [LINK?]"; field = $DOKOSN },
    @{ name = "DokumentRealizacii  [LINK?]";field = $DOKREAL }
)

foreach ($f in $headerFields) {
    try {
        # Two columns on purpose: "VYBRAT PERVYE 1 <single field>" is unreliable
        # on this build, a second column makes it behave.
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 60 V.$REF, V.$($f.field) $FROM $DOC.$RET $AS V" +
                  " $WHERE V.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $rows = 0
        $filled = 0
        $sample = ""
        while ($r.Next()) {
            $rows++
            $v = $r.Get(1)
            $txt = AsText $v
            $id = RefId $v
            $isFilled = $false
            if ($id) {
                # Reference type: empty refs serialize to an all-zero GUID.
                if ($id -notmatch '^\{?[0-9a-fA-F-]*0{8}-0{4}-0{4}-0{4}-0{12}') { $isFilled = $true }
                if (-not $sample -and $isFilled) { $sample = $id }
            }
            elseif ($txt -ne "" -and $txt -ne "0" -and $txt -ne "0,00") {
                $isFilled = $true
                if (-not $sample) { $sample = $txt }
            }
            if ($isFilled) { $filled++ }
        }
        Write-Host ("OK      {0,-32} {1,3}/{2,-3} filled   sample: {3}" -f $f.name, $filled, $rows, $sample)
    }
    catch {
        Write-Host ("ABSENT  {0}" -f $f.name)
    }
}
Write-Host ""
Write-Host "  A [LINK?] field with a high fill rate means a return can be tied to the"
Write-Host "  realization it reverses. All empty => returns are standalone documents."
Write-Host ""

# --- 3. Who is the rep on a return: Otvetstvennyi or Menedzher? --------------
#
# Same method that proved Menedzher for realizations. Whichever column shows
# many distinct people (rather than a handful of back-office staff) is the one
# to put into returnsSince.

Write-Host "=== 3. Rep column: Otvetstvennyi vs Menedzher (last 60 docs) ==="

foreach ($cand in @(
    @{ name = "Otvetstvennyi"; field = $OTVETST },
    @{ name = "Menedzher";     field = $MENEDZH }
)) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 60 V.$REF, V.$($cand.field).$NAME $FROM $DOC.$RET $AS V" +
                  " $WHERE V.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $people = @{}
        $empty = 0
        $rows = 0
        while ($r.Next()) {
            $rows++
            $n = AsText $r.Get(1)
            if ($n -eq "") { $empty++; continue }
            if (-not $people.ContainsKey($n)) { $people[$n] = 0 }
            $people[$n]++
        }
        Write-Host ("  {0}: {1} rows, {2} distinct people, {3} empty" -f `
            $cand.name, $rows, $people.Count, $empty)
        foreach ($p in ($people.Keys | Sort-Object { -$people[$_] } | Select-Object -First 8)) {
            Write-Host ("      {0,4}x  {1}" -f $people[$p], $p)
        }
    }
    catch {
        Write-Host ("  {0}: ABSENT" -f $cand.name)
    }
}
Write-Host ""

# --- 4. Tabular section ------------------------------------------------------
#
# Column names must match what the ingest expects by position (Get(0..4), same
# shape as salesItemsSince). The per-line link candidates matter most: if the
# header has no link, a line-level one would still allow attribution.

Write-Host "=== 4. Tovary tabular section ==="

$NOMENKL = C 1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1072  # Nomenklatura
$KOLVO   = C 1050,1086,1083,1080,1095,1077,1089,1090,1074,1086            # Kolichestvo
$CENA    = C 1062,1077,1085,1072                                          # Cena
$SUMMA   = C 1057,1091,1084,1084,1072                                     # Summa
$SERIYA  = C 1057,1077,1088,1080,1103,1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1099  # SeriyaNomenklatury
$DOKPOST = C 1044,1086,1082,1091,1084,1077,1085,1090,1055,1086,1089,1090,1091,1087,1083,1077,1085,1080,1103  # DokumentPostupleniya

$itemFields = @(
    @{ name = "Nomenklatura";                 field = $NOMENKL },
    @{ name = "Kolichestvo";                  field = $KOLVO },
    @{ name = "Cena";                         field = $CENA },
    @{ name = "Summa";                        field = $SUMMA },
    @{ name = "SeriyaNomenklatury";           field = $SERIYA },
    @{ name = "DokumentPostupleniya [LINK?]"; field = $DOKPOST },
    @{ name = "DokumentRealizacii  [LINK?]";  field = $DOKREAL },
    @{ name = "Sdelka             [LINK?]";   field = $SDELKA }
)

foreach ($f in $itemFields) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 60 T.$REF, T.$($f.field) $FROM $DOC.$RET.$GOODS $AS T"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $rows = 0
        $filled = 0
        $sample = ""
        while ($r.Next()) {
            $rows++
            $v = $r.Get(1)
            $txt = AsText $v
            $id = RefId $v
            if ($id) {
                if ($id -notmatch '^\{?[0-9a-fA-F-]*0{8}-0{4}-0{4}-0{4}-0{12}') {
                    $filled++
                    if (-not $sample) { $sample = $id }
                }
            }
            elseif ($txt -ne "" -and $txt -ne "0") {
                $filled++
                if (-not $sample) { $sample = $txt }
            }
        }
        Write-Host ("OK      {0,-30} {1,3}/{2,-3} filled   sample: {3}" -f $f.name, $filled, $rows, $sample)
    }
    catch {
        Write-Host ("ABSENT  {0}" -f $f.name)
    }
}
Write-Host ""

# Sign check: 1C stores return quantities as POSITIVE numbers and lets the
# register movement carry the minus. If that assumption is wrong the ingest
# would double-negate. Cheap to verify, expensive to get wrong.
Write-Host "=== 4b. Quantity sign in the tabular section ==="
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 200 T.$KOLVO, T.$SUMMA $FROM $DOC.$RET.$GOODS $AS T"
    $rs = $q.Execute()
    $r = $rs.Choose()
    $neg = 0; $pos = 0; $zero = 0
    while ($r.Next()) {
        $qty = $r.Get(0)
        $v = if ($null -eq $qty) { 0 } else { [double]$qty }
        if ($v -lt 0) { $neg++ } elseif ($v -gt 0) { $pos++ } else { $zero++ }
    }
    Write-Host ("  positive: {0}   negative: {1}   zero: {2}" -f $pos, $neg, $zero)
    if ($neg -eq 0 -and $pos -gt 0) {
        Write-Host "  => 1C keeps returns positive; the site must apply the minus itself."
    } elseif ($neg -gt 0) {
        Write-Host "  => quantities are ALREADY negative in 1C; do NOT negate again on ingest."
    }
}
catch {
    Write-Host ("  FAILED: " + $_.Exception.Message)
}
Write-Host ""

# --- 5. Register movements ---------------------------------------------------
#
# Confirms 1C itself nets returns out of sales/debt. If it does, the debt figure
# the site already imports is correct and must NOT be adjusted again.

Write-Host "=== 5. Register movements produced by returns (best-effort) ==="

$PRODAZHI = C 1055,1088,1086,1076,1072,1078,1080                    # Prodazhi
$VZAIMO   = C 1042,1079,1072,1080,1084,1086,1088,1072,1089,1095,1077,1090,1099,1057,1050,1086,1085,1090,1088,1072,1075,1077,1085,1090,1072,1084,1080  # VzaimoraschetySKontragentami
$TOVSKLAD = C 1058,1086,1074,1072,1088,1099,1053,1072,1057,1082,1083,1072,1076,1072,1093  # TovaryNaSkladah

foreach ($reg in @(
    @{ name = "Prodazhi";                     field = $PRODAZHI },
    @{ name = "VzaimoraschetySKontragentami"; field = $VZAIMO },
    @{ name = "TovaryNaSkladah";              field = $TOVSKLAD }
)) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 5 R.$REGISTRAR, R.$PERIOD $FROM $REG.$($reg.field) $AS R" +
                  " $WHERE R.$REGISTRAR $REFOP $DOC.$RET"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $n = 0
        while ($r.Next()) { $n++ }
        if ($n -gt 0) {
            Write-Host ("OK      {0}: returns DO move this register ({1}+ rows sampled)" -f $reg.name, $n)
        } else {
            Write-Host ("EMPTY   {0}: no movements found" -f $reg.name)
        }
    }
    catch {
        Write-Host ("FAILED  {0}: {1}" -f $reg.name, $_.Exception.Message)
    }
}
Write-Host ""

Write-Host "=== What to do with these findings ==="
Write-Host "1. Section 1 totals = the baseline to check the import against."
Write-Host "2. Section 2/4 [LINK?] fields decide whether a return can name the"
Write-Host "   realization it reverses (header had no DokumentOsnovanie for"
Write-Host "   realizations -- do not assume the same here)."
Write-Host "3. Section 3 decides which column goes into returnsSince as the rep."
Write-Host "4. Section 4b decides the sign convention on ingest."
Write-Host "5. Section 5: if VzaimoraschetySKontragentami moves, the imported debt"
Write-Host "   already nets returns -- leave the debt pipeline alone."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
