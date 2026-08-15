# Probe: where does cost of goods live in this UT 2.3 base?
#
# The exchange currently writes purchasePrice = 0 for every realization line
# (see apply-documents.ts) on the belief that 1C does not hand out cost. That
# belief is wrong: the operator has the report "Valovaya pribyl val" open and
# it shows real margin per client (4,84% on 259 731,18). So the number exists —
# only its source register was never identified.
#
# Without cost the whole profitability layer is dead: margin per product,
# client and rep; automatic gross for payroll (typed in by hand today);
# ABC by profit; stock value at real money.
#
# Candidates, in the order UT 2.3 usually stores them:
#   1. RegistrNakopleniya.Prodazhi -- resource Sebestoimost (or ...BezNDS).
#      Best case: cost sits next to revenue, keyed by Registrator, so a
#      realization line maps 1:1.
#   2. RegistrNakopleniya.ProdazhiSebestoimost -- separate register in some
#      builds.
#   3. RegistrNakopleniya.PartiiTovarovNaSkladah -- batch consumption; cost has
#      to be summed per registrar.
#   4. Whatever the report itself reads -- section 5 dumps the report object's
#      metadata so we can follow it if 1-3 all miss.
#
# Every candidate is its own query in its own try/catch: a wrong name fails
# Execute() with a bare NullReferenceException that names nothing, and one bad
# call poisons the COM session for every query after it.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-cost.ps1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Days = 30
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

$SELECT = C 1042,1067,1041,1056,1040,1058,1068
$FIRST  = C 1055,1045,1056,1042,1067,1045
$FROM   = C 1048,1047
$AS     = C 1050,1040,1050
$WHERE  = C 1043,1044,1045
$AND    = C 1048
$SUM    = C 1057,1059,1052,1052,1040
$GROUPBY = (C 1057,1043,1056,1059,1055,1055,1048,1056,1054,1042,1040,1058,1068) + " " + (C 1055,1054)

$REG    = C 1056,1077,1075,1080,1089,1090,1088,1053,1072,1082,1086,1087,1083,1077,1085,1080,1103
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090

$Prodazhi               = C 1055,1088,1086,1076,1072,1078,1080
$ProdazhiSebestoimost   = C 1055,1088,1086,1076,1072,1078,1080,1057,1077,1073,1077,1089,1090,1086,1080,1084,1086,1089,1090,1100
$PartiiTovarov          = C 1055,1072,1088,1090,1080,1080,1058,1086,1074,1072,1088,1086,1074,1053,1072,1057,1082,1083,1072,1076,1072,1093
$Sebestoimost           = C 1057,1077,1073,1077,1089,1090,1086,1080,1084,1086,1089,1090,1100
$SebestoimostBezNDS     = C 1057,1077,1073,1077,1089,1090,1086,1080,1084,1086,1089,1090,1100,1041,1077,1079,1053,1044,1057
$Stoimost               = C 1057,1090,1086,1080,1084,1086,1089,1090,1100
$Registrator            = C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088
$Nomenklatura           = C 1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1072
$Kolichestvo            = C 1050,1086,1083,1080,1095,1077,1089,1090,1074,1086
$Summa                  = C 1057,1091,1084,1084,1072
$Data                   = C 1044,1072,1090,1072
$Realizaciya            = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075
$ValovayaPribylVal      = C 1042,1072,1083,1086,1074,1072,1103,1055,1088,1080,1073,1099,1083,1100,1042,1072,1083

$since = (Get-Date).AddDays(-$Days)

function Try-Query {
    param([string] $Label, [string] $Text, [hashtable] $Params = @{})

    Write-Host ("-" * 70)
    Write-Host $Label
    try {
        $q = $ib.NewObject("Query")
        $q.Text = $Text
        foreach ($k in $Params.Keys) { $q.SetParameter($k, $Params[$k]) }
        $sel = $q.Execute().Choose()
        $n = 0
        while ($sel.Next() -and $n -lt 8) {
            $n++
            $line = @()
            for ($i = 0; $i -lt 6; $i++) {
                try {
                    $v = $sel.Get($i)
                    if ($null -eq $v) { break }
                    $line += ("[{0}] {1}" -f $i, $v)
                } catch { break }
            }
            Write-Host ("  " + ($line -join "  "))
        }
        if ($n -eq 0) { Write-Host "  OK (query valid) but ZERO rows" }
        else { Write-Host ("  OK -- {0} row(s) shown" -f $n) }
        return $true
    } catch {
        Write-Host ("  FAIL: " + $_.Exception.Message.Split("`n")[0])
        return $false
    }
}

Write-Host "=========================================================="
Write-Host " 1. RegistrNakopleniya.Prodazhi -- does it exist at all?"
Write-Host "=========================================================="

Try-Query "1a. Prodazhi: Registrator + Nomenklatura + Kolichestvo + Summa" @"
$SELECT $FIRST 5 $Registrator, $Nomenklatura, $Kolichestvo, $Summa
$FROM $REG.$Prodazhi
"@

