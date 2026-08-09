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
$plan = @(
    @{ file = "category.ndjson";  entity = "category"  },
    @{ file = "product.ndjson";   entity = "product"   },
    @{ file = "warehouse.ndjson"; entity = "warehouse" },
    @{ file = "price.ndjson";     entity = "price"     },
    @{ file = "stock.ndjson";     entity = "stock"     }
)

$totals = [ordered]@{ created = 0; updated = 0; skipped = 0; failed = 0; discrepancies = 0 }
$seq = 0
$sendError = $null

try {
    foreach ($step in $plan) {
        $path = Join-Path $OutDir $step.file
        if (-not (Test-Path $path)) {
            Log ("skip {0} (not extracted)" -f $step.file)
            continue
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
                if ($Kind -eq "full" -and $rec.externalId) { $snapshot.Add($rec.externalId) }

                if ($buffer.Count -ge $batchSize) {
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
        if ($Kind -eq "full" -and $snapshot.Count -gt 0) {
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
        Log ("{0}: {1} records sent" -f $step.entity, $sent)
    }
}
catch {
    $sendError = $_.Exception.Message
    Log ("FAILED: " + $sendError)
}

$complete = PostSigned ("/api/sync-ingest/runs/" + $runId + "/complete") ([ordered]@{
    status = $(if ($sendError) { "failed" } else { "completed" })
    error  = $sendError
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

if ($sendError) { exit 1 }
