# Budvik 1C sender -- ships extracted NDJSON to the site's ingest API.
#
# Split from extract.ps1 on purpose: a failed upload must never force a
# re-read of 20k rows from 1C, and a bad extract must never be shipped.
# The manifest written by extract.ps1 is the success marker -- no manifest,
# no send.
#
# Auth: hex(HMAC-SHA256(secret, "<unix-ts>.<raw-body>")), matching
# src/lib/sync-ingest/auth.ts. Body bytes must be identical to what was
# signed, so we sign and post the same UTF-8 byte array.
#
# ASCII-only source (see extract.ps1 for why).

[CmdletBinding()]
param(
    [string] $ConfigPath,
    [string] $OutDir,
    [ValidateSet("incremental", "full", "preview")]
    [string] $Kind,
    [switch] $Quiet
)

$ErrorActionPreference = "Stop"

# TLS 1.2 is not the default on Windows Server 2022 + PS5 for outbound calls;
# without this every HTTPS request to Railway fails at the handshake.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir "config.json" }
if (-not $OutDir)     { $OutDir     = Join-Path $scriptDir "out" }

function Log($msg) {
    if (-not $Quiet) {
        Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg)
    }
}

function ReadJsonUtf8($path) {
    if (-not (Test-Path $path)) { throw "File not found: $path" }
    return ([IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json)
}

$config = ReadJsonUtf8 $ConfigPath

$manifestPath = Join-Path $OutDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
    throw "manifest.json not found in $OutDir -- run extract.ps1 first (or it failed midway)"
}
$manifest = ReadJsonUtf8 $manifestPath

$baseUrl = $config.ingest.url.TrimEnd("/")
$agentId = $config.ingest.agentId
$secret  = $config.ingest.agentSecret
if ([string]::IsNullOrWhiteSpace($secret)) { throw "ingest.agentSecret is empty in config.json" }

if (-not $Kind) {
    if ($config.ingest.preview) { $Kind = "preview" } else { $Kind = "incremental" }
    if ($manifest.fullSnapshot -and -not $config.ingest.preview) { $Kind = "full" }
}

# A "full" send tells the server that anything absent from the payload is gone
# from 1C. An incremental extract only read what changed, so calling it full
# would flag most of the catalogue as missing. Refuse rather than corrupt.
if ($Kind -eq "full" -and -not $manifest.fullSnapshot) {
    throw ("cannot send -Kind full: the extract was scope=" + $manifest.scope +
           ". Re-run extract.ps1 -Scope full first.")
}

$batchSize = 500
if ($config.ingest.batchSize) { $batchSize = [int]$config.ingest.batchSize }
if ($batchSize -gt 500) { $batchSize = 500 }   # server rejects larger batches

# ----------------------------------------------------------------- HTTP ----

$hmac = New-Object Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)

