# List every document type in the database -- fixed version.
#
# The previous attempt reported all registers as unreadable. The syntax probe
# then proved the opposite: all seven query shapes work, including selecting
# Registrator from the physical movement table. So the queries were fine and the
# bug was mine -- XMLTypeOf() returned null on those references, every type was
# dropped, and the empty result was misreported as "not readable".
#
# A reference comes back as System.__ComObject, and there is more than one way
# to ask it what it is. This script tries five, in order of reliability, and
# reports which one worked -- so the winning method can be reused elsewhere:
#
#   1. $ib.XMLTypeOf($ref).TypeName      -- what failed before
#   2. $ref.Metadata().Name              -- metadata object of the reference
#   3. $ib.XMLString($ref)               -- serialised form, type is in the text
#   4. $ref.ToString()                   -- presentation, e.g. "Zakaz 0001 ot..."
#   5. TIPZNCH() in the query itself     -- 1C computes the type, we read a string
#
# Method 5 is the sturdiest: the type never leaves the query engine as an
# object, so nothing can be lost in COM marshalling.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-doc-types.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-doc-types.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [int] $Sample = 4000
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
$REGISTRAR= C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088  # Registrator
$TYPEFN   = C 1058,1048,1055,1047,1053,1063                        # TIPZNCH (type-of function)
$PRESENT  = C 1055,1056,1045,1044,1057,1058,1040,1042,1051,1045,1053,1048,1045  # PREDSTAVLENIE

$TOVSKLAD = C 1058,1086,1074,1072,1088,1099,1053,1072,1057,1082,1083,1072,1076,1072,1093  # TovaryNaSkladah
$VZAIMO   = C 1042,1079,1072,1080,1084,1086,1088,1072,1089,1095,1077,1090,1099,1057,1050,1086,1085,1090,1088,1072,1075,1077,1085,1090,1072,1084,1080  # VzaimoraschetySKontragentami
$PRODAZHI = C 1055,1088,1086,1076,1072,1078,1080                   # Prodazhi
$ZAKAZY   = C 1047,1072,1082,1072,1079,1099,1055,1086,1082,1091,1087,1072,1090,1077,1083,1077,1081  # ZakazyPokupateley
$REZERV   = C 1058,1086,1074,1072,1088,1099,1042,1056,1077,1079,1077,1088,1074,1077,1053,1072,1057,1082,1083,1072,1076,1072,1093  # TovaryVRezerveNaSkladah
$DENSRED  = C 1044,1077,1085,1077,1078,1085,1099,1077,1057,1088,1077,1076,1089,1090,1074,1072  # DenezhnyeSredstva

# --- 0. Which type-reading method actually works? ----------------------------
#
# One reference, five ways to name it. Everything downstream depends on the
# answer, so it is established first and printed plainly.

Write-Host "=== 0. How to read the type of a reference ==="

$probeRef = $null
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 1 T.$REGISTRAR $FROM $REG.$TOVSKLAD $AS T"
    $rs = $q.Execute()
    $r = $rs.Choose()
    if ($r.Next()) { $probeRef = $r.Get(0) }
} catch {
    Write-Host ("  could not fetch a sample reference: " + $_.Exception.Message)
}

$methodWorks = @{}

if ($null -ne $probeRef) {
    try {
        $t = $ib.XMLTypeOf($probeRef)
        $v = if ($null -eq $t) { "(null)" } else { [string]$t.TypeName }
        Write-Host ("  1. XMLTypeOf().TypeName : {0}" -f $v)
        $methodWorks["xmltypeof"] = ($v -ne "(null)" -and $v -ne "")
    } catch { Write-Host ("  1. XMLTypeOf().TypeName : FAILED " + $_.Exception.Message.Split("`n")[0]) }

    try {
        $v = [string]$probeRef.Metadata().Name
        Write-Host ("  2. Metadata().Name      : {0}" -f $v)
        $methodWorks["metadata"] = ($v -ne "")
    } catch { Write-Host ("  2. Metadata().Name      : FAILED " + $_.Exception.Message.Split("`n")[0]) }

    try {
        $v = [string]$ib.XMLString($probeRef)
        Write-Host ("  3. XMLString()          : {0}" -f $v)
        $methodWorks["xmlstring"] = ($v -ne "")
    } catch { Write-Host ("  3. XMLString()          : FAILED " + $_.Exception.Message.Split("`n")[0]) }

    try {
        $v = [string]$probeRef.ToString()
        Write-Host ("  4. ToString()           : {0}" -f $v)
        $methodWorks["tostring"] = ($v -ne "" -and $v -ne "System.__ComObject")
    } catch { Write-Host ("  4. ToString()           : FAILED " + $_.Exception.Message.Split("`n")[0]) }
}
else {
    Write-Host "  (no sample reference available)"
}

