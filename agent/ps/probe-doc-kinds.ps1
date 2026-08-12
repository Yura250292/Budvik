# Which document kinds exist -- using only what this build actually supports.
#
# Established by the previous probes, so none of it is guesswork any more:
#   - every query shape works, including Registrator from the movement table;
#   - XMLTypeOf(), Metadata() and ToString() all come back empty on a reference;
#   - XMLString() DOES work -- it returned 1fc3d3d4-35d8-11ed-9a1e-f079596e5c94;
#   - TIPZNCH() does not exist in the 8.2 query language (it belongs to the
#     built-in language), so every query using it failed outright.
#
# What remains is the SSYLKA operator: "GDE R.Registrator SSYLKA Dokument.X"
# filters rows to one document type. It cannot list types, but it can TEST for
# one -- so the sweep becomes: for each candidate name, ask whether the register
# contains any rows written by that document. A name that does not exist makes
# the query fail; a name that exists but never posted returns zero rows. Those
# two outcomes are distinguishable, which is exactly what we need.
#
# This also widens the net: the route sheet does not have to be a Document at
# all. Section 3 asks the counterparty catalogue's delivery-related attributes,
# in case routes live there.
#
# READ-ONLY. 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-doc-kinds.ps1 -ConfigPath C:\Users\fedyshyn\budvik-agent\config.json > \\tsclient\Downloads\out-doc-kinds.txt 2>&1

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

$SELECT = C 1042,1067,1041,1056,1040,1058,1068                     # VYBRAT
$FIRST  = C 1055,1045,1056,1042,1067,1045                          # PERVYE
$FROM   = C 1048,1047                                              # IZ
$AS     = C 1050,1040,1050                                         # KAK
$WHERE  = C 1043,1044,1045                                         # GDE
$REFOP  = C 1057,1057,1067,1051,1050,1040                          # SSYLKA (operator)
$DOC    = C 1044,1086,1082,1091,1084,1077,1085,1090                # Dokument
$CAT    = C 1057,1087,1088,1072,1074,1086,1095,1085,1080,1082      # Spravochnik
$REG    = C 1056,1077,1075,1080,1089,1090,1088,1053,1072,1082,1086,1087,1083,1077,1085,1080,1103  # RegistrNakopleniya
$REGISTRAR = C 1056,1077,1075,1080,1089,1090,1088,1072,1090,1086,1088  # Registrator
$REF    = C 1057,1089,1099,1083,1082,1072                          # Ssylka
$DATE   = C 1044,1072,1090,1072                                    # Data
$NUM    = C 1053,1086,1084,1077,1088                               # Nomer
$NAME   = C 1053,1072,1080,1084,1077,1085,1086,1074,1072,1085,1080,1077  # Naimenovanie
$PERIOD = C 1055,1077,1088,1080,1086,1076                          # Period

$TOVSKLAD = C 1058,1086,1074,1072,1088,1099,1053,1072,1057,1082,1083,1072,1076,1072,1093  # TovaryNaSkladah

# --- 1. Wider document-name sweep -------------------------------------------
#
# The first sweep tried 30 names against Dokument.<Name> directly. That method
# is proven sound (known documents are found, fake ones throw), so this simply
# extends the list with wordings not tried before -- warehouse-, expedition- and
# order-flavoured names, plus abbreviations.

Write-Host "=== 1. More document names ==="

