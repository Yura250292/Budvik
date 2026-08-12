# How does the print form find the rows? Test the driver+date hypothesis.
#
# Settled, and not worth reprobing:
#   - Dokument.MarshrutnyjLyst holds ONLY a header: number, date, Voditel.
#     Thirty-one tabular-section names were tried on fresh connections -- none
#     exists. (Fresh connection per probe matters: on this build one failed
#     Execute() poisons the session and every later query returns the same
#     error, which is how an earlier probe produced a phantom "40/40".)
#   - RealizaciyaTovarovUslug has no MarshrutnyjLyst attribute either.
#
# So nothing stored ties a realization to a sheet. The print form must find its
# rows by querying -- and the only fields both sides share are the driver and
# the date. This probe tests exactly that against the photographed sheet 1817:
#
#     driver Picyshyn Yurii, date 11.08.2026, form total 71 966.52,
#     of which 5 888.00 is a debt payment -> payroll base 66 078.52
#
# If realizations of that driver on that date sum to 66 078.52, the rule is
# confirmed and the whole payroll can be computed from data we ALREADY sync.
#
# Section 2 tries several date windows, because the form shows realizations
# dated 10.08 on a sheet dated 11.08 -- so the window is not a single day.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-by-driver-date.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-driver-date.txt 2>&1

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

# --- 1. The sheet: driver reference and date --------------------------------

Write-Host ("=== 1. Sheet {0} ===" -f $SheetNumber)

$driverRef = $null
$driverName = ""
$sheetDate = $null

$h = NewConn
try {
    $q = $h.ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 5 R.$REF, R.$NUM, R.$DATE, R.$VODITEL, R.$VODITEL.$NAME" +
              " $FROM $DOC.$RS $AS R $WHERE R.$NUM = &SheetNum"
    $q.SetParameter("SheetNum", $SheetNumber)
    $rs = $q.Execute()
    $r = $rs.Choose()
    if ($r.Next()) {
        $sheetDate = $r.Get(2)
        $driverRef = $r.Get(3)
        $driverName = ([string]$r.Get(4)).Trim()
        Write-Host ("  No {0} of {1}, driver: {2}" -f `
            ([string]$r.Get(1)).Trim(), ([string]$sheetDate), $driverName)
    } else {
        Write-Host "  not found"
    }
}
catch { Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0]) }
CloseConn $h
Write-Host ""

if (-not $driverRef) {
    Write-Host "No driver reference -- cannot test the hypothesis."
    exit 0
}

# --- 2. Realizations of that driver, over several date windows --------------
#
# The photographed sheet is dated 11.08 but lists realizations from 10.08, so
# the form clearly looks back. Each window is a separate connection so one
# failure cannot make the others look empty.

Write-Host "=== 2. Realizations by driver, per date window ==="
Write-Host ("  target: 66 078,52 UAH (form total 71 966,52 minus debt 5 888,00)")
Write-Host ""

$baseDate = [datetime]$sheetDate

$windows = @(
    @{ l = "same day only";        from = $baseDate.Date;             to = $baseDate.Date.AddDays(1) },
    @{ l = "day before + day";     from = $baseDate.Date.AddDays(-1); to = $baseDate.Date.AddDays(1) },
    @{ l = "two days before";      from = $baseDate.Date.AddDays(-2); to = $baseDate.Date.AddDays(1) },
    @{ l = "three days before";    from = $baseDate.Date.AddDays(-3); to = $baseDate.Date.AddDays(1) },
    @{ l = "week before";          from = $baseDate.Date.AddDays(-7); to = $baseDate.Date.AddDays(1) }
)

# Which attribute on the realization names the driver? Voditel is the obvious
# guess, but realizations are known to carry Otvetstvennyi and Menedzher too --
# and on this base the rep comes from Menedzher, not Otvetstvennyi.
$driverFields = @(
    @{ l = "Voditel";       n = $VODITEL },
    @{ l = "Otvetstvennyi"; n = $OTVETST },
    @{ l = "Menedzher";     n = $MENEDZH }
)

foreach ($df in $driverFields) {
    Write-Host ("  --- realization field: {0}" -f $df.l)
    $fieldWorks = $true

    foreach ($w in $windows) {
        if (-not $fieldWorks) { break }

        $h = NewConn
        try {
            $q = $h.ib.NewObject("Query")
            $q.Text = "$SELECT $FIRST 100 R.$NUM, R.$DATE, R.$KONTR.$NAME, R.$SUMDOC, R.$ADRDOST" +
                      " $FROM $DOC.$REALIZ $AS R $WHERE R.$POSTED" +
                      " $AND R.$($df.n) = &Drv $AND R.$DATE >= &D1 $AND R.$DATE < &D2"
            $q.SetParameter("Drv", $driverRef)
            $q.SetParameter("D1", $w.from)
            $q.SetParameter("D2", $w.to)
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "Execute returned null" }
            $r = $rs.Choose()

            $rows = 0
            $total = 0.0
            $addrs = @{}
            while ($r.Next()) {
                $rows++
                $raw = ([string]$r.Get(3)).Trim()
                $val = 0.0
                $clean = $raw -replace '\s', '' -replace ',', '.'
                [void][double]::TryParse($clean, [Globalization.NumberStyles]::Any,
                    [Globalization.CultureInfo]::InvariantCulture, [ref] $val)
                $total += $val
                $a = ([string]$r.Get(4)).Trim()
                $key = if ($a) { $a.ToLower() } else { "(none) " + ([string]$r.Get(2)).Trim() }
                $addrs[$key] = 1
            }

            $diff = 66078.52 - $total
            $mark = if ([Math]::Abs($diff) -lt 1.0) { "  <<< MATCHES THE FORM" } else { "" }
            Write-Host ("      {0,-20} {1,3} docs  {2,14:N2} UAH  {3,2} addresses{4}" -f `
                $w.l, $rows, $total, $addrs.Count, $mark)
        }
        catch {
            Write-Host ("      {0,-20} field not usable: {1}" -f `
                $w.l, $_.Exception.Message.Split("`n")[0])
            $fieldWorks = $false
        }
        CloseConn $h
    }
    Write-Host ""
}

Write-Host "=== What this settles ==="
Write-Host "A window whose total equals 66 078,52 tells us exactly how the print"
Write-Host "form builds its list -- and that rule can be reproduced from the data"
Write-Host "already on the site, with no new 1C fields needed."
Write-Host ""
Write-Host "If no window matches, the form filters on something else entirely"
Write-Host "(a register, a status, a manual selection), and the realistic path is"
Write-Host "to let the driver's cabinet own the route instead of mirroring 1C."
