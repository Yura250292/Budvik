# Probe: are Artikul / Kod filled in the Nomenklatura catalogue?
#
# READ ONLY. One SELECT-style query, nothing in 1C is modified.
#
# Why: 11 091 products on the site carry a placeholder SKU ("1C-XXXXXXXX")
# instead of a real article number. Reps come from Impuls, where everything
# is searched by article, so those products are unfindable. The site-side
# bug that discarded incoming articles is fixed; this answers whether 1C
# actually holds the articles.
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-artikul.ps1
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1.

$ErrorActionPreference = "Stop"

$d = $PSScriptRoot
if (-not $d) { $d = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $d) { $d = (Get-Location).Path }
$cfg = [IO.File]::ReadAllText((Join-Path $d "config.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json

function C([int[]] $x) { -join ($x | ForEach-Object { [char]$_ }) }

$SEL   = C 0x412,0x42B,0x411,0x420,0x410,0x422,0x42C
$FROM  = C 0x418,0x417
$WHERE = C 0x413,0x414,0x415
$NOT   = C 0x41D,0x415
$AND   = C 0x418
$CAT   = C 0x421,0x43F,0x440,0x430,0x432,0x43E,0x447,0x43D,0x438,0x43A
$NOM   = C 0x41D,0x43E,0x43C,0x435,0x43D,0x43A,0x43B,0x430,0x442,0x443,0x440,0x430
$ART   = C 0x410,0x440,0x442,0x438,0x43A,0x443,0x43B
$KOD   = C 0x41A,0x43E,0x434
$NAIM  = C 0x41D,0x430,0x438,0x43C,0x435,0x43D,0x43E,0x432,0x430,0x43D,0x438,0x435
$GRP   = C 0x42D,0x442,0x43E,0x413,0x440,0x443,0x43F,0x43F,0x430
$DEL   = C 0x41F,0x43E,0x43C,0x435,0x442,0x43A,0x430,0x423,0x434,0x430,0x43B,0x435,0x43D,0x438,0x44F

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    $cfg.oneC.server, $cfg.oneC.base, $cfg.oneC.user, $cfg.oneC.password
$ib = $conn.Connect($cs)
Write-Host "CONNECTED"

# VYBRAT Artikul, Kod, Naimenovanie IZ Spravochnik.Nomenklatura
# GDE NE EtoGruppa I NE PometkaUdaleniya
$text = "{0} {1}, {2}, {3} {4} {5}.{6} {7} {8} {9} {10} {11} {12}" -f `
    $SEL, $ART, $KOD, $NAIM, $FROM, $CAT, $NOM, $WHERE, $NOT, $GRP, $AND, $NOT, $DEL

$q = $ib.NewObject("Query")
$q.Text = [string]$text
$r = $q.Execute().Choose()

function S($v) {
    if ($null -eq $v) { return "" }
    $s = [string]$v
    if ($s -eq "System.__ComObject") { return "" }
    return $s.Trim()
}

$total = 0; $wArt = 0; $wKod = 0; $none = 0
$sArt = @(); $sKod = @(); $sNone = @()

while ($r.Next()) {
    $total++
    $a = S $r.Get(0); $k = S $r.Get(1); $n = S $r.Get(2)
    if ($n.Length -gt 52) { $n = $n.Substring(0, 52) }

    if ($a -ne "") {
        $wArt++
        if ($sArt.Count -lt 12) { $sArt += ("    Artikul=[{0}] Kod=[{1}] {2}" -f $a, $k, $n) }
    } elseif ($k -ne "") {
        $wKod++
        if ($sKod.Count -lt 12) { $sKod += ("    Artikul=<empty> Kod=[{0}] {1}" -f $k, $n) }
    } else {
        $none++
        if ($sNone.Count -lt 12) { $sNone += ("    both empty: {0}" -f $n) }
    }
}

function P($n) { if ($total -eq 0) { "0%" } else { "{0:N1}%" -f ($n / $total * 100) } }

Write-Host ""
Write-Host ("=== Nomenklatura, goods only (no folders, no deleted): {0}" -f $total)
Write-Host ("    has Artikul:         {0}  ({1})" -f $wArt, (P $wArt))
Write-Host ("    no Artikul, has Kod: {0}  ({1})" -f $wKod, (P $wKod))
Write-Host ("    both empty:          {0}  ({1})" -f $none, (P $none))

if ($sArt.Count)  { Write-Host ""; Write-Host "  samples WITH Artikul:"; $sArt  | % { Write-Host $_ } }
if ($sKod.Count)  { Write-Host ""; Write-Host "  samples with Kod only:"; $sKod | % { Write-Host $_ } }
if ($sNone.Count) { Write-Host ""; Write-Host "  samples with NEITHER:"; $sNone | % { Write-Host $_ } }

Write-Host ""
if (($wArt + $wKod) -gt 0) {
    Write-Host "RESULT: articles EXIST in 1C - the fixed sync will pull them in."
} else {
    Write-Host "RESULT: 1C has none either - they must come from Impuls."
}
Write-Host "DONE (read-only)"
