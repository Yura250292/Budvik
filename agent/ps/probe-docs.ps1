# Probe #2: document/counterparty field names for stage 2 (orders -> CRM).
#
# READ ONLY. Runs a series of tiny "TOP 1" queries in try/catch and reports
# which field names exist, so the production queries can be written against
# this exact configuration instead of guessed from the UT 2.3 manual.
#
# Run in 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f probe-docs.ps1
#
# ASCII-only source: Windows PowerShell 5 decodes .ps1 with the OEM codepage
# and mangles Cyrillic literals, so every Cyrillic string is built from
# [char] codes at runtime.

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$configPath = Join-Path $scriptDir "config.json"
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json

# Cyrillic helper: C 'text' spells a string from its Unicode code points.
function C([int[]] $codes) { -join ($codes | ForEach-Object { [char]$_ }) }

$SELECT   = C 0x412,0x42B,0x411,0x420,0x410,0x422,0x42C            # VYBRAT
$TOP1     = C 0x41F,0x415,0x420,0x412,0x42B,0x415,0x20,0x31        # PERVYE 1
$FROM     = C 0x418,0x417                                          # IZ
$DOC      = C 0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442      # Dokument
$CAT      = C 0x421,0x43F,0x440,0x430,0x432,0x43E,0x447,0x43D,0x438,0x43A  # Spravochnik
$REGACC   = C 0x420,0x435,0x433,0x438,0x441,0x442,0x440,0x41D,0x430,0x43A,0x43E,0x43F,0x43B,0x435,0x43D,0x438,0x44F  # RegistrNakopleniya

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    $config.oneC.server, $config.oneC.base, $config.oneC.user, $config.oneC.password
$ib = $conn.Connect($cs)
Write-Host "CONNECTED"
Write-Host ""

# Each probe is its own query: one missing field must not hide the fields
# after it.
function Probe($label, $queryText) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queryText
        $rs = $q.Execute()
        if ($null -eq $rs) { Write-Host ("  -- {0}: Execute returned null" -f $label); return }
        $r = $rs.Choose()
        $n = 0
        $sample = ""
        while ($r.Next()) {
            $n++
            if ($n -eq 1) {
                $v = $r.Get(0)
                if ($null -ne $v) { $sample = [string]$v }
            }
        }
        Write-Host ("  OK {0,-28} rows={1} first={2}" -f $label, $n, $sample)
    }
    catch {
        Write-Host ("  -- {0,-28} {1}" -f $label, $_.Exception.Message)
    }
}

# --- Counterparties -------------------------------------------------------
$KONTRAGENTY = C 0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442,0x44B
$NAIM   = C 0x41D,0x430,0x438,0x43C,0x435,0x43D,0x43E,0x432,0x430,0x43D,0x438,0x435
$KOD    = C 0x41A,0x43E,0x434
$EDRPOU = C 0x41A,0x43E,0x434,0x41F,0x43E,0x415,0x414,0x420,0x41F,0x41E,0x423   # KodPoEDRPOU
$PURCH  = C 0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x44C         # Pokupatel

Write-Host "-- counterparties"
Probe "cp_basic"    "$SELECT $TOP1 $NAIM $FROM $CAT.$KONTRAGENTY"
Probe "cp_code"     "$SELECT $TOP1 $KOD $FROM $CAT.$KONTRAGENTY"
Probe "cp_edrpou"   "$SELECT $TOP1 $EDRPOU $FROM $CAT.$KONTRAGENTY"
Probe "cp_buyer"    "$SELECT $TOP1 $PURCH $FROM $CAT.$KONTRAGENTY"
Write-Host ""

# --- Customer order header ------------------------------------------------
$ZAKAZ  = C 0x417,0x430,0x43A,0x430,0x437,0x41F,0x43E,0x43A,0x443,0x43F,0x430,0x442,0x435,0x43B,0x44F  # ZakazPokupatelya
$NOMER  = C 0x41D,0x43E,0x43C,0x435,0x440
$DATA   = C 0x414,0x430,0x442,0x430
$KONTR  = C 0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442
$SUMMA  = C 0x421,0x443,0x43C,0x43C,0x430,0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442,0x430  # SummaDokumenta
$PROVED = C 0x41F,0x440,0x43E,0x432,0x435,0x434,0x435,0x43D                      # Proveden
$SKLAD  = C 0x421,0x43A,0x43B,0x430,0x434
$VALUTA = C 0x412,0x430,0x43B,0x44E,0x442,0x430,0x414,0x43E,0x43A,0x443,0x43C,0x435,0x43D,0x442,0x430  # ValyutaDokumenta
$MENED  = C 0x41C,0x435,0x43D,0x435,0x434,0x436,0x435,0x440
$OTVET  = C 0x41E,0x442,0x432,0x435,0x442,0x441,0x442,0x432,0x435,0x43D,0x43D,0x44B,0x439  # Otvetstvennyy
$SOSTOY = C 0x421,0x43E,0x441,0x442,0x43E,0x44F,0x43D,0x438,0x435                # Sostoyanie
$DOGOV  = C 0x414,0x43E,0x433,0x43E,0x432,0x43E,0x440,0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442,0x430