function PostSigned($path, $bodyObject) {
    $json  = $bodyObject | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $ts    = [string][int][double]::Parse(
                 (Get-Date -Date (Get-Date).ToUniversalTime() -UFormat %s))

    # Sign the exact string the server reconstructs: "<ts>.<rawBody>".
    $signBytes = [Text.Encoding]::UTF8.GetBytes($ts + "." + $json)
    $sig = -join ($hmac.ComputeHash($signBytes) | ForEach-Object { $_.ToString("x2") })

    $headers = @{
        "x-sync-agent"     = $agentId
        "x-sync-timestamp" = $ts
        "x-sync-signature" = $sig
    }

    $attempt = 0
    while ($true) {
        $attempt++
        try {
            return Invoke-RestMethod -Method Post -Uri ($baseUrl + $path) `
                   -Headers $headers -ContentType "application/json; charset=utf-8" `
                   -Body $bytes -TimeoutSec 120
        } catch {
            $status = $null
            try { $status = [int]$_.Exception.Response.StatusCode } catch { }
            $detail = ""
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $detail = (New-Object IO.StreamReader($stream)).ReadToEnd()
            } catch { }

            # 4xx means the request itself is wrong -- retrying cannot help.
            if ($status -ge 400 -and $status -lt 500) {
                throw ("HTTP {0} on {1}: {2}" -f $status, $path, $detail)
            }
            if ($attempt -ge 3) {
                throw ("HTTP {0} on {1} after {2} attempts: {3} {4}" -f `
                       $status, $path, $attempt, $_.Exception.Message, $detail)
            }
            Log ("  retry {0} after error: {1}" -f $attempt, $_.Exception.Message)
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

# ------------------------------------------------------------------ run ----

$runId = [guid]::NewGuid().ToString()
Log ("run {0}, kind={1}, target={2}" -f $runId, $Kind, $baseUrl)

$start = PostSigned "/api/sync-ingest/runs" ([ordered]@{
    runId        = $runId
    kind         = $Kind
    startedAt    = (Get-Date).ToString("o")
    agentVersion = "ps-1.0"
})
Log ("run started, syncJobId={0}" -f $start.syncJobId)

# Order matters: categories before products (a product's category must exist),
# warehouses before stock, products before prices and stock.
# Counterparties precede documents for the same reason categories precede
# products: a document referencing an unknown customer would be skipped.
$plan = @(
    @{ file = "category.ndjson";     entity = "category"     },
    @{ file = "product.ndjson";      entity = "product"      },
    @{ file = "warehouse.ndjson";    entity = "warehouse"    },
    @{ file = "price.ndjson";        entity = "price"        },
    @{ file = "stock.ndjson";        entity = "stock"        },
    @{ file = "counterparty.ndjson"; entity = "counterparty" },
    @{ file = "sales_doc.ndjson";    entity = "sales_doc"    },
    @{ file = "realization_doc.ndjson"; entity = "realization_doc" },
    @{ file = "return_doc.ndjson";   entity = "return_doc"   },
    @{ file = "debt.ndjson";         entity = "debt"         },
    @{ file = "payment.ndjson";      entity = "payment"      },
    @{ file = "route_sheet.ndjson";  entity = "route_sheet"  }
)

$totals = [ordered]@{ created = 0; updated = 0; skipped = 0; failed = 0; discrepancies = 0 }
$realizationsSent = 0
$returnsSent = 0
$seq = 0
$sendError = $null

try {
    foreach ($step in $plan) {
        $path = Join-Path $OutDir $step.file

        # A light extract leaves catalog files on disk from the last hourly
        # run so the matching script can use them, so presence on disk is not
        # proof this run produced them. The manifest is the authority: it says
        # whether catalogs were part of this extract at all.
        if ($manifest.catalogsSkipped -and
            $step.entity -in @("category", "product", "warehouse")) {
            Log ("skip {0} (catalogs not part of this extract)" -f $step.file)
            continue
        }

        if (-not (Test-Path $path)) {
            Log ("skip {0} (not extracted)" -f $step.file)
            continue
        }

        # Documents carry their line items inline, so a batch of 500 orders can
        # be tens of thousands of rows of JSON. Smaller batches keep each
        # request well inside the server's body limit.
        $stepBatch = $batchSize
        if ($step.entity -in @("sales_doc", "realization_doc")) {
            $stepBatch = [Math]::Min($batchSize, 100)
        }

        # Snapshot ids for the whole entity type, used by "full" runs to flag
        # records that vanished from 1C. Collected as we stream, sent with the
        # last batch of this type.
        $snapshot = New-Object Collections.Generic.List[string]
        $buffer   = New-Object Collections.Generic.List[object]
        $sent     = 0

        $reader = New-Object IO.StreamReader($path, [Text.Encoding]::UTF8)
        try {
            while ($null -ne ($line = $reader.ReadLine())) {
                if ([string]::IsNullOrWhiteSpace($line)) { continue }
                $rec = $line | ConvertFrom-Json
                $buffer.Add($rec)
                if ($Kind -eq "full" -and $rec.externalId -and
                    ($step.entity -in @("category", "product", "warehouse", "counterparty"))) {
                    $snapshot.Add($rec.externalId)
                }

                if ($buffer.Count -ge $stepBatch) {
                    $seq++
                    $resp = PostSigned "/api/sync-ingest/batch" ([ordered]@{
                        runId      = $runId
                        batchId    = [guid]::NewGuid().ToString()
                        seq        = $seq
                        entityType = $step.entity
                        records    = $buffer.ToArray()
                    })
                    $sent += $buffer.Count
                    $totals.created       += $resp.created
                    $totals.updated       += $resp.updated
                    $totals.skipped       += $resp.skipped
                    $totals.failed        += $resp.failed
                    $totals.discrepancies += $resp.discrepancies
                    if ($resp.errors -and $resp.errors.Count -gt 0) {
                        Log ("  errors: " + ($resp.errors -join "; "))
                    }
                    Log ("  {0}: {1} sent" -f $step.entity, $sent)
                    $buffer.Clear()
                }
            }
        } finally {
            $reader.Close()
        }

        # Final batch of this entity type -- carries the snapshot on full runs.
        # Sent even when empty so "full" can report an entity that lost all rows.
        $seq++
        $payload = [ordered]@{
            runId      = $runId
            batchId    = [guid]::NewGuid().ToString()
            seq        = $seq
            entityType = $step.entity
            records    = $buffer.ToArray()
        }
        # Snapshots only for catalogues. Documents are always read as a date
        # window, never in full, so a snapshot of them would tell the server
        # that every order older than the window has vanished from 1C.
        $snapshotable = @("category", "product", "warehouse", "counterparty")
        if ($Kind -eq "full" -and $snapshot.Count -gt 0 -and ($step.entity -in $snapshotable)) {
            $payload.fullSnapshotIds = $snapshot.ToArray()
        }
        $resp = PostSigned "/api/sync-ingest/batch" $payload
        $sent += $buffer.Count
        $totals.created       += $resp.created
        $totals.updated       += $resp.updated
        $totals.skipped       += $resp.skipped
        $totals.failed        += $resp.failed
        $totals.discrepancies += $resp.discrepancies
        if ($resp.errors -and $resp.errors.Count -gt 0) {
            Log ("  errors: " + ($resp.errors -join "; "))
        }
        if ($step.entity -eq "realization_doc") { $realizationsSent = $sent }
        if ($step.entity -eq "return_doc") { $returnsSent = $sent }
        Log ("{0}: {1} records sent" -f $step.entity, $sent)
    }
}
catch {
    $sendError = $_.Exception.Message
    Log ("FAILED: " + $sendError)
}

# The manifest counts travel to the server so it can alert on best-effort
# queries that were skipped. debtFailed and paymentsFailed are the point: the
# extract swallows those failures to save the rest of the run, the watermark
# moves past the window anyway, and without this the loss is invisible.
$complete = PostSigned ("/api/sync-ingest/runs/" + $runId + "/complete") ([ordered]@{
    status = $(if ($sendError) { "failed" } else { "completed" })
    error  = $sendError
    counts = $manifest.counts
})

Log "----------------------------------------"
Log ("status:        {0}" -f $complete.status)
Log ("created:       {0}" -f $complete.recordsCreated)
Log ("updated:       {0}" -f $complete.recordsUpdated)
Log ("skipped:       {0}" -f $complete.recordsSkipped)
Log ("failed:        {0}" -f $complete.recordsFailed)
Log ("discrepancies: {0}" -f $complete.discrepancies)
if ($complete.missing) { Log ("missing:       {0}" -f $complete.missing) }
Log "----------------------------------------"

# A backfill is finished only once the server has the documents.
#
# extract.ps1 deliberately does not stamp these: it writes the file, and the
# scheduler's next run five minutes later would overwrite that file with an
# empty one before it was ever shipped. Stamping here, after /complete came
# back clean, means a failed or half-sent backfill simply repeats next cycle
# -- upserts are keyed by Ref_Key, so re-sending costs time, not correctness.
if (-not $sendError -and $complete.status -eq "completed") {
    $statePath = Join-Path $scriptDir "state.json"
    $backfills = @(
        @{ flag = "realizationsBackfilledAt"; sent = $realizationsSent; label = "realization" },
        @{ flag = "returnsBackfilledAt";      sent = $returnsSent;      label = "returns"     }
    )
    foreach ($bf in $backfills) {
        if ($bf.sent -le 0) { continue }
        try {
            $state = if (Test-Path $statePath) {
                [IO.File]::ReadAllText($statePath, [Text.Encoding]::UTF8) | ConvertFrom-Json
            } else { $null }

            if ($state -and -not $state.($bf.flag)) {
                $obj = [ordered]@{}
                foreach ($p in $state.PSObject.Properties) { $obj[$p.Name] = $p.Value }
                $obj[$bf.flag] = (Get-Date).ToString("o")
                [IO.File]::WriteAllText(
                    $statePath,
                    ($obj | ConvertTo-Json),
                    (New-Object Text.UTF8Encoding($false))
                )
                Log ("{0} backfill complete ({1} documents) -- switching to the normal window" -f $bf.label, $bf.sent)
            }
        } catch {
            # Losing the stamp only means the next run repeats the backfill.
            Log ("could not stamp " + $bf.flag + ": " + $_.Exception.Message)
        }
    }
}

if ($sendError) { exit 1 }
