# Probe #9: is "brand" a real attribute in 1C, or only a word in the name?
#
# READ ONLY.
#
# This decides how brand-level KPI gets built. A real attribute (or a linked
# catalogue) is authoritative and survives renames; parsing the name is a
# guess that breaks the first time someone writes "Sigma" instead of "SIGMA".
#
# Candidates checked, in order of preference:
#   1. Proizvoditel / TorgovayaMarka / Brend as a Nomenklatura attribute
#   2. A dedicated catalogue (Spravochnik.Proizvoditeli / TorgovyeMarki)
#   3. Nomenklaturnaya gruppa -- sometimes used as a brand grouping here
#
# Also samples the document fields needed for sales analytics, so stage 2 can
# be written without another round trip.
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-brand.ps1
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1.
#
# Note on this build: "VYBRAT PERVYE 1 <single field>" throws; every probe
# selects at least two fields.

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$configPath = Join-Path $scriptDir "config.json"
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$NAIM    = C 0x41D,0x430,0x438,0x43C,0x435,0x43D,0x43E,0x432,0x430,0x43D,0x438,0x435
$SELECT  = C 0x412,0x42B,0x411,0x420,0x410,0x422,0x42C
$TOP     = C 0x41F,0x415,0x420,0x412,0x42B,0x415
$DIFF    = C 0x420,0x410,0x417,0x41B,0x418,0x427,0x41D,0x42B,0x415
$FROM    = C 0x418,0x417
$WHERE   = C 0x413,0x414,0x415
$NOT     = C 0x41D,0x415
$CAT     = C 0x421,0x43F,0x440,0x430,0x432,0x43E,0x447,0x43D,0x438,0x43A
$DOC     = C 0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442
$NOMENKC = C 0x41D,0x43E,0x43C,0x435,0x43D,0x43A,0x43B,0x430,0x442,0x443,0x440,0x430
$ETOGR   = C 0x42D,0x442,0x43E,0x413,0x440,0x443,0x43F,0x43F,0x430

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    $config.oneC.server, $config.oneC.base, $config.oneC.user, $config.oneC.password
$ib = $conn.Connect($cs)
Write-Host "CONNECTED"
Write-Host ""

function Show($v) {
    if ($null -eq $v) { return "<null>" }
    $s = [string]$v
    if ($s -ne "System.__ComObject") { return $s }
    try {
        $p = $v.$NAIM
        if ($null -ne $p) {
            $ps = [string]$p
            if ($ps -and $ps -ne "System.__ComObject") { return $ps }
        }
    } catch { }
    return "<ref>"
}

function Probe($label, $queryText, $cols, $maxRows) {
    if (-not $maxRows) { $maxRows = 10 }
    try {
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queryText
        $rs = $q.Execute()
        if ($null -eq $rs) { Write-Host ("  -- {0}: Execute returned null" -f $label); return }
        $r = $rs.Choose()
        $n = 0
        $lines = @()
        while ($r.Next()) {
            $n++
            if ($n -le $maxRows) {
                $parts = @()
                for ($i = 0; $i -lt $cols; $i++) { $parts += (Show $r.Get($i)) }
                $lines += ("       " + ($parts -join " | "))
            }
        }
        Write-Host ("  OK {0}   rows={1}" -f $label, $n)
        $lines | ForEach-Object { Write-Host $_ }
    }
    catch {
        Write-Host ("  -- {0}: {1}" -f $label, $_.Exception.Message)
    }
}

