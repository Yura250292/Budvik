# Why do register queries fail, when the live exchange reads registers daily?
#
# probe-list-all-docs reported every accumulation register as "not readable",
# including TovaryNaSkladah -- which queries.json reads every cycle. The name is
# byte-identical to the working one (verified), so the name is not the problem.
#
# The suspect is the QUERY SHAPE. The exchange always reads a virtual table --
# "RegistrNakopleniya.TovaryNaSkladah.Ostatki" (balances) -- never the movement
# table directly. Reading the physical movement table, and selecting Registrator
# from it, is a different access path and may be what fails: on some builds the
# main table needs an explicit virtual-table suffix, or Registrator is simply
# not selectable this way.
#
# Each variant below is one query in its own try/catch, printing the exact error
# instead of a blanket "not readable". Whichever variant answers tells us how to
# enumerate document types -- and if none does, that is decisive too.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-registrar-syntax.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-registrar.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath
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

$SELECT   = C 1042,1067,1041,1056,1040,1058,1068                   # VYBRAT
$FIRST    = C 1055,1045,1056,1042,1067,1045                        # PERVYE
$FROM     = C 1048,1047                                            # IZ
$AS       = C 1050,1040,1050                                       # KAK
$REG      = C 1056,1077,1075,1080,1089,1090,1088,1053,1072,1082,1086,1087,1083,1077,1085,1080,1103  # RegistrNakopleniya
$TOVSKLAD = C 1058,1086,1074,1072,1088,1099,1053,1072,1057,1082,1083,1072,1076,1072,1093            # TovaryNaSkladah
$OSTATKI  = C 1054,1089,1090,1072,1090,1082,1080                   # Ostatki
$OBOROTY  = C 1054,1073,1086,1088,1086,1090,1099                   # Oboroty
$REGISTRAR= C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088  # Registrator
$NOMENKL  = C 1053,1086,1084,1077,1085,1082,1083,1072,1090,1091,1088,1072  # Nomenklatura
$PERIOD   = C 1055,1077,1088,1080,1086,1076                        # Period

# Every probe is written inline, never wrapped in a helper: a PowerShell
# function that builds a Query and returns its result yields null on this build
# (documented quirk, hit three times before). $variants below is walked by one
# inline loop instead.

$variants = @()
function AddVariant([string] $label, [string] $text) {
    $script:variants += @{ label = $label; text = $text }
}

$DOC   = C 1044,1086,1082,1091,1084,1077,1085,1090                 # Dokument
$ZAKAZ = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # ZakazPokupatelya
$DATE  = C 1044,1072,1090,1072                                     # Data

# 1: the shape queries.json uses (virtual table) -- must work.
AddVariant "1. Ostatki virtual table, Nomenklatura" "$SELECT $FIRST 3 T.$NOMENKL $FROM $REG.$TOVSKLAD.$OSTATKI $AS T"
# 2: the physical movement table, in five shapes -- this is what failed before.
AddVariant "2. main table, Registrator only"  "$SELECT $FIRST 3 T.$REGISTRAR $FROM $REG.$TOVSKLAD $AS T"
AddVariant "2. main table, two columns"       "$SELECT $FIRST 3 T.$REGISTRAR, T.$PERIOD $FROM $REG.$TOVSKLAD $AS T"
AddVariant "2. main table, no alias"          "$SELECT $FIRST 3 $REGISTRAR $FROM $REG.$TOVSKLAD"
AddVariant "2. main table, Period only"       "$SELECT $FIRST 3 T.$PERIOD $FROM $REG.$TOVSKLAD $AS T"
AddVariant "2. main table, Nomenklatura"      "$SELECT $FIRST 3 T.$NOMENKL $FROM $REG.$TOVSKLAD $AS T"
# 3: turnovers table.
AddVariant "3. Oboroty, Nomenklatura"         "$SELECT $FIRST 3 T.$NOMENKL $FROM $REG.$TOVSKLAD.$OBOROTY $AS T"
# 4: control -- a plain document read, known to work from the sanity probe.
AddVariant "4. CONTROL Dokument.ZakazPokupatelya" "$SELECT $FIRST 3 R.$DATE $FROM $DOC.$ZAKAZ $AS R"

Write-Host "=== Query shapes, one by one ==="
Write-Host ""

foreach ($v in $variants) {
    Write-Host ("  --- {0}" -f $v.label)
    Write-Host ("      {0}" -f $v.text)
    try {
        $q = $ib.NewObject("Query")
        $q.Text = $v.text
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        $n = 0
        $sample = ""
        while ($r.Next() -and $n -lt 3) {
            $n++
            if (-not $sample) {
                try { $sample = ([string]$r.Get(0)).Trim() } catch { }
            }
        }
        Write-Host ("      OK: {0} rows, first value: {1}" -f $n, $sample)
    }
    catch {
        Write-Host ("      FAILED: {0}" -f $_.Exception.Message.Split("`n")[0])
    }
    Write-Host ""
}

Write-Host "=== Verdict ==="
Write-Host "Section 1 OK + section 2 all FAILED => registers are readable only as"
Write-Host "  virtual tables on this build; Registrator cannot be enumerated that"
Write-Host "  way, and the document list must come from 1C itself (Operations ->"
Write-Host "  Documents) or from the configurator."
Write-Host "Section 2 any OK => that shape works; the earlier sweep used the wrong"
Write-Host "  one and can be fixed."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
