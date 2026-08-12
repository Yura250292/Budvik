# "Oplata zaborgovanosti" -- the document that must be subtracted from the sheet.
#
# The owner's screenshots settle the payroll formula. Sheet No 1817 totals
# 71 966.52 UAH, and inside that list one row is not a delivery at all:
#
#     row 9: FOP Osoba Roman -- "Oplata zaborgovanosti 000001242" -- 5 888.00
#
# That is old debt the driver collected, not goods he carried today. So:
#     (71 966.52 - 5 888.00) x 0.5% = 330.39 UAH
#
# The route sheet therefore mixes TWO document kinds in one list -- realizations
# and debt payments -- and the percentage applies only to the realizations.
#
# The exchange already reads PriKhodnyiKassovyiOrder filtered to
# VidyOperaciiPKO.OplataPokupatelya. The question this probe answers: is
# "Oplata zaborgovanosti" that same PKO under a different VidOperacii, or a
# separate document type we do not read at all? Payroll cannot be computed
# correctly until that is known.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-debt-payment-doc.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-debt-doc.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $DocNumber = "000001242"
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
$ENUM   = C 1055,1077,1088,1077,1095,1080,1089,1083,1077,1085,1080,1077  # Perechislenie
$VALUE  = C 1047,1053,1040,1063,1045,1053,1048,1045                # ZNACHENIE
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$DATE   = C 1044,1072,1090,1072                                    # Data
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$SUMDOC = C 1057,1091,1084,1084,1072,1044,1086,1082,1091,1084,1077,1085,1090,1072  # SummaDokumenta
$KONTR  = C 1050,1086,1085,1090,1088,1072,1075,1077,1085,1090      # Kontragent
$VIDOP  = C 1042,1080,1076,1054,1087,1077,1088,1072,1094,1080,1080 # VidOperacii
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$PARAM  = C 1053,1086,1084                                         # Nom

$PKO    = C 1055,1088,1080,1093,1086,1076,1085,1099,1081,1050,1072,1089,1089,1086,1074,1099,1081,1054,1088,1076,1077,1088  # PrikhodnyiKassovyiOrder

# --- 1. Is document number 000001242 a PKO? ---------------------------------
#
# The screenshot gives us a real number, so this is a lookup, not a guess.

Write-Host ("=== 1. Is {0} a PriKhodnyiKassovyiOrder? ===" -f $DocNumber)

$foundInPko = $false
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 5 P.$REF, P.$NUM, P.$DATE, P.$SUMDOC, P.$KONTR.$NAME, P.$VIDOP" +
              " $FROM $DOC.$PKO $AS P $WHERE P.$NUM = &$PARAM"
    $q.SetParameter($PARAM, $DocNumber)
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "null" }
    $r = $rs.Choose()
    while ($r.Next()) {
        $foundInPko = $true
        $n = ([string]$r.Get(1)).Trim()
        $d = ([string]$r.Get(2)).Trim()
        $s = ([string]$r.Get(3)).Trim()
        $k = ([string]$r.Get(4)).Trim()
        Write-Host ("  MATCH: PKO {0} of {1}, {2} UAH, counterparty: {3}" -f $n, $d, $s, $k)
    }
    if (-not $foundInPko) { Write-Host "  no PKO with that number" }
}
catch {
    Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
}
Write-Host ""

# --- 2. A separate document type? -------------------------------------------
#
# If it is not a PKO, the name printed on the form -- "Oplata zaborgovanosti" --
# is likely the document type itself. Ukrainian spelling first: this
# configuration named its route sheet in Ukrainian.

Write-Host "=== 2. Candidate document names ==="

$names = @(
    @{ l = "OplataZaborgovanosti (UA)"; n = (C 1054,1087,1083,1072,1090,1072,1047,1072,1073,1086,1088,1075,1086,1074,1072,1085,1086,1089,1090,1110) },
    @{ l = "OplataZadolzhennosti (RU)"; n = (C 1054,1087,1083,1072,1090,1072,1047,1072,1076,1086,1083,1078,1077,1085,1085,1086,1089,1090,1080) },
    @{ l = "OplataBorgu (UA)";          n = (C 1054,1087,1083,1072,1090,1072,1041,1086,1088,1075,1091) },
    @{ l = "OplataDolga (RU)";          n = (C 1054,1087,1083,1072,1090,1072,1044,1086,1083,1075,1072) },
    @{ l = "Oplata";                    n = (C 1054,1087,1083,1072,1090,1072) },
    @{ l = "PogashennyaBorgu";          n = (C 1055,1086,1075,1072,1096,1077,1085,1085,1103,1041,1086,1088,1075,1091) },
    @{ l = "PogashenieDolga";           n = (C 1055,1086,1075,1072,1096,1077,1085,1080,1077,1044,1086,1083,1075,1072) },
    @{ l = "PrihodnyiOrder (UA)";       n = (C 1055,1088,1080,1073,1091,1090,1082,1086,1074,1080,1081,1050,1072,1089,1086,1074,1080,1081,1054,1088,1076,1077,1088) },
    @{ l = "KasovyiOrder (UA)";         n = (C 1050,1072,1089,1086,1074,1080,1081,1054,1088,1076,1077,1088) }
)

