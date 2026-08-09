# Budvik 1C extractor -- READ-ONLY.
#
# Reads catalogs, prices and stock from 1C 8.2 (УТ 2.3) over COM and writes
# newline-delimited JSON files. Sending to the site is a separate step, so a
# failed upload never means re-reading 20k rows.
#
# Why this file is pure ASCII: Windows PowerShell 5 decodes .ps1 with the OEM
# codepage, which mangles Cyrillic literals and breaks the parser. Query texts
# therefore live in queries.json, read explicitly as UTF-8.
#
# Must run in 32-bit PowerShell -- the 8.2 COM connector is 32-bit:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f extract.ps1
#
# Field access uses $row.Get(index) throughout: named access to query columns
# returns null on this build.

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $OutDir,
    [switch] $Quiet
)

$ErrorActionPreference = "Stop"

# $PSScriptRoot is empty when the script is launched from a UNC path on
# PowerShell 5, so derive the script directory from the invocation instead.
$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir "config.json" }
if (-not $OutDir)     { $OutDir     = Join-Path $scriptDir "out" }

# ---------------------------------------------------------------- helpers ---

function Log($msg) {
    if (-not $Quiet) {
        Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
    }
}

function ReadJsonUtf8($path) {
    if (-not (Test-Path $path)) { throw "File not found: $path" }
    $text = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    return $text | ConvertFrom-Json
}

<#
  1C returns Ref values as COM objects. XMLString() yields the GUID; empty
  refs come back as all-zeros, which we normalise to $null so the ingest
  contract's "field absent" semantics hold.
#>
function RefId($ib, $value) {
    if ($null -eq $value) { return $null }
    try {
        $s = $ib.XMLString($value)
        if ([string]::IsNullOrWhiteSpace($s)) { return $null }
        if ($s -eq "00000000-0000-0000-0000-000000000000") { return $null }
        return $s
    } catch {
        return $null
    }
}

function Str($value) {
    if ($null -eq $value) { return "" }
    return ([string]$value).Trim()
}

function Num($value) {
    if ($null -eq $value) { return 0 }
    try { return [double]$value } catch { return 0 }
}

