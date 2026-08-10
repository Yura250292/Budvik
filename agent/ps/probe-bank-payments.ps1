# Probe: do customers pay by bank transfer, and which document books it?
#
# Today only cash is read (PrihodnyiKassovyiOrder). PlatezhnoePoruchenieVhodyashchee
# was checked earlier and is empty in this base -- but "empty" may only mean this
# configuration books incoming bank money under a different document name. If any
# customer pays to the account, that money is invisible: the rep collected it and
# the motivation shows nothing.
#
# Two independent angles, because a document-name guess alone proves nothing:
#   1. candidate documents, each tried separately;
#   2. the cash-flow register (DenezhnyeSredstva), which shows the truth
#      regardless of what the documents are called -- if bank movements exist
#      there, some document creates them and it is worth finding.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-bank-payments.ps1

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

# Cyrillic must not live in this file (PS5 reads .ps1 with the OEM codepage),
# so every name is assembled from char codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$AND    = C 1048                                                   # I
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REG    = C 1056,1077,1075,1080,1089,1090,1088,1053,1072,1082,1086,1087,1083,1077,1085,1080,1103  # RegistrNakopleniya
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$DATE   = C 1044,1072,1090,1072                                    # Data
$REFF   = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$KONTR  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$PARAM  = C 1044,1072,1090,1072,1057                               # DataS

$since = (Get-Date).AddMonths(-$Months)

# --- 1. Candidate documents for incoming bank money -------------------------
#
# Names differ between UT builds and between "payment order" and "receipt to
# account" styles of booking. Each is tried on its own: a missing document
# fails the whole query with a bare error that names nothing.

Write-Host ("=== Candidate documents, last {0} months ===" -f $Months)

$PP_VHOD = C 1055,1083,1072,1090,1077,1078,1085,1086,1077,1055,1086,1088,1091,1095,1077,1085,1080,1077,1042,1093,1086,1076,1103,1097,1077,1077  # PlatezhnoePoruchenieVhodyashchee
$POST_RS = C 1055,1086,1089,1090,1091,1087,1083,1077,1085,1080,1077,1053,1072,1056,1072,1089,1095,1077,1090,1085,1099,1081,1057,1095,1077,1090   # PostuplenieNaRaschetnyiSchet
$PLAT_ORD = C 1055,1083,1072,1090,1077,1078,1085,1099,1081,1054,1088,1076,1077,1088                                                              # PlatezhnyiOrder
$BANK_VYP = C 1041,1072,1085,1082,1086,1074,1089,1082,1072,1103,1042,1099,1087,1080,1089,1082,1072                                               # BankovskayaVypiska

$docCandidates = @(
    @{ name = "PlatezhnoePoruchenieVhodyashchee"; doc = $PP_VHOD },
    @{ name = "PostuplenieNaRaschetnyiSchet";     doc = $POST_RS },
    @{ name = "PlatezhnyiOrder";                  doc = $PLAT_ORD },
    @{ name = "BankovskayaVypiska";               doc = $BANK_VYP }
)

$found = @()
foreach ($c in $docCandidates) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT D.$REFF, D.$DATE, D.$KONTR, D.$SUMDOC $FROM $DOC.$($c.doc) $AS D" +
                  " $WHERE D.$POSTED $AND D.$DATE >= &$PARAM"
        $q.SetParameter($PARAM, $since)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $n = 0
        $sum = 0.0
        $withCp = 0
        while ($r.Next()) {
            $n++
            $amt = $r.Get(3)
            if ($null -ne $amt) { $sum += [double]$amt }
            if ($null -ne $r.Get(2)) { $withCp++ }
        }
        Write-Host ("EXISTS  {0}" -f $c.name)
        Write-Host ("          {0} posted docs, {1} with Kontragent, {2:N2} UAH" -f $n, $withCp, $sum)
        if ($n -gt 0) { $found += $c.name }
    }
    catch {
        Write-Host ("ABSENT  " + $c.name)
    }
}
Write-Host ""

# --- 2. The cash-flow register: the truth regardless of document names ------
#
# If bank money moves at all, it moves here. Reading the register tells us
# whether the search above missed something -- and the recorder of each row
# names the document that booked it.

Write-Host "=== Cash-flow register (which documents actually book money) ==="

$DEN_SR  = C 1044,1077,1085,1077,1078,1085,1099,1077,1057,1088,1077,1076,1089,1090,1074,1072   # DenezhnyeSredstva
$OBOROTY = C 1054,1073,1086,1088,1086,1090,1099                                                # Oboroty
$RECORDER = C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088                           # Registrator
$PRIHOD  = C 1055,1088,1080,1093,1086,1076                                                     # Prihod
$SUMMA   = C 1057,1091,1084,1084,1072                                                          # Summa

# The virtual table takes its period as parameters, not a WHERE clause.
# NOTE: the debt register on this build rejects aliases; if this query fails
# the same way, that is the reason -- see queries.json _debtFormComment.
$regVariants = @(
    @{ name = "DenezhnyeSredstva.Oboroty (Registrator, SummaPrihod)";
       text  = "$SELECT $RECORDER, $SUMMA$PRIHOD $FROM $REG.$DEN_SR.$OBOROTY(&$PARAM, , , )" },
    @{ name = "DenezhnyeSredstva.Oboroty (no params)";
       text  = "$SELECT $RECORDER, $SUMMA$PRIHOD $FROM $REG.$DEN_SR.$OBOROTY" }
)

foreach ($v in $regVariants) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = $v.text
        if ($v.text -match [regex]::Escape("&$PARAM")) { $q.SetParameter($PARAM, $since) }
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()

        # Group by the document TYPE, not by each document: we want to learn
        # which kinds of documents bring money in, not to list them all.
        $byType = @{}
        $rows = 0
        while ($r.Next()) {
            $rows++
            $rec = $r.Get(0)
            $type = "<null>"
            if ($null -ne $rec) {
                try {
                    $meta = $rec.Metadata()
                    $type = [string]$meta.Name
                } catch { $type = "<unreadable>" }
            }
            $amt = $r.Get(1)
            if (-not $byType.ContainsKey($type)) { $byType[$type] = @{ n = 0; sum = 0.0 } }
            $byType[$type].n++
            if ($null -ne $amt) { $byType[$type].sum += [double]$amt }
        }

        Write-Host ("OK  " + $v.name + ("  ({0} rows)" -f $rows))
        foreach ($k in ($byType.Keys | Sort-Object { -$byType[$_].sum })) {
            Write-Host ("      {0,8} rows  {1,16:N2} UAH   {2}" -f $byType[$k].n, $byType[$k].sum, $k)
        }
        break
    }
    catch {
        Write-Host ("FAILED  " + $v.name + " -- " + $_.Exception.Message)
    }
}

Write-Host ""
Write-Host "Read this way:"
Write-Host "  * a document listed as EXISTS with a nonzero count and Kontragent filled"
Write-Host "    is a real channel of customer money that we are NOT reading today;"
Write-Host "  * in the register, any document type other than PrihodnyiKassovyiOrder"
Write-Host "    that brings money in is worth adding to the exchange."
Write-Host "If everything except the cash order is empty, cash really is the only"
Write-Host "channel and nothing needs to change."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