foreach ($d in $names) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 3 R.$REF, R.$NUM, R.$DATE $FROM $DOC.$($d.n) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $has = $r.Next()
        $sample = ""
        if ($has) { try { $sample = ([string]$r.Get(1)).Trim() + " of " + ([string]$r.Get(2)).Trim() } catch { } }
        Write-Host ("  FOUND   Dokument.{0,-28} {1}" -f $d.l,
            $(if ($has) { "sample: $sample" } else { "(empty)" }))
    }
    catch { }
}
Write-Host ""

# --- 3. What operation kinds do PKOs have? ----------------------------------
#
# The exchange filters on VidyOperaciiPKO.OplataPokupatelya. If debt collection
# is a DIFFERENT kind, our payment sync is silently skipping it -- which would
# matter well beyond driver payroll.

Write-Host "=== 3. PKO operation kinds actually in use (last 500) ==="

try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 500 P.$VIDOP, P.$SUMDOC $FROM $DOC.$PKO $AS P $WHERE P.$POSTED"
    $rs = $q.Execute()
    if ($null -eq $rs) { throw "null" }
    $r = $rs.Choose()
    $kinds = @{}
    while ($r.Next()) {
        $v = ([string]$r.Get(0)).Trim()
        if (-not $v) { $v = "(empty)" }
        if (-not $kinds.ContainsKey($v)) { $kinds[$v] = 0 }
        $kinds[$v]++
    }
    foreach ($k in ($kinds.Keys | Sort-Object { -$kinds[$_] })) {
        Write-Host ("  {0,5}x  {1}" -f $kinds[$k], $k)
    }
}
catch {
    Write-Host ("  FAILED: " + $_.Exception.Message.Split("`n")[0])
}
Write-Host ""

# --- 4. How does the sheet link to its documents? ---------------------------
#
# No tabular section was found on MarshrutnyjLyst, so the print form must
# gather rows by querying documents that reference the sheet. If realizations
# and PKOs carry a link back to the route sheet, we can rebuild the stop list
# exactly as the printed form does.

Write-Host "=== 4. Do documents point back at the route sheet? ==="

$RS = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$REALIZ = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug

$linkAttrs = @(
    @{ l = "MarshrutnyjLyst";  n = $RS },
    @{ l = "Marshrut";         n = (C 1052,1072,1088,1096,1088,1091,1090) },
    @{ l = "MarshrutnyiList";  n = (C 1052,1072,1088,1096,1088,1091,1090,1085,1099,1081,1051,1080,1089,1090) },
    @{ l = "Voditel";          n = (C 1042,1086,1076,1080,1090,1077,1083,1100) },
    @{ l = "DokumentOsnovanie";n = (C 1044,1086,1082,1091,1084,1077,1085,1090,1054,1089,1085,1086,1074,1072,1085,1080,1077) },
    @{ l = "Osnovanie";        n = (C 1054,1089,1085,1086,1074,1072,1085,1080,1077) }
)

foreach ($target in @(
    @{ l = "RealizaciyaTovarovUslug"; n = $REALIZ },
    @{ l = "PriKhodnyiKassovyiOrder"; n = $PKO }
)) {
    Write-Host ("  --- {0}" -f $target.l)
    foreach ($a in $linkAttrs) {
        try {
            $q = $ib.NewObject("Query")
            $q.Text = "$SELECT $FIRST 40 R.$REF, R.$($a.n) $FROM $DOC.$($target.n) $AS R"
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "null" }
            $r = $rs.Choose()
            $rows = 0
            $filled = 0
            while ($r.Next()) {
                $rows++
                $v = $r.Get(1)
                if ($null -eq $v) { continue }
                $txt = ([string]$v).Trim()
                if ($txt -eq "System.__ComObject") { $filled++ }
                elseif ($txt -ne "" -and $txt -ne "0") { $filled++ }
            }
            Write-Host ("      OK      {0,-20} {1,2}/{2,-2} filled" -f $a.l, $filled, $rows)
        }
        catch {
            Write-Host ("      absent  {0}" -f $a.l)
        }
    }
}
Write-Host ""

Write-Host "=== What this settles ==="
Write-Host "1/2: whether 'Oplata zaborgovanosti' is a PKO kind or its own document."
Write-Host "3:   whether our payment sync silently skips debt collection -- a bug"
Write-Host "     with consequences far beyond driver payroll if so."
Write-Host "4:   whether the stop list can be rebuilt from documents pointing back"
Write-Host "     at the sheet. If nothing points back, the print form matches by"
Write-Host "     driver+date, and so must we."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
