# Probe: which operation kinds does PrihodnyiKassovyiOrder carry, and which of
# them is really a CUSTOMER payment.
#
# Today paymentsSince takes every posted PKO with a filled Kontragent. In UT
# 2.3 that document also books supplier refunds (VozvratOtPostavshchika --
# where Kontragent is a SUPPLIER), retail takings and miscellaneous cash in.
# Counting those as customer money inflates "collected" and, through
# PaymentAllocation, the reps' motivation.
#
# The fix is a VidOperacii filter in the WHERE clause -- but the enum path must
# be CONFIRMED here, never guessed: a wrong name fails Execute() with a bare
# NullReferenceException that says nothing about which name was wrong. Hence
# every candidate is tried as its own query.
#
# Also probes the RaschifrovkaPlatezha tabular section: if a PKO line links
# back to the settlement document, we could later emit salesDocExternalId and
# allocate the money to the exact realization. FINDINGS ONLY -- not wired here.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-pko-kinds.ps1
#
# Output: console report, plus pko-customer-ids.txt (Ref_Keys of the PKO the
# confirmed filter accepts) next to this script -- input for the cleanup of
# payments already ingested under the old, unfiltered query.

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Months = 12
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

# Cyrillic query text must not live in this file (PS5 reads .ps1 with the OEM
# codepage and mangles it), so it is assembled from char codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$AND    = C 1048                                                   # I
$VALUE  = C 1047,1053,1040,1063,1045,1053,1048,1045                # ZNACHENIE
$ENUM   = C 1055,1077,1088,1077,1095,1080,1089,1083,1077,1085,1080,1077   # Perechislenie
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$PKO    = C 1055,1088,1080,1093,1086,1076,1085,1099,1081,1050,1072,1089,1089,1086,1074,1099,1081,1054,1088,1076,1077,1088  # PrihodnyiKassovyiOrder
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$DATE   = C 1044,1072,1090,1072                                    # Data
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$KONTR  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$VIDOP  = C 1042,1080,1076,1054,1087,1077,1088,1072,1094,1080,1080  # VidOperacii
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS

$since = (Get-Date).AddMonths(-$Months)

# The aliased "KAK P" form is proven on this build for Dokument.* tables --
# only the debt register's virtual table rejects aliases. Keep it: the goal is
# to validate the exact text that will go into queries.json, not a variant.
$tail = " $FROM $DOC.$PKO $AS P $WHERE P.$POSTED $AND P.$DATE >= &$PARAM"

function RefId($value) {
    if ($null -eq $value) { return $null }
    try { return [string]$ib.XMLString($value) } catch { return $null }
}

# --- 1. Distribution of operation kinds -------------------------------------
#
# A tally, not a sample: a kind that is 2% of documents but 40% of the money is
# only visible once both are counted.

