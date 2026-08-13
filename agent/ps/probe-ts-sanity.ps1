# Control test: can this COM connection read a tabular section AT ALL?
#
# 32 candidate names for MarshrutnyjLyst's section all failed with the same
# "Object reference not set". Identical failure for every name means the name
# is probably not what is failing -- so before guessing a 33rd, test a section
# we KNOW exists: Dokument.ZakazPokupatelya.Tovary, which production reads on
# every sync (queries.json -> orderItemsSince).
#
# Two possible outcomes, and they point in opposite directions:
#
#   Tovary WORKS  -> tabular sections are readable, so MarshrutnyjLyst really
#                    has no section under any tried name. The rows in the photo
#                    then come from somewhere else, and the print form is next.
#
#   Tovary FAILS  -> the probe method is broken, not the names. The sweep
#                    proved nothing, and the section may well exist.
#
# Either way this is the question worth answering before another guess.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-ts-sanity.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-ts-sanity.txt 2>&1

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

function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NOMSTR = C 1053,1086,1084,1077,1088,1057,1090,1088,1086,1082,1080 # NomerStroki
$NOMER  = C 1053,1086,1084,1077,1088                               # Nomer
$T      = C 1058                                                   # T
$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$ZAKAZ  = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # ZakazPokupatelya
$TOVARY = C 1058,1086,1074,1072,1088,1099                          # Tovary

function Try-Query([string] $label, [string] $text) {
    $connector = $null
    $ib = $null
    try {
        $connector = New-Object -ComObject V82.COMConnector
        $ib = $connector.Connect($connString)

        $q = $ib.NewObject("Query")
        $q.Text = $text
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute returned null" }
        $sel = $rs.Choose()
        if ($null -eq $sel) { throw "Choose returned null" }

        $rows = 0
        while ($sel.Next() -and $rows -lt 3) {
            $rows++
            $vals = @()
            for ($c = 0; $c -lt 4; $c++) {
                try { $vals += [string]$sel.Get($c) } catch { break }
            }
            Write-Host ("      row {0}: {1}" -f $rows, ($vals -join " | "))
        }
        Write-Host ("  OK      {0}  ({1} row(s) shown)" -f $label, $rows)
        return $true
    }
    catch {
        Write-Host ("  FAILED  {0}  --  {1}" -f $label, $_.Exception.Message.Split("`n")[0])
        return $false
    }
    finally {
        if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
        if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
        [GC]::Collect()
    }
}

Write-Host "=== Control: is ANY tabular section readable over this connection? ==="
Write-Host ""

# 1. The header alone -- known to work, so a failure here means the connection
#    or the document name is at fault, not tabular sections.
Write-Host "1. Sheet header (must work -- production reads it every cycle):"
[void](Try-Query "Dokument.MarshrutnyjLyst" "$SELECT $FIRST 3 $T.$REF, $T.$NOMER $FROM $DOC.$RS $AS $T")
Write-Host ""

# 2. A tabular section production reads on every sync. THE decisive test.
Write-Host "2. A tabular section known to exist (orderItemsSince reads it daily):"
$tovaryOk = Try-Query "Dokument.ZakazPokupatelya.Tovary" "$SELECT $FIRST 3 $T.$REF, $T.$NOMSTR $FROM $DOC.$ZAKAZ.$TOVARY $AS $T"
Write-Host ""

Write-Host "=== Verdict ==="
if ($tovaryOk) {
    Write-Host "Tabular sections ARE readable over COM."
    Write-Host "So MarshrutnyjLyst genuinely has no section under the 32 names tried,"
    Write-Host "and the rows in the photo are assembled elsewhere -- print form next."
} else {
    Write-Host "Even a section that production reads daily FAILED here."
    Write-Host "The method is at fault, not the names: the 32-name sweep proved nothing"
    Write-Host "and MarshrutnyjLyst may well have its rows stored after all."
}
