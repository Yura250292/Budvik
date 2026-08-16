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

<#
  "yyyy-MM-dd" -> DateTime, built field by field rather than parsed.

  [datetime]::ParseExact(..., $null) takes the CURRENT culture, and on this
  Ukrainian-locale server it rejects "2026-07-01" outright with "String was
  not recognized as a valid DateTime". Both callers below wrap the call in
  try/catch and fall back to the normal window on failure -- so the backfill
  would have quietly not happened, with only a log line to say so.

  Constructing the value from its parts cannot fail on locale at all.
#>
function ParseDay([string] $s) {
    $m = [regex]::Match(([string]$s).Trim(), '^(\d{4})-(\d{2})-(\d{2})$')
    if (-not $m.Success) { throw ("expected yyyy-MM-dd, got '" + $s + "'") }
    return New-Object DateTime([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, [int]$m.Groups[3].Value)
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

# Realizations were added to the exchange later than orders, so the shared
# watermark has long since passed the history the analytics needs. Until the
# one-off backfill has run, the realization queries ignore the watermark and
# read from documents.realizationsFrom instead. The flag lives in state.json
# next to the watermark, so a reinstall that keeps state does not re-read
# seven months of documents.
#
# Read outside the $Scope check below: a full run skips the watermark, but it
# must still know the backfill is done, or every nightly run would re-read the
# whole history.
$realBackfilledAt = $null
$realBackfillRan  = $false
# Returns joined the exchange later still, and need their own flag: they carry
# three years of history the watermark passed long ago.
$returnsBackfilledAt = $null
# Cost of sales joined last of all, when realizations had long been backfilled
# and their flag already pinned the window to ~90 days. Its own flag lets it
# catch up on the same history exactly once.
$costBackfilledAt = $null
if (Test-Path $statePath) {
    try {
        $s = ReadJsonUtf8 $statePath
        if ($s.realizationsBackfilledAt) { $realBackfilledAt = [string]$s.realizationsBackfilledAt }
        if ($s.returnsBackfilledAt) { $returnsBackfilledAt = [string]$s.returnsBackfilledAt }
        if ($s.costBackfilledAt) { $costBackfilledAt = [string]$s.costBackfilledAt }
    } catch {
        # Unreadable state means the backfill simply repeats -- upserts by
        # Ref_Key, so a repeat costs time, not correctness.
    }
}

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
    # route_sheet* belong here too: without them a run whose sheet query fails
    # would leave the previous run's file in place, and send.ps1 would ship
    # those rows again as if they were fresh.
    $filesThisScope += @("counterparty.ndjson", "sales_doc.ndjson", "realization_doc.ndjson",
                         "return_doc.ndjson", "debt.ndjson", "payment.ndjson",
                         "route_sheet.ndjson", "route_sheet_stop.ndjson")
}
foreach ($f in $filesThisScope) {
    Remove-Item (Join-Path $OutDir $f) -Force -EA 0
}

$stats = [ordered]@{}

# --- retry window ---------------------------------------------------------
#
# 1C drops user sessions around 20:00 for roughly half an hour while it runs
# its scheduled maintenance, and a run caught in that window loses the
# connection either on Connect() or midway through reading.
#
# Only the "full" scope retries, and that is a deliberate restriction rather
# than caution. The light (5 min) and hourly schedules already have a second
# chance built in -- the next cycle. Worse, run-sync.ps1 treats a lock older
# than 25 minutes as a crashed run, so a scope that sat here sleeping through
# three attempts would first stall the 5-minute schedule and then have its
# lock declared stale, letting a second run into the same out/ directory.
# Sleeping is only safe for a scope that runs once a day.
#
# Retrying at all is safe because of how a run ends: the manifest is the
# success marker and is written last, and the watermark advances only after
# it, so an aborted attempt leaves nothing behind for the next one to trip on.
$retryAttempts = 3
$retryDelayMin = 10
if ($config.retry) {
    if ($config.retry.attempts)     { $retryAttempts = [int]$config.retry.attempts }
    if ($config.retry.delayMinutes) { $retryDelayMin = [int]$config.retry.delayMinutes }
}
if ($retryAttempts -lt 1) { $retryAttempts = 1 }

# The short scopes fail fast and let the schedule recover, exactly as before.
if ($Scope -ne "full") { $retryAttempts = 1 }

# Total sleep must still fit the caller's stale-lock threshold, or a retrying
# full run gets its own lock declared stale and a light run joins it in out/.
# Clamped rather than merely warned about: a misconfigured retry that quietly
# corrupts a nightly run is worse than one that gives up early.
$maxSleepMin = 20
if ($retryAttempts -gt 1 -and (($retryAttempts - 1) * $retryDelayMin) -gt $maxSleepMin) {
    $retryDelayMin = [Math]::Max(1, [int][Math]::Floor($maxSleepMin / ($retryAttempts - 1)))
    Log ("retry delay clamped to {0} min to stay inside the stale-lock window" -f $retryDelayMin)
}

# ------------------------------------------------------------------- run ----

Log ("extract.ps1 v2.1  scope=" + $Scope)

# Each COM step is checked separately: a bare "you cannot call a method on a
# null-valued expression" gives no clue which of NewObject/Execute/Choose
# returned nothing.
#
# Reads $ib from the enclosing scope, which the retry loop below rebinds on
# every attempt -- PowerShell resolves it at call time, so the function always
# talks to the current attempt's connection.
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

<#
  Tells a dead connection apart from a query this build cannot run.

  The debt and payment blocks are deliberately best-effort: those queries fail
  on this 1C build for their own reasons, and losing the balances is better
  than losing the orders already read. But they are also the LAST things the
  run does, which puts them squarely in the 20:00 window when 1C drops
  sessions -- and a swallowed disconnect there is the worst outcome available:
  the run writes its manifest, calls itself a success and advances the
  watermark, so the skipped window is never re-read and the debt figures are
  quietly a day stale.

  So a connection-level failure has to escape the best-effort catch and reach
  the retry loop. Matched on the COM error text because that is all the 1C
  connector gives us -- there is no typed exception to check.

  Deliberately narrow, and matched on HRESULT codes rather than words. A
  pattern that also caught "RPC" or the word "connection" would fire on
  ordinary query failures ("Execute() returned null on ..."), and the
  best-effort blocks would stop being best-effort: a debt query this build
  cannot run would abort and retry the whole extract instead of being
  skipped. Over-matching costs more than under-matching here -- a missed
  disconnect merely falls through to the behaviour we had before.

  Only ASCII: PowerShell 5 reads .ps1 in the OEM codepage, so Cyrillic in a
  literal is mangled before the regex ever sees it (see the file header).
  That rules out matching the localised 1C wording directly -- the HRESULT
  codes appear in the message regardless of interface language.
#>
function IsConnectionLost($err) {
    $msg = ""
    try { $msg = [string]$err.Exception.Message } catch { }
    if (-not $msg) { return $false }
    # 800706BA RPC server unavailable   800706BE remote call failed
    # 80010108 object disconnected      8001010A message filter busy
    # 800706BF/8007071A call cancelled or interface unavailable
    return ($msg -match "(?i)800706BA|800706BE|800706BF|8007071A|80010108|8001010A|RPC server")
}

$attempt = 0
while ($true) {
$attempt++
$connector = $null
$ib = $null

# Stats accumulate into the same hashtable across the whole run, so a retry
# must start from a clean slate -- otherwise an attempt that died after
# writing "products: 20000" would carry that count into the manifest of the
# attempt that actually succeeded.
$stats = [ordered]@{}

try {
    Log "connecting to 1C..."
    $connector = New-Object -ComObject V82.COMConnector
    $ib = $connector.Connect($connString)
    Log "connected"

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

        # Sliding rescan window.
        #
        # Documents are selected by DOCUMENT DATE -- 8.2 over COM has no usable
        # change timestamp. So the watermark, which is about when we last ran,
        # says nothing about a document edited today but dated last week. And
        # that edit is the norm here: the office posts an invoice, the warehouse
        # rings back "we don't have that one", and the line is minused off a
        # document that is already posted. With a 15-minute window we never
        # heard about it; the nightly full run caught it up to a day later.
        #
        # So every run also re-reads the last N days regardless of the
        # watermark. Re-reading is idempotent (upsert by Ref_Key, the tabular
        # part is replaced wholesale), so the only cost is traffic: at ~2.3k
        # orders per 90 days, three days is under a hundred documents.
        $rescanDays = 3
        if ($config.documents -and $null -ne $config.documents.windowDays) {
            $rescanDays = [int]$config.documents.windowDays
        }
        if ($rescanDays -gt 0) {
            $rescanFrom = (Get-Date).AddDays(-$rescanDays)
            if ($rescanFrom -lt $docsFrom) {
                Log ("documents: rescanning last {0} days for edits to posted documents" -f $rescanDays)
                $docsFrom = $rescanFrom
            }
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
                # Read, not assumed. An unposted document that we already have
                # is an unposting in 1C, and the server turns it into CANCELLED;
                # an unposted one we have never seen is a draft and is dropped.
                posted     = [bool]$r.Get(7)
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

        # --- realizations, with their line items ---
        #
        # The document the sales analytics actually runs on: an order is what
        # the manager promised, a realization is what left the warehouse. Both
        # streams are kept -- the gap between them is the shortfall report.
        #
        # Read from a separate date, not the shared watermark: realizations
        # joined the exchange later, so the first run has to reach back for
        # history the watermark has already passed. See $realBackfilledAt.
        # Either flag missing pulls the window back: realizations needed the
        # backfill first, cost needed it later (it joined the exchange after
        # realizations had already been stamped, so their flag alone would
        # pin cost to the 90-day window and leave older documents at zero
        # margin). Clearing costBackfilledAt in state.json re-runs the reach-
        # back for both, which is exactly what a cost catch-up needs.
        $realFrom = $docsFrom
        if ((-not $realBackfilledAt) -or (-not $costBackfilledAt)) {
            $bf = "2026-01-01"
            if ($config.documents -and $config.documents.realizationsFrom) {
                $bf = [string]$config.documents.realizationsFrom
            }
            try {
                $realFrom = ParseDay $bf
                Log ("realizations: one-off backfill from {0}" -f $bf)
            } catch {
                # A typo in the config must not cost us the whole document run:
                # fall back to the normal window and say so.
                Log ("realizations: bad realizationsFrom '" + $bf + "', using normal window")
                $realFrom = $docsFrom
            }
        }
        Log ("reading realizations since {0:yyyy-MM-dd}..." -f $realFrom)

        # Inline rather than shared with the orders block above -- see the note
        # above RunQuery: wrapping COM query objects in helpers is what this
        # build fails on.
        $realItemsByDoc = @{}
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queries.salesItemsSince
        $q.SetParameter([string]$queries.paramFrom, $realFrom)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute() returned null on realization items query" }
        $r = $rs.Choose()
        $itemRows = 0
        while ($r.Next()) {
            $docId  = RefId $ib $r.Get(0)
            $prodId = RefId $ib $r.Get(1)
            # A line without a product is a service or comment row: no
            # analytics value, and the server would reject it anyway.
            if (-not $docId -or -not $prodId) { continue }

            if (-not $realItemsByDoc.ContainsKey($docId)) {
                $realItemsByDoc[$docId] = New-Object Collections.Generic.List[object]
            }
            [void]$realItemsByDoc[$docId].Add([ordered]@{
                productExternalId = $prodId
                quantity          = Num $r.Get(2)
                price             = Num $r.Get(3)
            })
            $itemRows++
        }
        Log ("  realization items: {0} rows in {1} documents" -f $itemRows, $realItemsByDoc.Count)

        # --- cost of goods for those same lines ---
        #
        # Until now every realization line went out with cost = 0, on the
        # belief that 1C does not hand cost out. That was wrong: the register
        # Prodazhi does not exist in this build, but ProdazhiSebestoimost does
        # -- it is what the "Valovaya pribyl val" report reads, the one the
        # office was retyping into payroll by hand.
        #
        # Keyed by document+product, so it attaches to the lines already read
        # above. The query groups by the same pair (one product can be written
        # off from several batches inside one shipment) and filters to
        # realizations only -- returns write into this register too.
        #
        # Non-fatal by design: if this query fails, the run still ships
        # documents and revenue, just without margin. Losing today's sales
        # because cost was unavailable would be a bad trade.
        # Cost is read for exactly the window the realizations above cover.
        #
        # It cannot usefully reach further back on its own: cost attaches to
        # lines of documents in THIS batch, so a register row whose document
        # was not read has nothing to attach to. Widening only the cost query
        # would burn time reading rows that get discarded.
        #
        # Catching up on history is therefore a realization-side job: clear
        # costBackfilledAt in state.json and $realFrom below reaches back to
        # realizationsFrom again, carrying cost with it. That is what the
        # first run needed -- it covered June onwards and left everything
        # earlier at zero margin (measured: 26.8% of lines).
        $costFrom = $realFrom

        $costByDocProduct = @{}
        try {
            $q = $ib.NewObject("Query")
            $q.Text = [string]$queries.costOfSalesSince
            $q.SetParameter([string]$queries.paramFrom, $costFrom)
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "Execute() returned null on cost query" }
            $r = $rs.Choose()
            $costRows = 0
            while ($r.Next()) {
                $docId  = RefId $ib $r.Get(0)
                $prodId = RefId $ib $r.Get(1)
                if (-not $docId -or -not $prodId) { continue }
                $costByDocProduct[($docId + "|" + $prodId)] = Num $r.Get(3)
                $costRows++
            }
            Log ("  cost of sales: {0} rows" -f $costRows)
        } catch {
            Log ("  cost of sales FAILED (documents still go out without margin): " + $_.Exception.Message.Split("`n")[0])
        }

        # Attach cost to the lines. A line with no match keeps no cost field at
        # all rather than a zero: the server tells "not supplied" from "sold at
        # cost" only if the field is absent.
        if ($costByDocProduct.Count -gt 0) {
            $matched = 0
            foreach ($docId in @($realItemsByDoc.Keys)) {
                foreach ($item in $realItemsByDoc[$docId]) {
                    $key = $docId + "|" + $item.productExternalId
                    if ($costByDocProduct.ContainsKey($key)) {
                        $item.cost = $costByDocProduct[$key]
                        $matched++
                    }
                }
            }
            Log ("  cost matched to {0} of {1} line(s)" -f $matched, $itemRows)
        }

        $w = NewWriter (Join-Path $OutDir "realization_doc.ndjson")
        $n = 0
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queries.salesSince
        $q.SetParameter([string]$queries.paramFrom, $realFrom)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute() returned null on realizations query" }
        $r = $rs.Choose()
        while ($r.Next()) {
            $id = RefId $ib $r.Get(0)
            if (-not $id) { continue }
            $rec = [ordered]@{
                externalId = $id
                number     = Str $r.Get(1)
                date       = IsoDate $r.Get(2)
                posted     = [bool]$r.Get(7)
            }
            $cp = RefId $ib $r.Get(3)
            if ($cp) { $rec.counterpartyExternalId = $cp }
            $rec.totalAmount = Num $r.Get(4)

            $repId = RefId $ib $r.Get(5)
            if ($repId) { $rec.salesRepExternalId = $repId }
            $repName = Str $r.Get(6)
            if ($repName) { $rec.salesRepName = $repName }

            if ($null -ne $realItemsByDoc -and $realItemsByDoc.ContainsKey($id)) {
                $rec.items = $realItemsByDoc[$id].ToArray()
            }
            WriteRecord $w $rec
            $n++
        }
        $w.Close()
        $stats.realizations = $n
        Log "realizations: $n"

        # The flag is NOT set here on purpose.
        #
        # Writing the file is not the same as delivering it. The scheduler runs
        # every five minutes: if extract marked the backfill done, the next run
        # would read the normal 15-minute window, find nothing, and overwrite
        # realization_doc.ndjson with an empty file -- destroying seven months
        # of history before send.ps1 ever shipped it. That is exactly what
        # happened on the first live run.
        #
        # send.ps1 stamps realizationsBackfilledAt after the server confirms
        # the batches. Until then every extract re-reads the full backfill,
        # which is idempotent (upsert by Ref_Key) and merely slow.

        # --- returns from customers, with their line items ---
        #
        # Until this channel existed, every rep's turnover was overstated by
        # exactly the returned amount -- 2099 documents worth 4.6M UAH over
        # three years -- while the debt figure, which comes from the settlement
        # register, already netted them out. Two numbers in one system that
        # contradicted each other by construction.
        #
        # Quantities and totals are sent EXACTLY as 1C holds them, i.e.
        # positive. The minus is the server's job (apply-documents.ts): the
        # agent stays a transcript of 1C, and the sign is site semantics.
        $returnsFrom = $docsFrom
        if (-not $returnsBackfilledAt) {
            $bf = "2023-01-01"
            if ($config.documents -and $config.documents.returnsFrom) {
                $bf = [string]$config.documents.returnsFrom
            }
            try {
                $returnsFrom = ParseDay $bf
                Log ("returns: one-off backfill from {0}" -f $bf)
            } catch {
                Log ("returns: bad returnsFrom '" + $bf + "', using normal window")
                $returnsFrom = $docsFrom
            }
        }
        Log ("reading returns since {0:yyyy-MM-dd}..." -f $returnsFrom)

        $returnItemsByDoc = @{}
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queries.returnItemsSince
        $q.SetParameter([string]$queries.paramFrom, $returnsFrom)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute() returned null on return items query" }
        $r = $rs.Choose()
        $itemRows = 0
        while ($r.Next()) {
            $docId  = RefId $ib $r.Get(0)
            $prodId = RefId $ib $r.Get(1)
            if (-not $docId -or -not $prodId) { continue }

            if (-not $returnItemsByDoc.ContainsKey($docId)) {
                $returnItemsByDoc[$docId] = New-Object Collections.Generic.List[object]
            }
            [void]$returnItemsByDoc[$docId].Add([ordered]@{
                productExternalId = $prodId
                quantity          = Num $r.Get(2)
                price             = Num $r.Get(3)
            })
            $itemRows++
        }
        Log ("  return items: {0} rows in {1} documents" -f $itemRows, $returnItemsByDoc.Count)

        $w = NewWriter (Join-Path $OutDir "return_doc.ndjson")
        $n = 0
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queries.returnsSince
        $q.SetParameter([string]$queries.paramFrom, $returnsFrom)
        $rs = $q.Execute()
        if ($null -eq $rs) { throw "Execute() returned null on returns query" }
        $r = $rs.Choose()
        while ($r.Next()) {
            $id = RefId $ib $r.Get(0)
            if (-not $id) { continue }
            $rec = [ordered]@{
                externalId = $id
                number     = Str $r.Get(1)
                date       = IsoDate $r.Get(2)
                posted     = [bool]$r.Get(7)
            }
            $cp = RefId $ib $r.Get(3)
            if ($cp) { $rec.counterpartyExternalId = $cp }
            $rec.totalAmount = Num $r.Get(4)

            # Менеджер, not Ответственный: the probe found 11 distinct people
            # there against 4 back-office staff in Ответственный, one of whom
            # signed 40 of 60 documents. Same rule as realizations.
            $repId = RefId $ib $r.Get(5)
            if ($repId) { $rec.salesRepExternalId = $repId }
            $repName = Str $r.Get(6)
            if ($repName) { $rec.salesRepName = $repName }

            if ($null -ne $returnItemsByDoc -and $returnItemsByDoc.ContainsKey($id)) {
                $rec.items = $returnItemsByDoc[$id].ToArray()
            }
            WriteRecord $w $rec
            $n++
        }
        $w.Close()
        $stats.returns = $n
        Log "returns: $n"

        # Same rule as realizations: the flag is stamped by send.ps1 only after
        # the server confirms the batches, never here.

        # --- debt balances ---
        # Debt is best-effort: several phrasings of this query fail on this
        # build with a bare NullReferenceException, and losing the balances is
        # far better than losing the orders that were already read. Whatever
        # the cause, it must not abort the cycle.
        Log "reading debt..."
        try {
            $w = NewWriter (Join-Path $OutDir "debt.ndjson")
            $n = 0
            $skippedZero = 0
            $r = RunQuery $queries.debt
            while ($r.Next()) {
                $cp = RefId $ib $r.Get(0)
                if (-not $cp) { continue }
                $balance = Num $r.Get(1)

                # Filtered here rather than in the query. The one-kopeck
                # threshold drops rounding dust: this base has plenty of -0.01
                # balances that are not real debt and would only add noise.
                if ([Math]::Abs($balance) -lt 0.02) { $skippedZero++; continue }

                WriteRecord $w ([ordered]@{ externalId = $cp; balance = $balance })
                $n++
            }
            $w.Close()
            $stats.debt = $n
            Log ("debt: {0}  (skipped {1} zero/dust)" -f $n, $skippedZero)
        }
        catch {
            if ($w) { try { $w.Close() } catch { } }
            Remove-Item (Join-Path $OutDir "debt.ndjson") -Force -EA 0
            # A lost connection is not a skippable query failure: swallowing it
            # here would let the run finish "successfully" and advance the
            # watermark past a window it never read. See IsConnectionLost.
            if (IsConnectionLost $_) {
                Log ("debt: connection lost -- aborting attempt")
                throw
            }
            $stats.debtFailed = $_.Exception.Message
            Log ("debt: SKIPPED -- " + $_.Exception.Message)
        }

        # --- cash payments ---
        # Best-effort, same reasoning as debt above.
        Log "reading payments..."
        try {
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
        catch {
            if ($w) { try { $w.Close() } catch { } }
            Remove-Item (Join-Path $OutDir "payment.ndjson") -Force -EA 0
            # Same reasoning as debt above.
            if (IsConnectionLost $_) {
                Log ("payments: connection lost -- aborting attempt")
                throw
            }
            $stats.paymentsFailed = $_.Exception.Message
            Log ("payments: SKIPPED -- " + $_.Exception.Message)
        }

        # --- route sheets: headers only, for payroll cross-checks ---
        # The probes proved this document is a bare header: no tabular section
        # (the stop list is assembled BY HAND at print time and stored
        # nowhere), Kilometrazh filled in ~5% of documents, and realizations
        # do not know their sheet. So driver payroll runs on the site's own
        # route planner, and these headers only answer one question: 1C has a
        # sheet for this driver and day -- does the site have a route? The
        # journal shows unmatched sheets as the backup source.
        # Best-effort, same reasoning as debt above.
        Log "reading route sheets..."
        try {
            $w = NewWriter (Join-Path $OutDir "route_sheet.ndjson")
            $n = 0
            $q = $ib.NewObject("Query")
            $q.Text = [string]$queries.routeSheetsSince
            $q.SetParameter([string]$queries.paramFrom, $docsFrom)
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "Execute() returned null on route sheets query" }
            $r = $rs.Choose()
            while ($r.Next()) {
                $id = RefId $ib $r.Get(0)
                if (-not $id) { continue }
                $rec = [ordered]@{
                    externalId = $id
                    number     = Str $r.Get(1)
                    date       = IsoDate $r.Get(2)
                    posted     = [bool]$r.Get(6)
                }
                $drvId = RefId $ib $r.Get(3)
                if ($drvId) { $rec.driverExternalId = $drvId }
                $drvName = Str $r.Get(4)
                if ($drvName) { $rec.driverName = $drvName }
                # Almost always zero -- see the note above. Sent only when
                # actually filled, so the server's default 0 stays honest.
                $km = Num $r.Get(5)
                if ($km -gt 0) { $rec.distanceKm = $km }
                WriteRecord $w $rec
                $n++
            }
            $w.Close()
            $stats.routeSheets = $n
            Log "route sheets: $n"
        }
        catch {
            if ($w) { try { $w.Close() } catch { } }
            Remove-Item (Join-Path $OutDir "route_sheet.ndjson") -Force -EA 0
            # Same reasoning as debt above.
            if (IsConnectionLost $_) {
                Log ("route sheets: connection lost -- aborting attempt")
                throw
            }
            $stats.routeSheetsFailed = $_.Exception.Message
            Log ("route sheets: SKIPPED -- " + $_.Exception.Message)
        }

        # Stops of those sheets.
        #
        # MarshrutnyjLyst has no tabular section of its own -- the rows the
        # manager sees are realizations pointing back at the sheet through the
        # MarshrutnyjLyst attribute. Verified on live data: of 68 209
        # realizations, 28 778 carry the link, and 33 point at sheet 000001820,
        # which is exactly what its form displays.
        #
        # Grouping happens here rather than in the query: filtering by a
        # reference throws NullReference on this build, so we read realizations
        # by date and bucket them by the sheet GUID in PowerShell.
        #
        # The date filter is on the REALIZATION, not the sheet -- and the two
        # differ: sheet 000001820 is dated 13.08 while its rows are shipments
        # from 12.08. docsFrom already reaches back far enough for both.
        Log "reading route sheet stops..."
        $w2 = $null
        try {
            $w2 = NewWriter (Join-Path $OutDir "route_sheet_stop.ndjson")
            $n = 0
            $skipped = 0
            $q = $ib.NewObject("Query")
            $q.Text = [string]$queries.routeSheetStopsSince
            $q.SetParameter([string]$queries.paramFrom, $docsFrom)
            $rs = $q.Execute()
            if ($null -eq $rs) { throw "Execute() returned null on route sheet stops query" }
            $r = $rs.Choose()
            while ($r.Next()) {
                # No link -- an ordinary shipment that never rode a route.
                # RefId already maps the all-zero GUID to null.
                $sheetId = RefId $ib $r.Get(1)
                if (-not $sheetId) { $skipped++; continue }

                $rec = [ordered]@{
                    routeSheetExternalId = $sheetId
                    salesDocExternalId   = RefId $ib $r.Get(0)
                }
                $cp = RefId $ib $r.Get(2)
                if ($cp) { $rec.counterpartyExternalId = $cp }
                $addr = Str $r.Get(3)
                if ($addr) { $rec.address = $addr }
                # Zero-sum rows exist (the form hides them) but are still real
                # stops the driver visited, so they are sent, not dropped.
                $rec.amount = Num $r.Get(4)

                WriteRecord $w2 $rec
                $n++
            }
            $w2.Close()
            $stats.routeSheetStops = $n
            Log "route sheet stops: $n (no-link realizations skipped: $skipped)"
        }
        catch {
            if ($w2) { try { $w2.Close() } catch { } }
            Remove-Item (Join-Path $OutDir "route_sheet_stop.ndjson") -Force -EA 0
            if (IsConnectionLost $_) {
                Log ("route sheet stops: connection lost -- aborting attempt")
                throw
            }
            # Best-effort: headers already went out, and stops arriving a cycle
            # later is far better than losing the whole sync over them.
            $stats.routeSheetStopsFailed = $_.Exception.Message
            Log ("route sheet stops: SKIPPED -- " + $_.Exception.Message)
        }
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
    #
    # realizationsBackfilledAt is only carried forward here, never created:
    # send.ps1 owns it, because only a delivered backfill is a finished one.
    $newState = [ordered]@{
        lastSuccessAt = $runStart.ToString("o")
        lastScope     = $Scope
    }
    if ($realBackfilledAt) {
        $newState.realizationsBackfilledAt = $realBackfilledAt
    }
    if ($returnsBackfilledAt) {
        $newState.returnsBackfilledAt = $returnsBackfilledAt
    }
    if ($costBackfilledAt) {
        $newState.costBackfilledAt = $costBackfilledAt
    }
    [IO.File]::WriteAllText(
        $statePath,
        ($newState | ConvertTo-Json),
        (New-Object Text.UTF8Encoding($false))
    )

    Log "extract complete"
    $manifest | ConvertTo-Json -Depth 5
    break
}
catch {
    # Print the exact failing line: the console error record from -File hides
    # the position inside functions.
    Log ("ERROR: " + $_.Exception.Message)
    Log ("AT:    " + $_.InvocationInfo.PositionMessage)
    Log ("STACK: " + $_.ScriptStackTrace)

    # Out of attempts -- fail exactly as before, so the scheduler still sees a
    # non-zero exit and nothing downstream mistakes this for a good run.
    if ($attempt -ge $retryAttempts) {
        Log ("giving up after {0} attempt(s)" -f $attempt)
        throw
    }

    # Retrying is only safe because the failed attempt left nothing usable
    # behind: manifest.json was deleted before reading started and is written
    # only on success, so send.ps1 cannot ship a partial run in the meantime,
    # and the watermark has not moved either.
    Log ("attempt {0}/{1} failed -- waiting {2} min before retrying (1C drops sessions ~20:00 for about half an hour)" -f `
         $attempt, $retryAttempts, $retryDelayMin)
    Start-Sleep -Seconds ($retryDelayMin * 60)
}
finally {
    # Release the COM connection explicitly; the 1C server keeps the session
    # alive otherwise and licences leak on repeated scheduled runs. Runs on
    # every attempt, not just the last, or a retry would leak the connection
    # the previous attempt died holding.
    if ($ib) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ib) }
    if ($connector) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($connector) }
    [GC]::Collect()
}

}   # end retry loop
