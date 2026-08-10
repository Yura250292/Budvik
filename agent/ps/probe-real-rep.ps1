# Probe: which field on RealizaciyaTovarovUslug identifies the SALES REP.
#
# Otvetstvennyi on a realization turns out to be whoever POSTED the shipment
# (one storekeeper holds 3566 of 5114 documents), not who sold it. The rep
# lives on the originating order, so we need a link back to it.
#
# Each candidate is tried separately: on this 8.2 build a missing field fails
# the whole query with a bare NullReferenceException, so one combined query
# would tell us nothing about which field was the bad one.
#
# READ-ONLY. Run with 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-real-rep.ps1

[CmdletBinding()]
param([string] $ConfigPath)

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

# Cyrillic query text must not live in this file (OEM codepage mangles it),
# so it is assembled from char codes.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST5 = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REAL   = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075
$POSTED = C 1055,1088,1086,1074,1077,1076,1077,1085                # Proveden
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer

$base = "$SELECT $FIRST5 40 $NUM"
$tail = " $FROM $DOC.$REAL $AS R $WHERE R.$POSTED"

# Candidate fields that might carry the order (and therefore the rep).
$NAME = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077        # Naimenovanie
$SDELKA = C 1057,1076,1077,1083,1082,1072                                    # Sdelka
$MGR  = C 1052,1077,1085,1077,1076,1078,1077,1088                            # Menedzher
$RESP = C 1054,1090,1074,1077,1090,1089,1090,1074,1077,1085,1085,1099,1081   # Otvetstvennyi

# Reference fields come back as System.__ComObject, so read ".Naimenovanie"
# instead: the string arrives reliably where the reference does not.
$candidates = @(
    @{ name = "Menedzher.Naimenovanie"; field = "$MGR.$NAME" },
    @{ name = "Otvetstvennyi.Naimenovanie (current)"; field = "$RESP.$NAME" },
    @{ name = "Sdelka.Naimenovanie"; field = "$SDELKA.$NAME" }
)

foreach ($c in $candidates) {
    $text = "$base, R." + $c.field + $tail
    try {
        $q = $ib.NewObject("Query")
        $q.Text = $text
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $r = $rs.Choose()

        # Distribution, not a sample list: one storekeeper posting everything
        # is only visible as a count. That is exactly how the current field
        # was caught -- 3566 of 5114 documents on a single name.
        $tally = @{}
        $rows = 0
        while ($r.Next()) {
            $v = $r.Get(1)
            $s = if ($null -eq $v) { "<null>" } else { ([string]$v).Trim() }
            if ($s -eq "") { $s = "<empty>" }
            if (-not $tally.ContainsKey($s)) { $tally[$s] = 0 }
            $tally[$s]++
            $rows++
        }
        Write-Host ("OK    " + $c.name + "  (" + $tally.Count + " distinct in " + $rows + " docs)")
        foreach ($k in ($tally.Keys | Sort-Object { -$tally[$_] })) {
            Write-Host ("          " + ([string]$tally[$k]).PadLeft(3) + "x  " + $k)
        }
    } catch {
        Write-Host ("ABSENT " + $c.name)
    }
}

Write-Host ""
Write-Host "Fields marked OK exist. Look for one whose value names an ORDER or a person"
Write-Host "other than the storekeeper -- that is the sales rep we need."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
