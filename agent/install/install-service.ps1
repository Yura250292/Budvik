<#
.SYNOPSIS
    Встановлює агент синхронізації 1С як службу Windows (через nssm).

.DESCRIPTION
    Запускати від імені адміністратора на сервері, де працює 1С.
    Перед запуском переконайтеся, що:
      * встановлено Node.js 20 LTS (node --version);
      * поруч лежить заповнений config.json;
      * зібрано dist\agent.mjs (npm run build) або є папка node_modules для запуску з src.

.PARAMETER ServiceName
    Ім'я служби. За замовчуванням BudvikSyncAgent.

.PARAMETER NssmPath
    Шлях до nssm.exe. Якщо не задано — шукається в PATH і в папці install\.

.EXAMPLE
    .\install-service.ps1
    .\install-service.ps1 -ServiceName BudvikSyncTest
#>

[CmdletBinding()]
param(
    [string]$ServiceName = "BudvikSyncAgent",
    [string]$NssmPath = ""
)

$ErrorActionPreference = "Stop"

# --- Перевірка прав адміністратора ---
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Запустіть PowerShell від імені адміністратора."
}

$agentRoot = Split-Path -Parent $PSScriptRoot
$entryPoint = Join-Path $agentRoot "dist\agent.mjs"
$configFile = Join-Path $agentRoot "config.json"
$logDir     = Join-Path $agentRoot "logs"

# --- Перевірка передумов ---
if (-not (Test-Path $entryPoint)) {
    throw "Не знайдено $entryPoint. Виконайте `npm install; npm run build` у папці agent."
}
if (-not (Test-Path $configFile)) {
    throw "Не знайдено $configFile. Скопіюйте config.example.json у config.json і заповніть."
}

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
    throw "Node.js не знайдено в PATH. Встановіть Node.js 20 LTS."
}
Write-Host "Node.js: $($node.Source)" -ForegroundColor Green

# --- Пошук nssm ---
if (-not $NssmPath) {
    $found = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($found) {
        $NssmPath = $found.Source
    } elseif (Test-Path (Join-Path $PSScriptRoot "nssm.exe")) {
        $NssmPath = Join-Path $PSScriptRoot "nssm.exe"
    } else {
        throw "nssm.exe не знайдено. Завантажте з https://nssm.cc/download і покладіть у папку install\ або в PATH."
    }
}
Write-Host "nssm: $NssmPath" -ForegroundColor Green

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# --- Видалення попередньої версії служби ---
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Служба $ServiceName уже існує — перевстановлюємо..." -ForegroundColor Yellow
    if ($existing.Status -eq "Running") {
        & $NssmPath stop $ServiceName | Out-Null
        Start-Sleep -Seconds 3
    }
    & $NssmPath remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 2
}

# --- Встановлення ---
& $NssmPath install $ServiceName $node.Source $entryPoint
& $NssmPath set $ServiceName AppDirectory $agentRoot
& $NssmPath set $ServiceName DisplayName "Budvik — синхронізація з 1С"
& $NssmPath set $ServiceName Description "Читає дані з 1С (тільки на читання) і передає їх на сайт Budvik."
& $NssmPath set $ServiceName Start SERVICE_AUTO_START

# Журнали stdout/stderr — дублюють файловий лог агента, корисні при падінні на старті.
& $NssmPath set $ServiceName AppStdout (Join-Path $logDir "service-out.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $logDir "service-err.log")
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760

# Автоперезапуск: агент має пережити тимчасову недоступність 1С чи мережі.
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppRestartDelay 30000
# Зупинка: даємо 15 с на коректне завершення поточного циклу.
& $NssmPath set $ServiceName AppStopMethodConsole 15000

Write-Host ""
Write-Host "Службу $ServiceName встановлено." -ForegroundColor Green
Write-Host ""
Write-Host "ВАЖЛИВО: якщо в config.json використано значення виду 'env:ІМЯ'," -ForegroundColor Yellow
Write-Host "задайте ці змінні для служби, наприклад:" -ForegroundColor Yellow
Write-Host "  & '$NssmPath' set $ServiceName AppEnvironmentExtra SYNC_AGENT_SECRET=... ODATA_PASSWORD=..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Запуск:     Start-Service $ServiceName" -ForegroundColor Cyan
Write-Host "Стан:       Get-Service $ServiceName" -ForegroundColor Cyan
Write-Host "Журнал:     Get-Content '$logDir\agent.log' -Tail 50 -Wait" -ForegroundColor Cyan
Write-Host ""
Write-Host "Спершу перевірте разовий сухий прогін БЕЗ служби:" -ForegroundColor Cyan
Write-Host "  node '$entryPoint' --once --preview" -ForegroundColor Cyan