$more = @(
    @{ l = "Otgruzka";              n = (C 1054,1090,1075,1088,1091,1079,1082,1072) },
    @{ l = "OtgruzkaTovarov";       n = (C 1054,1090,1075,1088,1091,1079,1082,1072,1058,1086,1074,1072,1088,1086,1074) },
    @{ l = "Ekspediciya";           n = (C 1069,1082,1089,1087,1077,1076,1080,1094,1080,1103) },
    @{ l = "Razvozka";              n = (C 1056,1072,1079,1074,1086,1079,1082,1072) },
    @{ l = "Razvoz";                n = (C 1056,1072,1079,1074,1086,1079) },
    @{ l = "Logistika";             n = (C 1051,1086,1075,1080,1089,1090,1080,1082,1072) },
    @{ l = "ZadanieNaOtgruzku";     n = (C 1047,1072,1076,1072,1085,1080,1077,1053,1072,1054,1090,1075,1088,1091,1079,1082,1091) },
    @{ l = "ListDostavki";          n = (C 1051,1080,1089,1090,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "NakladnayaNaDostavku";  n = (C 1053,1072,1082,1083,1072,1076,1085,1072,1103,1053,1072,1044,1086,1089,1090,1072,1074,1082,1091) },
    @{ l = "SborniyZakaz";          n = (C 1057,1073,1086,1088,1085,1099,1081,1047,1072,1082,1072,1079) },
    @{ l = "GruppaDostavki";        n = (C 1043,1088,1091,1087,1087,1072,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "PlanDostavki";          n = (C 1055,1083,1072,1085,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "PlanRazvozki";          n = (C 1055,1083,1072,1085,1056,1072,1079,1074,1086,1079,1082,1080) },
    @{ l = "VedomostDostavki";      n = (C 1042,1077,1076,1086,1084,1086,1089,1090,1100,1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "ML";                    n = (C 1052,1051) },
    @{ l = "PL";                    n = (C 1055,1051) },
    @{ l = "Dostavki";              n = (C 1044,1086,1089,1090,1072,1074,1082,1080) },
    @{ l = "VydachaTovara";         n = (C 1042,1099,1076,1072,1095,1072,1058,1086,1074,1072,1088,1072) },
    @{ l = "PeremeschenieTovarov";  n = (C 1055,1077,1088,1077,1084,1077,1097,1077,1085,1080,1077,1058,1086,1074,1072,1088,1086,1074) },
    @{ l = "TransportnayaNakladnaya"; n = (C 1058,1088,1072,1085,1089,1087,1086,1088,1090,1085,1072,1103,1053,1072,1082,1083,1072,1076,1085,1072,1103) }
)

$foundDocs = @()

foreach ($d in $more) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 1 R.$REF, R.$DATE $FROM $DOC.$($d.n) $AS R"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $has = $r.Next()
        $when = ""
        if ($has) { try { $when = ([string]$r.Get(1)).Trim() } catch { } }
        Write-Host ("  FOUND   Dokument.{0,-26} {1}" -f $d.l,
            $(if ($has) { "has rows, e.g. $when" } else { "EMPTY" }))
        $foundDocs += $d.l
    }
    catch { }
}

if ($foundDocs.Count -eq 0) { Write-Host "  (none of these exists either)" }
Write-Host ""

# --- 2. SSYLKA test against the register ------------------------------------
#
# For the documents we know exist, confirm the operator works -- then the same
# shape can test any candidate. This is the method that would have let the
# earlier sweep succeed, had TIPZNCH not been a dead end.

Write-Host "=== 2. SSYLKA operator: does it work here? ==="

$ZAKAZ  = C 1047,1072,1082,1072,1079,1055,1086,1082,1091,1087,1072,1090,1077,1083,1103  # ZakazPokupatelya
$REALIZ = C 1056,1077,1072,1083,1080,1079,1072,1094,1080,1103,1058,1086,1074,1072,1088,1086,1074,1059,1089,1083,1091,1075  # RealizaciyaTovarovUslug

foreach ($t in @(
    @{ l = "ZakazPokupatelya";        n = $ZAKAZ },
    @{ l = "RealizaciyaTovarovUslug"; n = $REALIZ }
)) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 3 T.$PERIOD $FROM $REG.$TOVSKLAD $AS T" +
                  " $WHERE T.$REGISTRAR $REFOP $DOC.$($t.n)"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $n = 0
        while ($r.Next()) { $n++ }
        Write-Host ("  {0,-26} {1} rows in TovaryNaSkladah" -f $t.l, $n)
    }
    catch {
        Write-Host ("  {0,-26} FAILED: {1}" -f $t.l, $_.Exception.Message.Split("`n")[0])
    }
}
Write-Host ""

# --- 3. Delivery-related catalogues, retried one attribute at a time --------
#
# The earlier catalogue sweep printed nothing at all, which given everything
# since is more likely to have been the same silent-failure bug than a genuine
# absence. Retried here with the error printed.

Write-Host "=== 3. Catalogues, with errors shown ==="

$cats = @(
    @{ l = "Voditeli";      n = (C 1042,1086,1076,1080,1090,1077,1083,1080) },
    @{ l = "Avtomobili";    n = (C 1040,1074,1090,1086,1084,1086,1073,1080,1083,1080) },
    @{ l = "Marshruty";     n = (C 1052,1072,1088,1096,1088,1091,1090,1099) },
    @{ l = "FizicheskieLica"; n = (C 1060,1080,1079,1080,1095,1077,1089,1082,1080,1077,1051,1080,1094,1072) },
    @{ l = "Sotrudniki";    n = (C 1057,1086,1090,1088,1091,1076,1085,1080,1082,1080) },
    @{ l = "Polzovateli";   n = (C 1055,1086,1083,1100,1079,1086,1074,1072,1090,1077,1083,1080) }
)

foreach ($c in $cats) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = "$SELECT $FIRST 8 S.$REF, S.$NAME $FROM $CAT.$($c.n) $AS S"
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "null" }
        $r = $rs.Choose()
        $names = @()
        while ($r.Next()) {
            $v = ""
            try { $v = ([string]$r.Get(1)).Trim() } catch { }
            if ($v) { $names += $v }
        }
        Write-Host ("  FOUND   Spravochnik.{0,-18} {1}" -f $c.l,
            $(if ($names.Count) { ($names -join " | ") } else { "(no rows)" }))
    }
    catch {
        Write-Host ("  absent  Spravochnik.{0,-18} {1}" -f $c.l, $_.Exception.Message.Split("`n")[0])
    }
}
Write-Host ""

Write-Host "=== Verdict ==="
Write-Host "If section 1 found a document, that is very likely the route sheet."
Write-Host "If section 3 lists Voditeli or Avtomobili, driver data lives in 1C even"
Write-Host "  if the route sheet document does not -- say which, and we plan from there."
Write-Host "If everything is still empty, the route sheet is not in this database and"
Write-Host "  mileage/points must be entered another way (Telegram bot, like reps)."

if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
[GC]::Collect()
