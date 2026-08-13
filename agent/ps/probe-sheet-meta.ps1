# Tabular sections of MarshrutnyjLyst -- ASK the object, do not guess the name.
#
# Why this probe exists: probe-sheet-ts-clean.ps1 swept 31 guessed section
# names and found none, and we concluded the sheet has no rows. A photo of
# sheet 000001820 open in 1C proves that wrong -- the form shows an editable
# 32-row table with Dokument / Kontragent / Adresa / Suma. So the section is
# real and simply has a name that was not in the guess list.
#
# The fix is to stop guessing. GetObject() on a document reference returns a
# live object whose Metadata().TabularSections is enumerable through COM, and
# each section reports its own Attributes. That gives the exact spelling
# instead of 31 hypotheses.
#
# ($ib.Metadata is null on this build -- that is what pushed earlier probes to
# guessing -- but Metadata() ON AN OBJECT works; probe-bank-payments.ps1:154
# already relies on it.)
#
# Reconnect per step: a failed Execute() poisons the session on this build, so
# a later query would answer "Object reference not set" for everything and we
# would again read a false "absent".
#
# READ-ONLY -- GetObject() reads; nothing is written, nothing is posted.
#
# 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-sheet-meta.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-sheet-meta.txt 2>&1

[CmdletBinding()]
param(
    [string] $ConfigPath,
    # Sheet visible in the photo. Any existing number works.
    [string] $Number = "000001820"
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

# Cyrillic built by code point: the source file must stay ASCII, otherwise the
# encoding gets mangled somewhere between Mac, RDP and PowerShell.
$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$NOMER  = C 1053,1086,1084,1077,1088                               # Nomer
$RS     = C 1052,1072,1088,1096,1088,1091,1090,1085,1080,1081,1051,1080,1089,1090  # MarshrutnyjLyst
$LALIAS = C 1051                                                   # L -- the alias production uses

function New-Ib {
    $c = New-Object -ComObject V82.COMConnector
    return @{ conn = $c; ib = $c.Connect($script:connString) }
}

function Close-Ib($h) {
    if ($null -eq $h) { return }
    if ($h.ib)   { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($h.ib) }
    if ($h.conn) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($h.conn) }
    [GC]::Collect()
}

# Everything below must run while the connection that produced $ref is still
# open -- a 1C reference dies with its connection, which is exactly how the
# previous run lost the sheet it had already found.
function Report-Structure($ib, $ref) {
    $obj = $ref.GetObject()
    if ($null -eq $obj) { Write-Host "GetObject() returned null."; return }
    Write-Host "Sheet object loaded."
    Write-Host ""

    $meta = $obj.Metadata()
    if ($null -eq $meta) { Write-Host "Metadata() returned null."; return }

    # Header attributes: the form shows Nach/Kon spidometr and Rentabelnist,
    # none of which the ingest carries yet. Odometer readings would give real
    # mileage instead of the planned OSRM estimate.
    try {
        $hattrs = $meta.Attributes
        Write-Host ("Header attributes: {0}" -f $hattrs.Count())
        for ($k = 0; $k -lt $hattrs.Count(); $k++) {
            $hn = [string]$hattrs.Get($k).Name
            # Indexer first, property second: on this build one usually works
            # when the other throws. A value read must never abort the report --
            # the NAMES are what we came for.
            $hv = ""
            try { $hv = [string]$obj[$hn] }
            catch { try { $hv = [string]$obj.$hn } catch { $hv = "<unreadable>" } }
            Write-Host ("      {0,-28} = {1}" -f $hn, $hv)
        }
        Write-Host ""
    } catch {
        Write-Host "Header attributes unreadable (not fatal)."
        Write-Host ""
    }

    $sections = $meta.TabularSections
    if ($null -eq $sections) { Write-Host "TabularSections is null."; return }

    Write-Host ("Tabular sections declared: {0}" -f $sections.Count())
    Write-Host ""

    for ($i = 0; $i -lt $sections.Count(); $i++) {
        $sec = $sections.Get($i)
        $secName = [string]$sec.Name

        $ts = $null
        try { $ts = $obj[$secName] } catch { try { $ts = $obj.$secName } catch { $ts = $null } }

        $rows = -1
        if ($null -ne $ts) { try { $rows = $ts.Count() } catch { $rows = -1 } }

        Write-Host ("--- {0}   (rows in this sheet: {1})" -f $secName, $rows)

        # These attribute names are what the ingest query will select.
        $attrs = $sec.Attributes
        for ($j = 0; $j -lt $attrs.Count(); $j++) {
            $a = $attrs.Get($j)
            Write-Host ("      {0,-28} {1}" -f ([string]$a.Name), ([string]$a.Type))
        }

        # First row of real values proves the columns carry what the form shows.
        if ($rows -gt 0) {
            Write-Host "      -- first row --"
            $row = $ts.Get(0)
            for ($j = 0; $j -lt $attrs.Count(); $j++) {
                $an = [string]$attrs.Get($j).Name
                $val = ""
                try { $val = [string]$row[$an] }
                catch { try { $val = [string]$row.$an } catch { $val = "<unreadable>" } }
                Write-Host ("      {0,-28} = {1}" -f $an, $val)
            }
        }
        Write-Host ""
    }
}

