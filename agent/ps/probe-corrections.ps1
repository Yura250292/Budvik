# Probe: how are already-posted documents corrected in practice?
#
# The reported workflow: the office posts an order, the warehouse rings back
# saying a line is not in stock, and someone edits the posted document. The site
# would survive that -- ingest replaces a document's lines wholesale -- but it
# never hears about it: documents are selected by DOCUMENT DATE within a
# 15-minute watermark window, so an edit to last week's invoice is invisible
# until the nightly full run, and an unposting is invisible forever because
# every query carries "GDE Proveden".
#
# 1C 8.2 has no usable change timestamp over COM (_Version needs direct SQL,
# the event log needs a slow full dump), so this probe measures the traces
# instead:
#   1. how much unposted/deleted-marked stock there is  -> is unposting a habit?
#   2. do correction documents exist at all?
#   3. an export of current realization lines, to diff against what the site
#      already stored -> direct evidence of silent edits, and how far back they
#      reach.
#
# Section 3 writes realization-lines-<date>.ndjson next to this script. Run it
# twice a working day apart: the delta between two exports is the daily
# correction rate, which is what sizes the rescan window.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-corrections.ps1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Months = 6,
    [int] $ExportDays = 30
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
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument

$REALIZ = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug
$ZAKAZ  = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # ZakazPokupatelya
$GOODS  = C 1058,1086,1074,1072,1088,1099                          # Tovary

$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$DELMARK= C 1055,1086,1084,1077,1090,1082,1072,1059,1076,1072,1083,1077,1085,1080,1103  # PometkaUdaleniya
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$NOMENKL= C 1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1072  # Nomenklatura
$KOLVO  = C 1050,1086,1083,1080,1095,1077,1089,1090,1074,1086      # Kolichestvo
$CENA   = C 1062,1077,1085,1072                                    # Cena
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS

function RefId($value) {
    if ($null -eq $value) { return $null }
    try { return [string]$ib.XMLString($value) } catch { return $null }
}

# --- 1. Unposted / deletion-marked share, by month ---------------------------
#
# A steady few percent of unposted documents means unposting is part of the
# workflow -- and every one of those is a document the site still shows as
# CONFIRMED, counted in someone's turnover.

Write-Host ("=== 1. Posted vs unposted, last {0} months ===" -f $Months)

$since = (Get-Date).AddMonths(-$Months)

