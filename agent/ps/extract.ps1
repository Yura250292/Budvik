# Budvik 1C extractor -- READ-ONLY.
#
# Reads catalogs, prices and stock from 1C 8.2 (UT 2.3) over COM and writes
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

# Scopes, cheapest first:
#   light   -- prices and stock only, and only for positions that moved since
#              the last successful run. The 5-minute cycle.
#   hourly  -- light plus the full catalogs (products, categories, warehouses).
#   full    -- everything, ignoring the incremental watermark. Nightly; also
#              the only scope that can carry a full snapshot for reconciliation.
#
# Why light is not simply "read the change register": the site needs the
# CURRENT balance, not the delta, so the register tells us WHICH positions
# moved and a second query fetches their present totals.

[CmdletBinding()]
param(
    [ValidateSet("light", "hourly", "full")]
    [string] $Scope = "full",
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

<#
  ISO 8601 with offset, as the contract requires.

  Formatted explicitly rather than via ToString("o"): the server parses these
  and a locale-dependent format on a Ukrainian Windows would arrive as
  dd.MM.yyyy and be silently misread.
#>
function IsoDate($value) {
    if ($null -eq $value) { return $null }
    try { return ([datetime]$value).ToString("yyyy-MM-ddTHH:mm:ssK") } catch { return $null }
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

<#
  One stock line. "available" is clamped at zero: 1C can report a reserve
  larger than the balance (goods promised before they arrive), and a negative
  availability would read as a quantity rather than as "none to sell".
  The unclamped shortfall stays visible as quantity vs reserved.
#>
function StockRecord($productId, $warehouseId, $qty, $res) {
    $free = $qty - $res
    if ($free -lt 0) { $free = 0 }
    return [ordered]@{
        externalId          = $productId
        warehouseExternalId = $warehouseId
        quantity            = $qty
        reserved            = $res
        available           = $free
    }
}

# ----------------------------------------------------------------- config ---

$config  = ReadJsonUtf8 $ConfigPath
$queries = ReadJsonUtf8 (Join-Path $scriptDir "queries.json")

# --- incremental watermark ------------------------------------------------
#
# Holds the start time of the last successful extract. Read before the run,
# written only after the manifest lands, so a crashed run re-reads the same
# window next time instead of skipping it.
#
# The window is deliberately overlapped by a few minutes: 1C document dates
# are the document's own date, which a manager can back-date when posting, and
# server/agent clocks need not agree to the second.
$statePath = Join-Path $scriptDir "state.json"
$runStart  = Get-Date

$since = $null
if ($Scope -ne "full") {
    if (Test-Path $statePath) {
        try {
            $state = ReadJsonUtf8 $statePath
            if ($state.lastSuccessAt) {
                $overlap = 15
                if ($config.incremental -and $config.incremental.overlapMinutes) {
                    $overlap = [int]$config.incremental.overlapMinutes
                }
                $since = ([datetime]$state.lastSuccessAt).AddMinutes(-$overlap)
            }
        } catch {
            # A corrupt state file must not wedge the schedule: fall back to a
            # full read, which is correct, merely slower.
            Log ("state.json unreadable, falling back to full: " + $_.Exception.Message)
        }
    }
    if (-not $since) {
        Log "no previous watermark -- this run reads everything"
    }
}

# A light run still needs catalogs the very first time, otherwise prices would
# reference products the site has never seen.
$doCatalogs = ($Scope -ne "light") -or (-not $since)

$connString = 'Srvr="' + $config.oneC.server + '";Ref="' + $config.oneC.base +
              '";Usr="' + $config.oneC.user + '";Pwd="' + $config.oneC.password + '";'

if (-not (Test-Path $OutDir)) { [void](New-Item -ItemType Directory -Path $OutDir -Force) }

# Clear the previous run's output before writing. Otherwise a light run, which
# never touches product.ndjson, would leave last hour's file in place and the
# sender would ship those 20k rows again every five minutes.
#
# The manifest goes first and unconditionally: it is the success marker, so
# from here until it is rewritten, send.ps1 will refuse to ship a partial run.
Remove-Item (Join-Path $OutDir "manifest.json") -Force -EA 0

# Only remove what this scope will actually rewrite. A light run deleting
# product.ndjson destroys the file the matching script needs, and gains
# nothing -- the sender skips files that are absent, not files that are stale,
# and staleness is prevented by deleting them here per scope.
$filesThisScope = @("price.ndjson", "stock.ndjson")
if ($doCatalogs) {
    $filesThisScope += @("category.ndjson", "product.ndjson", "warehouse.ndjson")
}
if ($config.scope.documents) {
    $filesThisScope += @("counterparty.ndjson", "sales_doc.ndjson", "debt.ndjson", "payment.ndjson")
}
foreach ($f in $filesThisScope) {
    Remove-Item (Join-Path $OutDir $f) -Force -EA 0
}

$stats = [ordered]@{}

# ------------------------------------------------------------------- run ----

Log ("extract.ps1 v1.9  scope=" + $Scope)
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

# Document line items are read INLINE at the call site, not in a helper.
#
# A function that builds a parameterised query and returns a hashtable comes
# back null on this 1C build -- the same failure that forced the price query
# to be inlined earlier. The identical code inline works.

try {
    # --- categories (product groups) ---
    if ($config.scope.categories -and $doCatalogs) {
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
    if ($config.scope.products -and $doCatalogs) {
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
            # identical (Cyrillic I vs Ukrainian I), so an exact-match miss
            # needs the real list
            # printed rather than a bare "not found".
            $names = New-Object Collections.Generic.List[string]
            $list = RunQuery $queries.priceTypeList
            while ($list.Next()) { $names.Add((Str $list.Get(0))) }
            Log ("price types in base: " + ($names -join " | "))
            throw ("price type not found: '" + $config.priceTypes.retail + "'")
        }
        $priceTypeRef = $sel.Get(0)
        if ($null -eq $priceTypeRef) { throw "price type ref is null" }

        # On an incremental run, find which products had a price written since
        # the watermark. Everything else keeps the value the site already has.
        $changedProducts = $null
        if ($since) {
            $q = $ib.NewObject("Query")
            $q.Text = [string]$queries.pricesChangedSince
            $q.SetParameter([string]$queries.paramFrom, $since)
            $q.SetParameter([string]$queries.paramPriceType, $priceTypeRef)
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "Execute() returned null on changed-prices query" }
            $r = $rs.Choose()
            $changedProducts = @{}
            while ($r.Next()) {
                $cid = RefId $ib $r.Get(0)
                if ($cid) { $changedProducts[$cid] = $true }
            }
            Log ("prices changed since {0:yyyy-MM-dd HH:mm}: {1}" -f $since, $changedProducts.Count)
        }

        Log "reading prices..."

        $w = NewWriter (Join-Path $OutDir "price.ndjson")
        $n = 0
        $noRate = 0
        $skipUnchanged = 0
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
            if ($null -ne $changedProducts -and -not $changedProducts.ContainsKey($id)) {
                $skipUnchanged++
                continue
            }
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
        if ($noRate -gt 0) { $stats.pricesSkippedNoRate = $noRate }
        if ($skipUnchanged -gt 0) { $stats.pricesUnchanged = $skipUnchanged }
        Log ("prices: {0}  (unchanged {1}, no-rate {2})" -f $n, $skipUnchanged, $noRate)
    }

    # --- warehouses ---
    if ($config.scope.warehouses -and $doCatalogs) {
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

    # --- stock balances, per warehouse, net of reservations ---
    #
    # Three numbers go to the site, not one:
    #   quantity  -- physical, what the warehouse can actually pick
    #   reserved  -- promised to a customer order
    #   available -- quantity - reserved, what a rep may still sell
    #
    # Collapsing these into a single figure would break one side or the other:
    # the warehouse picks against physical, the rep sells against available.
    if ($config.scope.stock) {
        # Which product/warehouse pairs moved since the watermark. A pair that
        # moved to zero still matters -- the site must be told it is now empty
        # -- so the key set is built from the movement register, and the
        # balance query below reports whatever the current total is.
        #
        # Reservations are unioned into the same key set: a reservation that
        # expires or is cancelled changes what a rep may sell WITHOUT any
        # physical movement, so watching TovaryNaSkladah alone would miss it.
        $changedStock = $null
        if ($since) {
            $changedStock = @{}

            $q = $ib.NewObject("Query")
            $q.Text = [string]$queries.stockChangedSince
            $q.SetParameter([string]$queries.paramFrom, $since)
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "Execute() returned null on changed-stock query" }
            $r = $rs.Choose()
            while ($r.Next()) {
                $p = RefId $ib $r.Get(0)
                $h = RefId $ib $r.Get(1)
                if ($p -and $h) { $changedStock[($p + "|" + $h)] = $true }
            }
            $movedPhysical = $changedStock.Count

            $q = $ib.NewObject("Query")
            $q.Text = [string]$queries.reserveChangedSince
            $q.SetParameter([string]$queries.paramFrom, $since)
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "Execute() returned null on changed-reserve query" }
            $r = $rs.Choose()
            while ($r.Next()) {
                $p = RefId $ib $r.Get(0)
                $h = RefId $ib $r.Get(1)
                if ($p -and $h) { $changedStock[($p + "|" + $h)] = $true }
            }
            Log ("changed since {0:yyyy-MM-dd HH:mm}: {1} physical, {2} incl. reservations" -f `
                 $since, $movedPhysical, $changedStock.Count)
        }

        # Reservations are read in full every cycle regardless of scope: the
        # register is small (thousands, not tens of thousands) and a stale
        # reserve figure is exactly what oversells the warehouse.
        Log "reading reservations..."
        $reserved = @{}
        $r = RunQuery $queries.reserve
        while ($r.Next()) {
            $p = RefId $ib $r.Get(0)
            $h = RefId $ib $r.Get(1)
            if (-not $p -or -not $h) { continue }
            $reserved[($p + "|" + $h)] = Num $r.Get(2)
        }
        $stats.reservations = $reserved.Count
        Log ("reservations: " + $reserved.Count)

        Log "reading stock..."
        $w = NewWriter (Join-Path $OutDir "stock.ndjson")
        $n = 0
        $skipUnchanged = 0
        $seen = @{}

        $r = RunQuery $queries.stock
        while ($r.Next()) {
            $product = RefId $ib $r.Get(0)
            $wh      = RefId $ib $r.Get(1)
            if (-not $product -or -not $wh) { continue }
            $key = $product + "|" + $wh
            if ($null -ne $changedStock) {
                if (-not $changedStock.ContainsKey($key)) { $skipUnchanged++; continue }
            }
            $seen[$key] = $true

            $qty = Num $r.Get(2)
            $res = 0
            if ($reserved.ContainsKey($key)) { $res = $reserved[$key] }

            WriteRecord $w (StockRecord $product $wh $qty $res)
            $n++
        }

        # Two cases land here, both of which the balance query cannot report:
        #   * a pair that moved but is absent from balances -- sold to zero;
        #   * a pair with a reservation but no physical stock -- oversold, and
        #     the site must see it as zero available rather than stale.
        # Without this the classic bug appears: sold-out goods stay in stock
        # on the site forever.
        $zeroed = 0
        $keysToZero = New-Object Collections.Generic.List[string]
        if ($null -ne $changedStock) {
            foreach ($key in $changedStock.Keys) {
                if (-not $seen.ContainsKey($key)) { $keysToZero.Add($key) }
            }
        } else {
            foreach ($key in $reserved.Keys) {
                if (-not $seen.ContainsKey($key)) { $keysToZero.Add($key) }
            }
        }
        foreach ($key in $keysToZero) {
            $parts = $key.Split("|")
            $res = 0
            if ($reserved.ContainsKey($key)) { $res = $reserved[$key] }
            WriteRecord $w (StockRecord $parts[0] $parts[1] 0 $res)
            $zeroed++
            $n++
        }

        $w.Close()
        $stats.stock = $n
        if ($zeroed -gt 0) { $stats.stockZeroed = $zeroed }
        if ($skipUnchanged -gt 0) { $stats.stockUnchanged = $skipUnchanged }
        Log ("stock: {0}  (zeroed {1}, unchanged {2})" -f $n, $zeroed, $skipUnchanged)
    }

    # --- documents: the sales-analytics half of the sync ---------------------
    #
    # Only posted documents. An unposted order has not gone to the warehouse
    # and must not count towards anyone's KPI.
    #
    # Documents are always read by date window, never in full: 13 years of
    # orders is far more than the site needs, and the interesting question is
    # always "what happened recently".
    if ($config.scope.documents) {
        $docsFrom = $since
        if (-not $docsFrom) {
            $days = 90
            if ($config.documents -and $config.documents.initialDays) {
                $days = [int]$config.documents.initialDays
            }
            $docsFrom = (Get-Date).AddDays(-$days)
            Log ("documents: no watermark, reading last {0} days" -f $days)
        }

        # --- counterparties ---
        # Read in full: the catalogue is small and has no change date, and a
        # document referencing an unknown customer would be dropped by the
        # server.
        Log "reading counterparties..."
        $w = NewWriter (Join-Path $OutDir "counterparty.ndjson")
        $n = 0
        $r = RunQuery $queries.counterparties
        while ($r.Next()) {
            $id = RefId $ib $r.Get(0)
            if (-not $id) { continue }
            $rec = [ordered]@{ externalId = $id; name = Str $r.Get(1) }
            $code = Str $r.Get(2)
            if ($code) { $rec.code = $code }
            if ($r.Get(3)) { $rec.type = "CUSTOMER" }
            if ($r.Get(4)) { $rec.deleted = $true }
            WriteRecord $w $rec
            $n++
        }
        $w.Close()
        $stats.counterparties = $n
        Log "counterparties: $n"

        # --- orders, with their line items ---
        #
        # Items come as one flat result set keyed by owner document, and are
        # grouped here. Reading them per-document would mean thousands of
        # round trips to 1C.
        Log ("reading orders since {0:yyyy-MM-dd}..." -f $docsFrom)

        # Inline, not a helper -- see the note above RunQuery. One flat query
        # for the whole window, grouped here by owner document: a query per
        # document would mean thousands of round trips to 1C.
        $itemsByDoc = @{}
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queries.orderItemsSince
        $q.SetParameter([string]$queries.paramFrom, $docsFrom)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute() returned null on order items query" }
        $r = $rs.Choose()
        $itemRows = 0
        while ($r.Next()) {
            $docId  = RefId $ib $r.Get(0)
            $prodId = RefId $ib $r.Get(1)
            # A line without a product is a service or comment row: no
            # analytics value, and the server would reject it anyway.
            if (-not $docId -or -not $prodId) { continue }

            if (-not $itemsByDoc.ContainsKey($docId)) {
                $itemsByDoc[$docId] = New-Object Collections.Generic.List[object]
            }
            [void]$itemsByDoc[$docId].Add([ordered]@{
                productExternalId = $prodId
                quantity          = Num $r.Get(2)
                price             = Num $r.Get(3)
            })
            $itemRows++
        }
        Log ("  order items: {0} rows in {1} documents" -f $itemRows, $itemsByDoc.Count)

        $w = NewWriter (Join-Path $OutDir "sales_doc.ndjson")
        $n = 0
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queries.ordersSince
        $q.SetParameter([string]$queries.paramFrom, $docsFrom)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute() returned null on orders query" }
        $r = $rs.Choose()
        while ($r.Next()) {
            $id = RefId $ib $r.Get(0)
            if (-not $id) { continue }
            $rec = [ordered]@{
                externalId = $id
                number     = Str $r.Get(1)
                date       = IsoDate $r.Get(2)
                posted     = $true
            }
            $cp = RefId $ib $r.Get(3)
            if ($cp) { $rec.counterpartyExternalId = $cp }
            $rec.totalAmount = Num $r.Get(4)

            $repId = RefId $ib $r.Get(5)
            if ($repId) { $rec.salesRepExternalId = $repId }
            $repName = Str $r.Get(6)
            if ($repName) { $rec.salesRepName = $repName }

            # Guarded: a document with no matched lines is still worth having
            # -- the header carries the rep, the customer and the total, which
            # is most of what the KPI needs.
            if ($null -ne $itemsByDoc -and $itemsByDoc.ContainsKey($id)) {
                $rec.items = $itemsByDoc[$id].ToArray()
            }
            WriteRecord $w $rec
            $n++
        }
        $w.Close()
        $stats.orders = $n
        Log "orders: $n"

        # --- debt balances ---
        Log "reading debt..."
        $w = NewWriter (Join-Path $OutDir "debt.ndjson")
        $n = 0
        $r = RunQuery $queries.debt
        while ($r.Next()) {
            $cp = RefId $ib $r.Get(0)
            if (-not $cp) { continue }
            WriteRecord $w ([ordered]@{ externalId = $cp; balance = Num $r.Get(1) })
            $n++
        }
        $w.Close()
        $stats.debt = $n
        Log "debt: $n"

        # --- cash payments ---
        Log "reading payments..."
        $w = NewWriter (Join-Path $OutDir "payment.ndjson")
        $n = 0
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queries.paymentsSince
        $q.SetParameter([string]$queries.paramFrom, $docsFrom)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute() returned null on payments query" }
        $r = $rs.Choose()
        while ($r.Next()) {
            $id = RefId $ib $r.Get(0)
            $cp = RefId $ib $r.Get(3)
            if (-not $id -or -not $cp) { continue }
            WriteRecord $w ([ordered]@{
                externalId              = $id
                counterpartyExternalId  = $cp
                number                  = Str $r.Get(1)
                date                    = IsoDate $r.Get(2)
                amount                  = Num $r.Get(4)
                method                  = "cash"
            })
            $n++
        }
        $w.Close()
        $stats.payments = $n
        Log "payments: $n"
    }

    # Manifest doubles as the success marker: the sender refuses to run
    # without it, so a crashed extract can never be shipped as complete.
    $manifest = [ordered]@{
        extractedAt = (Get-Date).ToString("o")
        scope       = $Scope
        server      = $config.oneC.server
        base        = $config.oneC.base
        priceType   = $config.priceTypes.retail
        counts      = $stats
    }
    # Only a full run has seen every record, so only a full run may claim the
    # snapshot is complete -- the sender uses this to decide whether missing
    # records mean "deleted in 1C" or merely "not in this batch".
    $manifest.fullSnapshot = ($Scope -eq "full")
    if ($since) { $manifest.incrementalSince = $since.ToString("o") }
    if (-not $doCatalogs) { $manifest.catalogsSkipped = $true }

    $manifestPath = Join-Path $OutDir "manifest.json"
    [IO.File]::WriteAllText(
        $manifestPath,
        ($manifest | ConvertTo-Json -Depth 5),
        (New-Object Text.UTF8Encoding($false))
    )

    # Watermark advances to the moment this run STARTED, not finished: rows
    # written to 1C while we were reading must fall inside the next window.
    [IO.File]::WriteAllText(
        $statePath,
        ([ordered]@{
            lastSuccessAt = $runStart.ToString("o")
            lastScope     = $Scope
        } | ConvertTo-Json),
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