$connector = $null
$ib = $null

try {
    Write-Host "=== Sheet $Number : real tabular sections, straight from metadata ==="
    Write-Host ""

    # Find the sheet with a FRESH CONNECTION PER ATTEMPT. A failed Execute()
    # poisons the session on this build, so trying variants inside one
    # connection makes every attempt after the first fail for the wrong reason.
    $variants = @(
        @{ label = "production shape (L.Ssylka, L.Nomer)"; hasNumber = $true;  text = "$SELECT $LALIAS.$REF, $LALIAS.$NOMER $FROM $DOC.$RS $AS $LALIAS" },
        @{ label = "reference only";                       hasNumber = $false; text = "$SELECT $LALIAS.$REF $FROM $DOC.$RS $AS $LALIAS" },
        @{ label = "no alias at all";                      hasNumber = $true;  text = "$SELECT $REF, $NOMER $FROM $DOC.$RS" }
    )

    $ref = $null
    $firstRef = $null
    $firstNum = ""
    $handle = $null

    foreach ($v in $variants) {
        $h = $null
        try {
            $h = New-Ib
            $q = $h.ib.NewObject("Query")
            $q.Text = $v.text
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "Execute returned null" }

            $sel = $rs.Choose()
            if ($null -eq $sel) { throw "Choose() returned null" }

            # Columns MUST be read positionally. extract.ps1:14 records it:
            # "named access to query columns returns null on this build" --
            # and here it does not merely return null, it throws
            # "Could not find member", which is what killed the last run.
            $seen = 0
            while ($sel.Next()) {
                $seen++
                $rowRef = $sel.Get(0)
                $n = ""
                if ($v.hasNumber) {
                    try { $n = ([string]$sel.Get(1)).Trim() } catch { $n = "" }
                }
                if ($seen -eq 1) { $firstRef = $rowRef; $firstNum = $n }
                if ($n -ne "" -and ($n -eq $Number -or $n.TrimStart('0') -eq $Number.TrimStart('0'))) {
                    $ref = $rowRef
                    $firstNum = $n
                    break
                }
            }
            if ($null -eq $ref -and $null -ne $firstRef) { $ref = $firstRef }

            if ($null -ne $ref) {
                Write-Host ("  OK via {0} -- scanned {1}, using sheet '{2}'." -f $v.label, $seen, $(if ($firstNum) { $firstNum } else { $Number }))
                Write-Host ""

                # Do the work HERE, inside the live connection. The previous run
                # found the sheet and then died on GetObject(): a reference is
                # only valid while the connection that produced it is alive, and
                # the finally block had already released it.
                Report-Structure $h.ib $ref

                $handle = $h
                $h = $null
                break
            }
            Write-Host ("  {0}: ran but returned no rows." -f $v.label)
        }
        catch {
            Write-Host ("  {0}: FAILED -- {1}" -f $v.label, $_.Exception.Message.Split("`n")[0])
        }
        finally {
            if ($h) { Close-Ib $h }
        }
    }

    if ($null -eq $ref) { throw "Every query variant failed -- see the lines above." }

    $ib = $handle.ib
    $connector = $handle.conn

    Write-Host "Next: put the section name and its attribute names into the"
    Write-Host "route_sheet query in queries.json, so the exchange carries stops."
}
catch {
    Write-Host ("FAILED: " + $_.Exception.Message)
    Write-Host ("  at line: " + $_.InvocationInfo.ScriptLineNumber)
    Write-Host ("  code   : " + $_.InvocationInfo.Line.Trim())
    Write-Host ""
    Write-Host "If this failed on Metadata()/TabularSections, say so -- the"
    Write-Host "fallback is to read the print form's data source instead."
}
finally {
    if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
    if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
    [GC]::Collect()
}