foreach ($d in @(
    @{ name = "RealizaciyaTovarovUslug"; field = $REALIZ },
    @{ name = "ZakazPokupatelya";        field = $ZAKAZ }
)) {
    Write-Host ("  -- {0} --" -f $d.name)
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT D.$DATE, D.$POSTED, D.$DELMARK, D.$SUMDOC" +
                  " $FROM $DOC.$($d.field) $AS D $WHERE D.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()

        $byMonth = @{}
        while ($r.Next()) {
            $dt = $r.Get(0)
            if ($null -eq $dt) { continue }
            $key = ([datetime]$dt).ToString("yyyy-MM")
            if (-not $byMonth.ContainsKey($key)) {
                $byMonth[$key] = @{ total = 0; posted = 0; unposted = 0; deleted = 0; unpostedAmount = 0.0 }
            }
            $byMonth[$key].total++
            if ([bool]$r.Get(1)) {
                $byMonth[$key].posted++
            } else {
                $byMonth[$key].unposted++
                $amt = $r.Get(3)
                if ($null -ne $amt) { $byMonth[$key].unpostedAmount += [double]$amt }
            }
            if ([bool]$r.Get(2)) { $byMonth[$key].deleted++ }
        }

        foreach ($m in ($byMonth.Keys | Sort-Object)) {
            $b = $byMonth[$m]
            $pct = if ($b.total -gt 0) { 100.0 * $b.unposted / $b.total } else { 0 }
            Write-Host ("     {0}  {1,5} docs  unposted {2,4} ({3,5:N1}%)  deleted {4,3}  unposted sum {5,12:N2}" -f `
                $m, $b.total, $b.unposted, $pct, $b.deleted, $b.unpostedAmount)
        }
        if ($byMonth.Count -eq 0) { Write-Host "     (no documents in window)" }
    }
    catch {
        Write-Host ("     FAILED: " + $_.Exception.Message)
    }
}
Write-Host ""
Write-Host "  A non-trivial unposted share = the site is showing cancelled documents"
Write-Host "  as confirmed revenue right now."
Write-Host ""

# --- 2. Correction documents -------------------------------------------------
#
# If UT 2.3 has none of these, "minusing" can only be a direct edit of the
# posted document -- which settles the design: rescan, no correction-document
# stream to read.

Write-Host "=== 2. Correction document candidates ==="

$candidates = @(
    @{ name = "KorrektirovkaRealizacii";     field = (C 1050,1086,1088,1088,1077,1082,1090,1080,1088,1086,1074,1082,1072,1056,1077,1072,1083,1080,1079,1072,1094,1080,1080) },
    @{ name = "KorrektirovkaDolga";          field = (C 1050,1086,1088,1088,1077,1082,1090,1080,1088,1086,1074,1082,1072,1044,1086,1083,1075,1072) },
    @{ name = "KorrektirovkaZapisejRegistrov"; field = (C 1050,1086,1088,1088,1077,1082,1090,1080,1088,1086,1074,1082,1072,1047,1072,1087,1080,1089,1077,1081,1056,1077,1075,1080,1089,1090,1088,1086,1074) },
    @{ name = "KorrektirovkaKachestvaTovarov"; field = (C 1050,1086,1088,1088,1077,1082,1090,1080,1088,1086,1074,1082,1072,1050,1072,1095,1077,1089,1090,1074,1072,1058,1086,1074,1072,1088,1086,1074) }
)

foreach ($c in $candidates) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT D.$REF, D.$DATE $FROM $DOC.$($c.field) $AS D $WHERE D.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $n = 0
        while ($r.Next()) { $n++ }
        Write-Host ("OK      {0,-32} {1} docs in last {2} months" -f $c.name, $n, $Months)
    }
    catch {
        Write-Host ("ABSENT  {0}" -f $c.name)
    }
}
Write-Host ""

# --- 3. Export current realization lines for diffing against the site --------
#
# The decisive evidence. Whatever 1C says today is the truth; whatever the site
# stored is what the last successful sync delivered. Every mismatch is a silent
# edit that never reached us, and the document's date tells us how far back the
# rescan window has to reach.

Write-Host ("=== 3. Exporting realization lines, last {0} days ===" -f $ExportDays)

$expFrom = (Get-Date).AddDays(-$ExportDays)
$stamp = (Get-Date).ToString("yyyyMMdd-HHmm")
$outPath = Join-Path $scriptDir ("realization-lines-{0}.ndjson" -f $stamp)

try {
    # Header pass first: totals and posted flag per document, so the diff can
    # also catch header-only changes (an unposting leaves the lines intact).
    $headers = @{}
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT D.$REF, D.$NUM, D.$DATE, D.$SUMDOC, D.$POSTED, D.$DELMARK" +
              " $FROM $DOC.$REALIZ $AS D $WHERE D.$DATE >= &$PARAM"
    $q.SetParameter($PARAM, $expFrom)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null on header pass" }
    $r = $rs.Choose()
    while ($r.Next()) {
        $id = RefId $r.Get(0)
        if (-not $id) { continue }
        $dt = $r.Get(2)
        $headers[$id] = [ordered]@{
            externalId  = $id
            number      = if ($null -eq $r.Get(1)) { "" } else { ([string]$r.Get(1)).Trim() }
            date        = if ($null -eq $dt) { $null } else { ([datetime]$dt).ToString("yyyy-MM-ddTHH:mm:ss") }
            totalAmount = if ($null -eq $r.Get(3)) { 0 } else { [double]$r.Get(3) }
            posted      = [bool]$r.Get(4)
            deleted     = [bool]$r.Get(5)
            items       = New-Object Collections.Generic.List[object]
        }
    }
    Write-Host ("  headers: {0} documents" -f $headers.Count)

    # Lines pass. No "GDE Proveden" here on purpose -- an unposted document is
    # exactly the case we are hunting for.
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT T.$REF, T.$NOMENKL, T.$KOLVO, T.$CENA" +
              " $FROM $DOC.$REALIZ.$GOODS $AS T $WHERE T.$REF.$DATE >= &$PARAM"
    $q.SetParameter($PARAM, $expFrom)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null on lines pass" }
    $r = $rs.Choose()
    $lineRows = 0
    while ($r.Next()) {
        $docId = RefId $r.Get(0)
        $prodId = RefId $r.Get(1)
        if (-not $docId -or -not $prodId) { continue }
        if (-not $headers.ContainsKey($docId)) { continue }
        [void]$headers[$docId].items.Add([ordered]@{
            productExternalId = $prodId
            quantity          = if ($null -eq $r.Get(2)) { 0 } else { [double]$r.Get(2) }
            price             = if ($null -eq $r.Get(3)) { 0 } else { [double]$r.Get(3) }
        })
        $lineRows++
    }
    Write-Host ("  lines:   {0} rows" -f $lineRows)

    $sw = New-Object IO.StreamWriter($outPath, $false, (New-Object Text.UTF8Encoding($false)))
    foreach ($id in $headers.Keys) {
        $h = $headers[$id]
        $h.items = $h.items.ToArray()
        $sw.WriteLine(($h | ConvertTo-Json -Compress -Depth 5))
    }
    $sw.Close()
    Write-Host ("  wrote {0}" -f $outPath)
    Write-Host "  Copy this file to the Mac (\\tsclient\Downloads) for the diff."
}
catch {
    Write-Host ("  EXPORT FAILED: " + $_.Exception.Message)
}
Write-Host ""

Write-Host "=== What happens with these findings ==="
Write-Host "1. Unposted share (section 1) sizes the CANCELLED backlog the site"
Write-Host "   currently counts as revenue."
Write-Host "2. Absent correction documents (section 2) means direct editing is the"
Write-Host "   only mechanism -- so a rescan window is the only possible fix."
Write-Host "3. The export (section 3) is diffed against SalesDocumentItem: the age"
Write-Host "   of the oldest mismatching document sets documents.rescanDays."
Write-Host "   Run this probe again after a working day; the delta between the two"
Write-Host "   exports is the daily correction rate."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