Write-Host "-- customer order header"
Probe "ord_number"    "$SELECT $TOP1 $NOMER $FROM $DOC.$ZAKAZ"
Probe "ord_date"      "$SELECT $TOP1 $DATA $FROM $DOC.$ZAKAZ"
Probe "ord_cp"        "$SELECT $TOP1 $KONTR $FROM $DOC.$ZAKAZ"
Probe "ord_sum"       "$SELECT $TOP1 $SUMMA $FROM $DOC.$ZAKAZ"
Probe "ord_posted"    "$SELECT $TOP1 $PROVED $FROM $DOC.$ZAKAZ"
Probe "ord_warehouse" "$SELECT $TOP1 $SKLAD $FROM $DOC.$ZAKAZ"
Probe "ord_currency"  "$SELECT $TOP1 $VALUTA $FROM $DOC.$ZAKAZ"
Probe "ord_manager"   "$SELECT $TOP1 $MENED $FROM $DOC.$ZAKAZ"
Probe "ord_responsib" "$SELECT $TOP1 $OTVET $FROM $DOC.$ZAKAZ"
Probe "ord_state"     "$SELECT $TOP1 $SOSTOY $FROM $DOC.$ZAKAZ"
Probe "ord_contract"  "$SELECT $TOP1 $DOGOV $FROM $DOC.$ZAKAZ"
Write-Host ""

# --- Customer order line items -------------------------------------------
$TOVARY = C 0x422,0x43E,0x432,0x430,0x440,0x44B
$NOMENK = C 0x41D,0x43E,0x43C,0x435,0x43D,0x43A,0x43B,0x430,0x442,0x443,0x440,0x430
$KOLVO  = C 0x41A,0x43E,0x43B,0x438,0x447,0x435,0x441,0x442,0x432,0x43E
$CENA   = C 0x426,0x435,0x43D,0x430
$SUM    = C 0x421,0x443,0x43C,0x43C,0x430

Write-Host "-- order line items"
Probe "line_item"  "$SELECT $TOP1 $NOMENK $FROM $DOC.$ZAKAZ.$TOVARY"
Probe "line_qty"   "$SELECT $TOP1 $KOLVO $FROM $DOC.$ZAKAZ.$TOVARY"
Probe "line_price" "$SELECT $TOP1 $CENA $FROM $DOC.$ZAKAZ.$TOVARY"
Probe "line_sum"   "$SELECT $TOP1 $SUM $FROM $DOC.$ZAKAZ.$TOVARY"
Write-Host ""

# --- Sales document -------------------------------------------------------
$REALIZ = C 0x420,0x435,0x430,0x43B,0x438,0x437,0x430,0x446,0x438,0x44F,0x422,0x43E,0x432,0x430,0x440,0x43E,0x432,0x423,0x441,0x43B,0x443,0x433
$SDELKA = C 0x421,0x434,0x435,0x43B,0x43A,0x430

Write-Host "-- sales document"
Probe "sale_number" "$SELECT $TOP1 $NOMER $FROM $DOC.$REALIZ"
Probe "sale_cp"     "$SELECT $TOP1 $KONTR $FROM $DOC.$REALIZ"
Probe "sale_sum"    "$SELECT $TOP1 $SUMMA $FROM $DOC.$REALIZ"
Probe "sale_deal"   "$SELECT $TOP1 $SDELKA $FROM $DOC.$REALIZ"
Probe "sale_items"  "$SELECT $TOP1 $NOMENK $FROM $DOC.$REALIZ.$TOVARY"
Write-Host ""

# --- Debt: mutual settlements register ------------------------------------
# The debt a customer owes is a register balance, not a document, so the
# register name matters more than any single field here.
$VZAIMO = C 0x412,0x437,0x430,0x438,0x43C,0x43E,0x440,0x430,0x441,0x447,0x435,0x442,0x44B,0x421,0x41A,0x43E,0x43D,0x442,0x440,0x430,0x433,0x435,0x43D,0x442,0x430,0x43C,0x438  # VzaimoraschetySKontragentami
$OSTATKI = C 0x41E,0x441,0x442,0x430,0x442,0x43A,0x438
$SUMOST = C 0x421,0x443,0x43C,0x43C,0x430,0x412,0x437,0x430,0x438,0x43C,0x43E,0x440,0x430,0x441,0x447,0x435,0x442,0x43E,0x432,0x41E,0x441,0x442,0x430,0x442,0x43E,0x43A  # SummaVzaimoraschetovOstatok

Write-Host "-- debt (mutual settlements)"
Probe "debt_register" "$SELECT $TOP1 $KONTR $FROM $REGACC.$VZAIMO.$OSTATKI"
Probe "debt_amount"   "$SELECT $TOP1 $SUMOST $FROM $REGACC.$VZAIMO.$OSTATKI"
Write-Host ""

Write-Host "DONE"