# Method 5 is tested as a query, not on the object.
try {
    $q = $ib.NewObject("Query")
    $q.Text = "$SELECT $FIRST 1 $TYPEFN(T.$REGISTRAR) $FROM $REG.$TOVSKLAD $AS T"
    $rs = $q.Execute()
    $r = $rs.Choose()
    if ($r.Next()) {
        $v = ([string]$r.Get(0)).Trim()
        Write-Host ("  5. TIPZNCH() in query   : {0}" -f $(if ($v) { $v } else { "(empty)" }))
        $methodWorks["tipznch"] = ($v -ne "")
    }
} catch { Write-Host ("  5. TIPZNCH() in query   : FAILED " + $_.Exception.Message.Split("`n")[0]) }

Write-Host ""

# --- 1. Enumerate document types across registers ----------------------------
#
# Two columns per row: the type as computed by 1C, and the presentation of the
# document itself. Presentation is the fallback -- even when the type name comes
# back empty, "Zakaz pokupatelya 00-0001 ot 12.08.2026" names the document in
# plain words, which is all we need to recognise a route sheet.

Write-Host "=== 1. Document types found in registers ==="

$registers = @(
    @{ l = "TovaryNaSkladah";  n = $TOVSKLAD },
    @{ l = "Prodazhi";         n = $PRODAZHI },
    @{ l = "Vzaimoraschety";   n = $VZAIMO },
    @{ l = "ZakazyPokupateley";n = $ZAKAZY },
    @{ l = "TovaryVRezerve";   n = $REZERV },
    @{ l = "DenezhnyeSredstva";n = $DENSRED }
)

$allTypes = @{}

foreach ($reg in $registers) {
    $rows = 0
    $found = @{}
    try {
        # Inline, never in a helper: a function that builds a Query and returns
        # its result yields null on this build.
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST $Sample $TYPEFN(T.$REGISTRAR) $AS Tp, " +
                  "$PRESENT(T.$REGISTRAR) $AS Pr $FROM $REG.$($reg.n) $AS T"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()
        while ($r.Next()) {
            $rows++
            $tp = ""
            $pr = ""
            try { $tp = ([string]$r.Get(0)).Trim() } catch { }
            try { $pr = ([string]$r.Get(1)).Trim() } catch { }

            # Presentation starts with the document's kind, e.g.
            # "Zakaz pokupatelya 00-0001 ot ...". Trim it to the leading words so
            # different numbers of the same kind collapse into one entry.
            $key = $tp
            if (-not $key -and $pr) {
                $parts = $pr -split '\s+'
                $take = [Math]::Min(3, $parts.Count)
                $key = ($parts[0..($take - 1)] -join " ")
            }
            if (-not $key) { continue }
            if (-not $found.ContainsKey($key)) { $found[$key] = 0 }
            $found[$key]++
            if (-not $allTypes.ContainsKey($key)) { $allTypes[$key] = 0 }
            $allTypes[$key]++
        }
        Write-Host ("  {0}: {1} rows, {2} distinct" -f $reg.l, $rows, $found.Count)
        foreach ($k in ($found.Keys | Sort-Object { -$found[$_] })) {
            Write-Host ("      {0,6}x  {1}" -f $found[$k], $k)
        }
    }
    catch {
        Write-Host ("  {0}: FAILED {1}" -f $reg.l, $_.Exception.Message.Split("`n")[0])
    }
    Write-Host ""
}

# --- 2. The combined list ----------------------------------------------------

Write-Host "=== 2. ALL document kinds discovered ==="
if ($allTypes.Count -eq 0) {
    Write-Host "  (still nothing -- report this verbatim)"
} else {
    foreach ($k in ($allTypes.Keys | Sort-Object { -$allTypes[$_] })) {
        Write-Host ("  {0,7}x  {1}" -f $allTypes[$k], $k)
    }
}
Write-Host ""
Write-Host "Anything above that looks like a driver's route sheet is our document."
Write-Host "Rerun the main probe with:  probe-route-sheets.ps1 -DocName <Name>"

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