# Streams records as NDJSON: one JSON object per line. Keeps memory flat on
# 20k+ row catalogs and lets the sender chunk without re-parsing everything.
function NewWriter($path) {
    $dir = Split-Path $path -Parent
    if (-not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    return New-Object IO.StreamWriter($path, $false, (New-Object Text.UTF8Encoding($false)))
}

function WriteRecord($writer, $obj) {
    $writer.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
}

# ----------------------------------------------------------------- config ---

$config  = ReadJsonUtf8 $ConfigPath
$queries = ReadJsonUtf8 (Join-Path $scriptDir "queries.json")

$connString = 'Srvr="' + $config.oneC.server + '";Ref="' + $config.oneC.base +
              '";Usr="' + $config.oneC.user + '";Pwd="' + $config.oneC.password + '";'

if (-not (Test-Path $OutDir)) { [void](New-Item -ItemType Directory -Path $OutDir -Force) }

$stats = [ordered]@{}

# ------------------------------------------------------------------- run ----

Log "extract.ps1 v1.8"
Log "connecting to 1C..."
$connector = New-Object -ComObject V82.COMConnector
$ib = $connector.Connect($connString)
Log "connected"

# Each COM step is checked separately: a bare "you cannot call a method on a
# null-valued expression" gives no clue which of NewObject/Execute/Choose
# returned nothing.
function RunQuery($text) {
    $q = $ib.NewObject("Query")
    if ($null -eq $q) { throw "NewObject(Query) returned null" }
    $q.Text = [string]$text
    $res = $q.Execute()
    if ($null -eq $res) { throw ("Execute() returned null for: " + $text.Substring(0, [Math]::Min(80, $text.Length))) }
    $sel = $res.Choose()
    if ($null -eq $sel) { throw "Choose() returned null" }
    return $sel
}

try {
    # --- categories (product groups) ---
    if ($config.scope.categories) {
        Log "reading categories..."
        $w = NewWriter (Join-Path $OutDir "category.ndjson")
        $n = 0
        $r = RunQuery $queries.categories
        while ($r.Next()) {
            $id = RefId $ib $r.Get(0)
            if (-not $id) { continue }
            $rec = [ordered]@{ externalId = $id; name = Str $r.Get(1) }
            $parent = RefId $ib $r.Get(2)
            if ($parent) { $rec.parentExternalId = $parent }
            if ($r.Get(3)) { $rec.deleted = $true }
            WriteRecord $w $rec
            $n++
        }
        $w.Close()
        $stats.categories = $n
        Log "categories: $n"
    }

    # --- products ---
    if ($config.scope.products) {
        Log "reading products..."
        $w = NewWriter (Join-Path $OutDir "product.ndjson")
        $n = 0
        $r = RunQuery $queries.products
        while ($r.Next()) {
            $id = RefId $ib $r.Get(0)
            if (-not $id) { continue }
            $rec = [ordered]@{ externalId = $id; name = Str $r.Get(1) }
            $sku = Str $r.Get(2)
            if ($sku) { $rec.sku = $sku }
            $cat = RefId $ib $r.Get(3)
            if ($cat) { $rec.categoryExternalId = $cat }
            $unit = Str $r.Get(4)
            if ($unit) { $rec.unit = $unit }
            if ($r.Get(5)) { $rec.deleted = $true }
            WriteRecord $w $rec
            $n++
        }
        $w.Close()
        $stats.products = $n
        Log "products: $n"
    }

    # --- prices: retail price type, converted to UAH ---
    #
    # Prices in this base are stored per-row in mixed currencies (USD, UAH,
    # EUR, PLN), so each row is multiplied by its own rate. Rates are read
    # into a hashtable first: joining the two registers inside a single 1C
    # query proved unstable on this 8.2 build.
    if ($config.scope.prices) {
        Log "reading rates..."
        $rates = @{}
        $r = RunQuery $queries.rates
        while ($r.Next()) {
            $code = Str $r.Get(0)
            if (-not $code) { continue }
            $rate = Num $r.Get(1)
            $mult = Num $r.Get(2)
            if ($mult -le 0) { $mult = 1 }
            if ($rate -le 0) { continue }
            $rates[$code] = $rate / $mult
        }
        Log ("rates: " + $rates.Count)

        # Inlined (not via RunQueryP) with a log per step: this exact spot
        # failed four times with a bare null error, and every value that
        # crosses into COM is cast to [string] -- JSON-sourced strings arrive
        # PSObject-wrapped and can marshal wrong through IDispatch.
        Log "resolving price type..."
        $q = $ib.NewObject("Query")
        Log ("  query object: " + ($null -ne $q))
        $q.Text = [string]$queries.priceTypeByName
        Log "  text set"
        $q.SetParameter([string]$queries.paramName, [string]$config.priceTypes.retail)
        Log "  parameter set"
        $rs = $q.Execute()
        Log ("  executed: " + ($null -ne $rs))
        if ($null -eq $rs) { throw "Execute() returned null on price type lookup" }
        $sel = $rs.Choose()
        Log ("  selection: " + ($null -ne $sel))
        if ($null -eq $sel) { throw "Choose() returned null on price type lookup" }
        if (-not $sel.Next()) {
            # Naming in 1C mixes Ukrainian and Russian glyphs that look
            # identical (И/І), so an exact-match miss needs the real list
            # printed rather than a bare "not found".
            $names = New-Object Collections.Generic.List[string]
            $list = RunQuery $queries.priceTypeList
            while ($list.Next()) { $names.Add((Str $list.Get(0))) }
            Log ("price types in base: " + ($names -join " | "))
            throw ("price type not found: '" + $config.priceTypes.retail + "'")
        }
        $priceTypeRef = $sel.Get(0)
        if ($null -eq $priceTypeRef) { throw "price type ref is null" }

        Log "reading prices..."

        $w = NewWriter (Join-Path $OutDir "price.ndjson")
        $n = 0
        $noRate = 0
        # Inline, not a helper: a parameterised query built inside a function
        # comes back null on this build; the identical inline sequence works.
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queries.pricesRetail
        $q.SetParameter([string]$queries.paramPriceType, $priceTypeRef)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute() returned null on prices query" }
        $r = $rs.Choose()
        if ($null -eq $r) { throw "Choose() returned null on prices query" }
        while ($r.Next()) {
            $id = RefId $ib $r.Get(0)
            if (-not $id) { continue }
            $value = Num $r.Get(1)
            if ($value -le 0) { continue }

            # An unknown or EMPTY currency code means we cannot trust the
            # figure: this base has 335 price rows in a currency whose code
            # is blank (EUR entered without a code), and shipping those
            # unconverted would put them on the site ~52x too cheap.
            $code = Str $r.Get(2)
            if ($code -eq [string]$config.baseCurrencyCode) {
                $rate = 1
            } elseif ($code -and $rates.ContainsKey($code)) {
                $rate = $rates[$code]
            } else {
                $noRate++
                continue
            }

            WriteRecord $w ([ordered]@{
                externalId = $id
                retail     = [math]::Round($value * $rate, 2)
            })
            $n++
        }
        $w.Close()
        $stats.prices = $n
        if ($noRate -gt 0) {
            $stats.pricesSkippedNoRate = $noRate
            Log "prices: $n  (skipped $noRate with unknown currency)"
        } else {
            Log "prices: $n"
        }
    }

    # --- warehouses ---
    if ($config.scope.warehouses) {
        Log "reading warehouses..."
        $w = NewWriter (Join-Path $OutDir "warehouse.ndjson")
        $n = 0
        $r = RunQuery $queries.warehouses
        while ($r.Next()) {
            $id = RefId $ib $r.Get(0)
            if (-not $id) { continue }
            WriteRecord $w ([ordered]@{ externalId = $id; name = Str $r.Get(1) })
            $n++
        }
        $w.Close()
        $stats.warehouses = $n
        Log "warehouses: $n"
    }

    # --- stock balances, per warehouse ---
    if ($config.scope.stock) {
        Log "reading stock..."
        $w = NewWriter (Join-Path $OutDir "stock.ndjson")
        $n = 0
        $r = RunQuery $queries.stock
        while ($r.Next()) {
            $product = RefId $ib $r.Get(0)
            $wh      = RefId $ib $r.Get(1)
            if (-not $product -or -not $wh) { continue }
            WriteRecord $w ([ordered]@{
                externalId          = $product
                warehouseExternalId = $wh
                quantity            = Num $r.Get(2)
            })
            $n++
        }
        $w.Close()
        $stats.stock = $n
        Log "stock: $n"
    }

    # Manifest doubles as the success marker: the sender refuses to run
    # without it, so a crashed extract can never be shipped as complete.
    $manifest = [ordered]@{
        extractedAt = (Get-Date).ToString("o")
        server      = $config.oneC.server
        base        = $config.oneC.base
        priceType   = $config.priceTypes.retail
        counts      = $stats
    }
    $manifestPath = Join-Path $OutDir "manifest.json"
    [IO.File]::WriteAllText(
        $manifestPath,
        ($manifest | ConvertTo-Json -Depth 5),
        (New-Object Text.UTF8Encoding($false))
    )

    Log "extract complete"
    $manifest | ConvertTo-Json -Depth 5
}
catch {
    # Print the exact failing line: the console error record from -File hides
    # the position inside functions.
    Log ("ERROR: " + $_.Exception.Message)
    Log ("AT:    " + $_.InvocationInfo.PositionMessage)
    Log ("STACK: " + $_.ScriptStackTrace)
    throw
}
finally {
    # Release the COM connection explicitly; the 1C server keeps the session
    # alive otherwise and licences leak on repeated scheduled runs.
    if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
    if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
    [GC]::Collect()
}