# --- Q1: brand as an attribute of Nomenklatura ----------------------------
Write-Host "-- brand as a product attribute"
$PROIZV  = C 0x41F,0x440,0x43E,0x438,0x437,0x432,0x43E,0x434,0x438,0x442,0x435,0x43B,0x44C            # Proizvoditel
$TORGM   = C 0x422,0x43E,0x440,0x433,0x43E,0x432,0x430,0x44F,0x41C,0x430,0x440,0x43A,0x430            # TorgovayaMarka
$BREND   = C 0x411,0x440,0x435,0x43D,0x434                                                            # Brend
$NOMGR   = C 0x41D,0x43E,0x43C,0x435,0x43D,0x43A,0x43B,0x430,0x442,0x443,0x440,0x43D,0x430,0x44F,0x413,0x440,0x443,0x43F,0x43F,0x430
$STRANA  = C 0x421,0x442,0x440,0x430,0x43D,0x430,0x41F,0x440,0x43E,0x438,0x441,0x445,0x43E,0x436,0x434,0x435,0x43D,0x438,0x44F

Probe "attr_Proizvoditel"  "$SELECT $TOP 5 $NAIM, $PROIZV $FROM $CAT.$NOMENKC $WHERE $NOT $ETOGR" 2 5
Probe "attr_TorgovayaMarka" "$SELECT $TOP 5 $NAIM, $TORGM $FROM $CAT.$NOMENKC $WHERE $NOT $ETOGR" 2 5
Probe "attr_Brend"          "$SELECT $TOP 5 $NAIM, $BREND $FROM $CAT.$NOMENKC $WHERE $NOT $ETOGR" 2 5
Probe "attr_NomGruppa"      "$SELECT $TOP 5 $NAIM, $NOMGR $FROM $CAT.$NOMENKC $WHERE $NOT $ETOGR" 2 5
Probe "attr_Strana"         "$SELECT $TOP 5 $NAIM, $STRANA $FROM $CAT.$NOMENKC $WHERE $NOT $ETOGR" 2 5
Write-Host ""

# --- Q2: a dedicated brand catalogue? -------------------------------------
Write-Host "-- dedicated brand catalogues"
$PROIZVI = C 0x41F,0x440,0x43E,0x438,0x437,0x432,0x43E,0x434,0x438,0x442,0x435,0x43B,0x438            # Proizvoditeli
$TORGMI  = C 0x422,0x43E,0x440,0x433,0x43E,0x432,0x44B,0x435,0x41C,0x430,0x440,0x43A,0x438            # TorgovyeMarki
$NOMGRI  = C 0x41D,0x43E,0x43C,0x435,0x43D,0x43A,0x43B,0x430,0x442,0x443,0x440,0x43D,0x44B,0x435,0x413,0x440,0x443,0x43F,0x43F,0x44B
$KOD     = C 0x41A,0x43E,0x434

Probe "cat_Proizvoditeli"   "$SELECT $TOP 25 $NAIM, $KOD $FROM $CAT.$PROIZVI" 2 25
Probe "cat_TorgovyeMarki"   "$SELECT $TOP 25 $NAIM, $KOD $FROM $CAT.$TORGMI" 2 25
Probe "cat_NomGruppy"       "$SELECT $TOP 25 $NAIM, $KOD $FROM $CAT.$NOMGRI" 2 25
Write-Host ""

# --- Q3: sales-analytics fields on the order document ---------------------
# Everything stage 2 needs, sampled once so the production queries can be
# written straight from this output.
Write-Host "-- order document: analytics fields"
$ZAKAZ  = C 0x417,0x430,0x43A,0x430,0x437,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x44F
$NOMER  = C 0x41D,0x43E,0x43C,0x435,0x440
$DATA   = C 0x414,0x430,0x442,0x430
$KONTR  = C 0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442
$OTVET  = C 0x41E,0x442,0x432,0x435,0x442,0x441,0x442,0x432,0x435,0x43D,0x43D,0x44B,0x439
$SUMMA  = C 0x421,0x443,0x43C,0x43C,0x430,0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442,0x430
$PROVED = C 0x41F,0x440,0x43E,0x432,0x435,0x434,0x435,0x43D

Probe "order_analytics" `
    "$SELECT $TOP 5 $NOMER, $DATA, $OTVET.$NAIM, $KONTR.$NAIM, $SUMMA $FROM $DOC.$ZAKAZ $WHERE $PROVED" 5 5
Write-Host ""

Write-Host "DONE"