# The resource we are hunting. If 1a passed and this fails, the register exists
# but carries no cost -- move on to the batch register.
Try-Query "1b. Prodazhi: resource Sebestoimost" @"
$SELECT $FIRST 5 $Registrator, $Nomenklatura, $Kolichestvo, $Sebestoimost
$FROM $REG.$Prodazhi
"@

Try-Query "1c. Prodazhi: resource SebestoimostBezNDS" @"
$SELECT $FIRST 5 $Registrator, $Nomenklatura, $Sebestoimost, $SebestoimostBezNDS
$FROM $REG.$Prodazhi
"@

Write-Host ""
Write-Host "=========================================================="
Write-Host " 2. Separate cost register?"
Write-Host "=========================================================="

Try-Query "2a. RegistrNakopleniya.ProdazhiSebestoimost" @"
$SELECT $FIRST 5 $Registrator, $Nomenklatura, $Kolichestvo, $Stoimost
$FROM $REG.$ProdazhiSebestoimost
"@

Write-Host ""
Write-Host "=========================================================="
Write-Host " 3. Batch register (PartiiTovarovNaSkladah)"
Write-Host "=========================================================="

Try-Query "3a. Partii: Registrator + Nomenklatura + Stoimost" @"
$SELECT $FIRST 5 $Registrator, $Nomenklatura, $Kolichestvo, $Stoimost
$FROM $REG.$PartiiTovarov
"@

Write-Host ""
Write-Host "=========================================================="
Write-Host " 4. THE DECIDING TEST: cost joined to a real realization"
Write-Host "=========================================================="
Write-Host " If this returns rows, the exchange can be wired: one row per"
Write-Host " (document, product) with quantity, revenue and cost together."
Write-Host ""

# Registrator is cast to the realization document so only sales lines come
# back. Grouping collapses batch splits: one product can consume several
# batches inside one shipment, and we need the total per line.
Try-Query "4a. Prodazhi grouped by document+product, last $Days days" @"
$SELECT $FIRST 10
    P.$Registrator.$Data,
    P.$Registrator.$Summa,
    P.$Nomenklatura,
    $SUM(P.$Kolichestvo),
    $SUM(P.$Summa),
    $SUM(P.$Sebestoimost)
$FROM $REG.$Prodazhi $AS P
$WHERE P.$Registrator.$Data >= &DateFrom
$GROUPBY P.$Registrator.$Data, P.$Registrator.$Summa, P.$Nomenklatura
"@ @{ DateFrom = $since }

Try-Query "4b. same, but cost from Stoimost instead of Sebestoimost" @"
$SELECT $FIRST 10
    P.$Registrator.$Data,
    P.$Nomenklatura,
    $SUM(P.$Kolichestvo),
    $SUM(P.$Summa),
    $SUM(P.$Stoimost)
$FROM $REG.$Prodazhi $AS P
$WHERE P.$Registrator.$Data >= &DateFrom
$GROUPBY P.$Registrator.$Data, P.$Nomenklatura
"@ @{ DateFrom = $since }

Write-Host ""
Write-Host "=========================================================="
Write-Host " 5. Metadata sweep: list registers and the report itself"
Write-Host "=========================================================="

# If everything above failed, we still learn the real names here instead of
# guessing another round.
try {
    $md = $ib.Metadata
    Write-Host ""
    Write-Host "Accumulation registers containing 'prodazh' or 'sebest' or 'parti':"
    $regs = $md.AccumulationRegisters
    for ($i = 0; $i -lt $regs.Count(); $i++) {
        $nm = $regs.Get($i).Name
        $low = $nm.ToLower()
        if ($low.Contains((C 1087,1088,1086,1076,1072,1078).ToLower()) -or
            $low.Contains((C 1089,1077,1073,1077,1089).ToLower()) -or
            $low.Contains((C 1087,1072,1088,1090,1080).ToLower())) {
            Write-Host ("  * " + $nm)
            $res = $regs.Get($i).Resources
            for ($r = 0; $r -lt $res.Count(); $r++) {
                Write-Host ("      resource: " + $res.Get($r).Name)
            }
            $dims = $regs.Get($i).Dimensions
            for ($d = 0; $d -lt $dims.Count(); $d++) {
                Write-Host ("      dimension: " + $dims.Get($d).Name)
            }
        }
    }
} catch {
    Write-Host ("  metadata sweep FAILED: " + $_.Exception.Message.Split("`n")[0])
}

# The report the operator has open. Its name tells us nothing about its source,
# but if it is an external/added report we at least learn it is not a stock one.
try {
    $reports = $ib.Metadata.Reports
    Write-Host ""
    Write-Host "Reports whose name contains 'valov':"
    for ($i = 0; $i -lt $reports.Count(); $i++) {
        $nm = $reports.Get($i).Name
        if ($nm.ToLower().Contains((C 1074,1072,1083,1086,1074).ToLower())) {
            Write-Host ("  * " + $nm)
        }
    }
} catch {
    Write-Host ("  report sweep FAILED: " + $_.Exception.Message.Split("`n")[0])
}

Write-Host ""
Write-Host "=========================================================="
Write-Host " DONE. Report back sections 1-4 verdicts + section 5 names."
Write-Host "=========================================================="
