<#
.SYNOPSIS
    Видаляє службу агента синхронізації 1С.

.DESCRIPTION
    Дані агента (config.json, state.db, outbox, logs) НЕ видаляються —
    їх можна прибрати вручну після того, як переконаєтесь, що черга порожня.
#>

[CmdletBinding()]
param(
    [string]$ServiceName = "BudvikSyncAgent",
    [string]$NssmPath = ""
)

$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Запустіть PowerShell від імені адміністратора."
}

if (-not $NssmPath) {
    $found = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($found) { $NssmPath = $found.Source }
    elseif (Test-Path (Join-Path $PSScriptRoot "nssm.exe")) { $NssmPath = Join-Path $PSScriptRoot "nssm.exe" }
    else { throw "nssm.exe не знайдено." }
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Host "Служби $ServiceName не існує." -ForegroundColor Yellow
    return
}

# Попередження про недоставлені дані.
$outbox = Join-Path (Split-Path -Parent $PSScriptRoot) "outbox"
if (Test-Path $outbox) {
    $pending = @(Get-ChildItem $outbox -Filter *.json -ErrorAction SilentlyContinue).Count
    if ($pending -gt 0) {
        Write-Host "УВАГА: у черзі лишилось $pending недоставлених батчів." -ForegroundColor Red
        Write-Host "Вони доїдуть, якщо службу встановити знову. Видалення папки outbox їх втратить." -ForegroundColor Red
    }
}

if ($service.Status -eq "Running") {
    & $NssmPath stop $ServiceName | Out-Null
    Start-Sleep -Seconds 3
}
& $NssmPath remove $ServiceName confirm | Out-Null

Write-Host "Службу $ServiceName видалено. Файли агента збережено." -ForegroundColor Green
