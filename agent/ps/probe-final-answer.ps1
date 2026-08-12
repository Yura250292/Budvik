# The last question: can a realization be tied to a route sheet at all?
#
# Everything else is settled:
#   - Dokument.MarshrutnyjLyst = header only (number, date, Voditel). No tabular
#     section under any of 31 names, checked on fresh connections.
#   - Realizations carry no MarshrutnyjLyst attribute (the earlier "40/40" was a
#     poisoned-session artefact).
#   - queries.json records that on this base a realization's rep is Menedzher --
#     the TORGOVYI, not a driver. Otvetstvennyi is the storekeeper who posts the
#     shipment. Neither is the person who drives.
#
# So a realization may simply not know its driver, and the printed sheet is
# assembled from something we have not seen. Two things decide the way forward,
# and this probe settles both -- each on its own connection, so no failure can
# contaminate the next answer:
#
#   1. Does filtering by a REFERENCE parameter work here at all? Every working
#      query in queries.json filters only by date. If reference filters throw,
#      that alone explains the last probe's three identical failures, and says
#      nothing about the fields themselves.
#
#   2. What does a realization actually carry? Section 2 lists the values of
#      Menedzher and Otvetstvennyi for the day of sheet 1817, so we can see with
#      our own eyes whether any of them is the driver Picyshyn Yurii.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-final-answer.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-final-answer.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir "config.json" }

$config = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$connString = 'Srvr="' + $config.oneC.server + '";Ref="' + $config.oneC.base +
              '";Usr="' + $config.oneC.user + '";Pwd="' + $config.oneC.password + '";'

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
$OTVETST= C 1054,1090,1074,1077,1090,1089,1090,1074,1077,1085,1085,1099,1081  # Otvetstvennyi
$MENEDZH= C 1052,1077,1085,1077,1076,1078,1077,1088                # Menedzher
$ADRDOST= C 1040,1076,1088,1077,1089,1044,1086,1089,1090,1072,1074,1082,1080  # AdresDostavki

$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$REALIZ = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug

function NewConn() {
    $c = New-Object -ComObject V82.COMConnector
    return @{ conn = $c; ib = $c.Connect($connString) }
}
function CloseConn($h) {
    if ($h.ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($h.ib) }
    if ($h.conn) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($h.conn) }
    [GC]::Collect()
}

# --- 1. Does a reference parameter work as a filter? ------------------------
#
# Control test on a field we KNOW exists and is filled: the sheet's own Voditel.
# If this throws, reference filtering is the problem, not the field.

Write-Host "=== 1. Control: filter route sheets by a driver reference ==="

$driverRef = $null
$driverName = ""

$h = NewConn
try {
    $q = $h.ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 1 R.$VODITEL, R.$VODITEL.$NAME $FROM $DOC.$RS $AS R"
    $rs = $q.Execute()
    $r = $rs.Choose()
    if ($r.Next()) {
        $driverRef = $r.Get(0)
        $driverName = ([string]$r.Get(1)).Trim()
        Write-Host ("  got a driver reference: {0}" -f $driverName)
    }
}
catch { Write-Host ("  could not read a driver: " + $_.Exception.Message.Split("`n")[0]) }
CloseConn $h

if ($driverRef) {
    $h = NewConn
    try {
        $q = $h.ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 5 R.$NUM, R.$DATE $FROM $DOC.$RS $AS R $WHERE R.$VODITEL = &Drv"
        $q.SetParameter("Drv", $driverRef)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $n = 0
        while ($r.Next()) { $n++ }
        Write-Host ("  OK: reference filtering WORKS ({0} sheets for {1})" -f $n, $driverName)
        Write-Host "  => the previous probe's failures were about the FIELDS, not the method"
    }
    catch {
        Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
        Write-Host "  => reference filtering does not work on this build; that alone"
        Write-Host "     explains why all three driver fields 'failed' last time"
    }
    CloseConn $h
}
Write-Host ""

# --- 2. What people does a realization name? --------------------------------
#
# No filtering, no parameters -- just read and look. queries.json says Menedzher
# is the sales rep; if none of these is a driver, realizations cannot be tied to
# a sheet by person at all.

Write-Host "=== 2. Who is named on realizations of 10-11.08.2026? ==="

$h = NewConn
try {
    $q = $h.ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 60 R.$NUM, R.$DATE, R.$KONTR.$NAME, R.$SUMDOC," +
              " R.$MENEDZH.$NAME, R.$OTVETST.$NAME, R.$ADRDOST" +
              " $FROM $DOC.$REALIZ $AS R $WHERE R.$POSTED $AND R.$DATE >= &D1 $AND R.$DATE < &D2"
    $q.SetParameter("D1", [datetime]"2026-08-10")
    $q.SetParameter("D2", [datetime]"2026-08-12")
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "Execute returned null" }
    $r = $rs.Choose()

    $rows = 0
    $total = 0.0
    $managers = @{}
    while ($r.Next()) {
        $rows++
        $raw = ([string]$r.Get(3)).Trim()
        $val = 0.0
        $clean = $raw -replace '\s', '' -replace ',', '.'
        [void][double]::TryParse($clean, [Globalization.NumberStyles]::Any,
            [Globalization.CultureInfo]::InvariantCulture, [ref] $val)
        $total += $val

        $m = ([string]$r.Get(4)).Trim()
        if (-not $m) { $m = "(empty)" }
        if (-not $managers.ContainsKey($m)) { $managers[$m] = @{ n = 0; sum = 0.0 } }
        $managers[$m].n++
        $managers[$m].sum += $val

        if ($rows -le 20) {
            Write-Host ("  {0,2}. {1,-32} {2,11}  mgr: {3,-22} resp: {4}" -f `
                $rows, ([string]$r.Get(2)).Trim(), $raw, $m, ([string]$r.Get(5)).Trim())
        }
    }
    Write-Host ("  ... {0} realizations in total, {1:N2} UAH" -f $rows, $total)
    Write-Host ""
    Write-Host "  By Menedzher:"
    foreach ($k in ($managers.Keys | Sort-Object { -$managers[$_].sum })) {
        Write-Host ("      {0,-26} {1,3} docs  {2,12:N2} UAH" -f $k, $managers[$k].n, $managers[$k].sum)
    }
    Write-Host ""
    Write-Host "  Sheet 1817 (driver Picyshyn Yurii) should account for 66 078,52 of this."
    Write-Host "  If no single person's total is near that, realizations do not know"
    Write-Host "  their driver and the sheet cannot be rebuilt from them."
}
catch {
    Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
}
CloseConn $h
Write-Host ""

Write-Host "=== Bottom line ==="
Write-Host "If section 2 shows no person matching 66 078,52, then 1C simply does not"
Write-Host "record which realizations a driver carried -- the link exists only on"
Write-Host "paper, in the printed sheet. In that case mirroring 1C is a dead end and"
Write-Host "the route should be owned by the site: the logistician builds it in the"
Write-Host "admin planner, the driver executes it in his cabinet, and payroll follows"
Write-Host "from what the driver actually did."