Write-Host ("=== VidOperacii distribution, last {0} months ===" -f $Months)
$kinds = @{}
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT P.$VIDOP, P.$KONTR, P.$SUMDOC, P.$REF$tail"
    $q.SetParameter($PARAM, $since)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()

    while ($r.Next()) {
        $kindRaw = $r.Get(0)
        $kind = if ($null -eq $kindRaw) { "<null>" } else { ([string]$kindRaw).Trim() }
        if ($kind -eq "") { $kind = "<empty>" }

        if (-not $kinds.ContainsKey($kind)) {
            $kinds[$kind] = @{ docs = 0; withCp = 0; amount = 0.0 }
        }
        $kinds[$kind].docs++
        if (RefId $r.Get(1)) { $kinds[$kind].withCp++ }
        $amt = $r.Get(2)
        if ($null -ne $amt) { $kinds[$kind].amount += [double]$amt }
    }

    foreach ($k in ($kinds.Keys | Sort-Object { -$kinds[$_].docs })) {
        Write-Host ("  {0,6} docs  {1,6} with Kontragent  {2,14:N2} UAH   {3}" -f `
            $kinds[$k].docs, $kinds[$k].withCp, $kinds[$k].amount, $k)
    }
    if ($kinds.Count -eq 0) { Write-Host "  (no posted PKO in this window)" }
}
catch {
    Write-Host ("FAILED to read VidOperacii: " + $_.Exception.Message)
    Write-Host "Without this the filter cannot be chosen -- stop here and investigate."
}
Write-Host ""

# --- 2. Which enum path actually executes -----------------------------------
#
# The naming of this enum differs between UT builds. Each candidate is a full
# filtered query: the one that executes AND returns a count matching the
# dominant customer-payment kind tallied above is the one for queries.json.

Write-Host "=== Enum path candidates for the WHERE filter ==="

$VIDY_OP_PKO  = C 1042,1080,1076,1099,1054,1087,1077,1088,1072,1094,1080,1081,1055,1050,1054           # VidyOperaciiPKO
$VID_OP_PKO   = C 1042,1080,1076,1054,1087,1077,1088,1072,1094,1080,1080,1055,1050,1054                # VidOperaciiPKO
$OPLATA_POK   = C 1054,1087,1083,1072,1090,1072,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103      # OplataPokupatelya
$OPLATA_OT    = C 1054,1087,1083,1072,1090,1072,1054,1090,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # OplataOtPokupatelya

$candidates = @(
    @{ name = "VidyOperaciiPKO.OplataPokupatelya";   path = "$VIDY_OP_PKO.$OPLATA_POK" },
    @{ name = "VidyOperaciiPKO.OplataOtPokupatelya"; path = "$VIDY_OP_PKO.$OPLATA_OT" },
    @{ name = "VidOperaciiPKO.OplataPokupatelya";    path = "$VID_OP_PKO.$OPLATA_POK" },
    @{ name = "VidOperaciiPKO.OplataOtPokupatelya";  path = "$VID_OP_PKO.$OPLATA_OT" }
)

$confirmed = $null
foreach ($c in $candidates) {
    $filter = " $AND P.$VIDOP = $VALUE($ENUM.$($c.path))"
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT P.$REF, P.$NUM, P.$DATE, P.$KONTR, P.$SUMDOC$tail$filter"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $n = 0
        $sum = 0.0
        while ($r.Next()) {
            $n++
            $amt = $r.Get(4)
            if ($null -ne $amt) { $sum += [double]$amt }
        }
        Write-Host ("OK      {0}  -> {1} docs, {2:N2} UAH" -f $c.name, $n, $sum)
        if ($n -gt 0 -and -not $confirmed) { $confirmed = $c }
    }
    catch {
        Write-Host ("ABSENT  " + $c.name)
    }
}
Write-Host ""

# --- 3. RaschifrovkaPlatezha: is there a link to the settlement document? ----
#
# Findings only. A link here would let a payment be allocated to the exact
# realization instead of falling back to "whatever rep owns the client".

Write-Host "=== RaschifrovkaPlatezha (findings only, not wired) ==="

$RASCH  = C 1056,1072,1089,1096,1080,1092,1088,1086,1074,1082,1072,1055,1083,1072,1090,1077,1078,1072  # RaschifrovkaPlatezha
$SDELKA = C 1057,1076,1077,1083,1082,1072                                                              # Sdelka
$DOKRAS = C 1044,1086,1082,1091,1084,1077,1085,1090,1056,1072,1089,1095,1077,1090,1086,1074            # DokumentRaschetov
$ZAKAZ  = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103                 # ZakazPokupatelya
$SUMPL  = C 1057,1091,1084,1084,1072,1055,1083,1072,1090,1077,1078,1072                                # SummaPlatezha

$tcFields = @(
    @{ name = "Sdelka";            field = $SDELKA },
    @{ name = "DokumentRaschetov"; field = $DOKRAS },
    @{ name = "ZakazPokupatelya";  field = $ZAKAZ },
    @{ name = "SummaPlatezha";     field = $SUMPL }
)

foreach ($f in $tcFields) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 20 T.$($f.field) $FROM $DOC.$PKO.$RASCH $AS T"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $filled = 0
        $rows = 0
        $sample = ""
        while ($r.Next()) {
            $rows++
            $v = $r.Get(0)
            if ($null -ne $v -and ([string]$v).Trim() -ne "") {
                $filled++
                if (-not $sample) { $sample = ([string]$v).Trim() }
            }
        }
        Write-Host ("OK      {0}  ({1}/{2} filled)  sample: {3}" -f $f.name, $filled, $rows, $sample)
    }
    catch {
        Write-Host ("ABSENT  " + $f.name)
    }
}
Write-Host ""

# --- 4. Export the accepted Ref_Keys for the cleanup script -----------------
#
# Payments are ingested with upsert-by-externalId and there is no deletion
# detection for them, so narrowing the query does NOT remove the non-customer
# PKO already in the database. This file tells the cleanup script which rows
# are legitimate; everything else with source "1C" is a leftover.

if ($confirmed) {
    $outPath = Join-Path $scriptDir "pko-customer-ids.txt"
    Write-Host ("=== Exporting accepted PKO ids using {0} ===" -f $confirmed.name)
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT P.$REF$tail $AND P.$VIDOP = $VALUE($ENUM.$($confirmed.path))"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        $r = $rs.Choose()
        $sw = New-Object IO.StreamWriter($outPath, $false, (New-Object Text.UTF8Encoding($false)))
        $n = 0
        while ($r.Next()) {
            $id = RefId $r.Get(0)
            if ($id) { $sw.WriteLine($id); $n++ }
        }
        $sw.Close()
        Write-Host ("  wrote {0} ids to {1}" -f $n, $outPath)
        Write-Host "  NOTE: covers only the probed window -- run with a wider -Months"
        Write-Host "  than the payments history before using it for cleanup."
    }
    catch {
        Write-Host ("  export FAILED: " + $_.Exception.Message)
    }
}
else {
    Write-Host "=== No enum candidate confirmed -- nothing exported ==="
    Write-Host "Read the distribution above: the kind names printed there are the"
    Write-Host "truth. Add the matching candidate to this script and re-run."
}

Write-Host ""
Write-Host "Next: put the confirmed path into queries.json paymentsSince as"
Write-Host "  ... I P.VidOperacii = ZNACHENIE(Perechislenie.<confirmed>)"
Write-Host "and decide with the business whether retail takings count as"
Write-Host "collected money (default: no, customer payments only)."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
