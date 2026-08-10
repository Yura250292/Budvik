# Probe #10: find a phrasing of the debt query that this build accepts.
#
# READ ONLY.
#
# The production query fails with a bare NullReferenceException, while an
# earlier probe over the same register and the same fields worked. Something
# in the phrasing matters. This tries the variants one at a time so the answer
# is a fact rather than another guess.
#
# Variants, from the known-good probe outwards:
#   A  exactly the probe that worked  (TOP 10, no alias, no WHERE)
#   B  same, without TOP
#   C  with an alias and prefixed fields  (what production uses)
#   D  no TOP, no alias, WHERE on the resource
#   E  only the dimension, to see whether the resource name is the problem
#   F  the management-sum resource instead
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-debt.ps1
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1.

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$configPath = Join-Path $scriptDir "config.json"
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT  = C 0x412,0x42B,0x411,0x420,0x410,0x422,0x42C
$TOP     = C 0x41F,0x415,0x420,0x412,0x42B,0x415
$FROM    = C 0x418,0x417
$WHERE   = C 0x413,0x414,0x415
$AS      = C 0x41A,0x410,0x41A
$REGACC  = C 0x420,0x435,0x433,0x438,0x441,0x442,0x440,0x41D,0x430,0x43A,0x43E,0x43F,0x43B,0x435,0x43D,0x438,0x44F
$OSTATKI = C 0x41E,0x441,0x442,0x430,0x442,0x43A,0x438
$KONTR   = C 0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442
$VZAIMO  = C 0x412,0x437,0x430,0x438,0x43C,0x43E,0x440,0x430,0x441,0x447,0x435,0x442,0x44B,0x421,0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442,0x430,0x43C,0x438
$SUMOST  = C 0x421,0x443,0x43C,0x43C,0x430,0x412,0x437,0x430,0x438,0x43C,0x43E,0x440,0x430,0x441,0x447,0x435,0x442,0x43E,0x432,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A
$SUMUPR  = C 0x421,0x443,0x43C,0x43C,0x430,0x423,0x43F,0x440,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A
$NAIM    = C 0x41D,0x430,0x438,0x43C,0x435,0x43D,0x43E,0x432,0x430,0x43D,0x438,0x435

$TABLE = "$REGACC.$VZAIMO.$OSTATKI"

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    $config.oneC.server, $config.oneC.base, $config.oneC.user, $config.oneC.password
$ib = $conn.Connect($cs)
Write-Host "CONNECTED"
Write-Host ""

# Reports row count and a total, so a variant that "works" but returns nothing
# is not mistaken for success.
function Try1($label, $queryText) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queryText
        $rs = $q.Execute()
        if ($null -eq $rs) { Write-Host ("  -- {0}: Execute returned null" -f $label); return }
        $r = $rs.Choose()
        $n = 0
        $sum = 0
        while ($r.Next()) {
            $n++
            if ($r.FieldCount -gt 1 -or $true) {
                try { $sum += [double]$r.Get(1) } catch { }
            }
        }
        Write-Host ("  OK   {0,-14} rows={1}  sum={2:N2}" -f $label, $n, $sum)
    }
    catch {
        Write-Host ("  FAIL {0,-14} {1}" -f $label, $_.Exception.Message)
    }
}

Write-Host "-- debt query variants"
Try1 "A_probe_form"  "$SELECT $TOP 10 $KONTR, $SUMOST $FROM $TABLE"
Try1 "B_no_top"      "$SELECT $KONTR, $SUMOST $FROM $TABLE"
Try1 "C_alias"       "$SELECT V.$KONTR, V.$SUMOST $FROM $TABLE $AS V"
Try1 "D_where"       "$SELECT $KONTR, $SUMOST $FROM $TABLE $WHERE $SUMOST <> 0"
Try1 "E_dim_only"    "$SELECT $KONTR, $KONTR.$NAIM $FROM $TABLE"
Try1 "F_mgmt_sum"    "$SELECT $KONTR, $SUMUPR $FROM $TABLE"
Write-Host ""

Write-Host "DONE"
