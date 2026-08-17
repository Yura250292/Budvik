# Діагностика: чи заповнені в 1С артикули номенклатури.
#
# Запускати В ПАПЦІ АГЕНТА на сервері 1С:
#
#   powershell -ExecutionPolicy Bypass -File probe-skus.ps1
#
# Node.js не потрібен — усе робить сам PowerShell.
# Нічого не змінює: лише читає довідник (GET) і рахує статистику.
# URL і облікові дані беруться з config.json, що лежить поруч.

param(
    [string]$ConfigPath = "$PSScriptRoot\config.json",
    [string]$Password
)

$ErrorActionPreference = "Stop"
# 1С часто публікується під самопідписаним сертифікатом і віддає кирилицю.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not (Test-Path $ConfigPath)) {
    Write-Host "Не знайшов config.json: $ConfigPath" -ForegroundColor Red
    Write-Host "Вкажи шлях явно:  .\probe-skus.ps1 -ConfigPath C:\шлях\config.json"
    exit 1
}

$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$baseUrl = ($cfg.odata.baseUrl -replace '/$', '')
$user = $cfg.odata.username
$entity = if ($cfg.entities.products) { $cfg.entities.products } else { "Catalog_Номенклатура" }

# Пароль може бути записаний як "env:ІМЯ" — читаємо змінну середовища.
$pass = $cfg.odata.password
if ($Password) {
    $pass = $Password
} elseif ($pass -like "env:*") {
    $varName = $pass.Substring(4)
    $pass = [Environment]::GetEnvironmentVariable($varName)
    if (-not $pass) {
        Write-Host "Пароль у конфігу вказано як env:$varName, але змінної нема." -ForegroundColor Yellow
        Write-Host "Передай пароль напряму:"
        Write-Host "    .\probe-skus.ps1 -Password 'пароль'"
        Write-Host "Якщо пароль забувся — його зберігає служба, подивитись можна так:"
        Write-Host "    .\install\nssm.exe get BudvikSyncAgent AppEnvironmentExtra"
        exit 1
    }
}

$pair = [Text.Encoding]::UTF8.GetBytes("${user}:${pass}")
$headers = @{
    Authorization = "Basic " + [Convert]::ToBase64String($pair)
    Accept        = "application/json"
}

Write-Host "База: $baseUrl"
Write-Host "Довідник: $entity`n"

$skip = 0
$goods = 0; $withArtikul = 0; $onlyCode = 0; $empty = 0
$examplesFilled = New-Object System.Collections.ArrayList
$examplesEmpty = New-Object System.Collections.ArrayList
$fieldsShown = $false

try {
    while ($true) {
        # $select навмисно не вказуємо: поле артикула в різних конфігураціях
        # зветься по-різному, і жорсткий $select впав би замість того,
        # щоб показати, що там насправді.
        # Одинарні лапки, щоб $format/$skip/$top не підставились як змінні
        # PowerShell — це частина синтаксису OData.
        $query = '?$format=json&$skip=' + $skip + '&$top=1000'
        $url = $baseUrl + '/' + $entity + $query
        $resp = Invoke-RestMethod -Uri $url -Headers $headers -Method Get -TimeoutSec 300
        $rows = $resp.value
        if (-not $rows -or $rows.Count -eq 0) { break }

        foreach ($r in $rows) {
            if ($r.IsFolder) { continue }
            $goods++

            if (-not $fieldsShown) {
                $names = ($r.PSObject.Properties.Name) -join ", "
                Write-Host "Поля довідника: $names`n" -ForegroundColor DarkGray
                $fieldsShown = $true
            }

            $art = "$($r.'Артикул')".Trim()
            if (-not $art) { $art = "$($r.'Артикль')".Trim() }
            $code = "$($r.Code)".Trim()
            if (-not $code) { $code = "$($r.'Код')".Trim() }
            $name = "$($r.Description)".Trim()
            if (-not $name) { $name = "$($r.'Наименование')".Trim() }
            if ($name.Length -gt 55) { $name = $name.Substring(0, 55) }

            if ($art) {
                $withArtikul++
                if ($examplesFilled.Count -lt 10) {
                    [void]$examplesFilled.Add("  Артикул=`"$art`"  Code=`"$code`"  | $name")
                }
            } elseif ($code) {
                $onlyCode++
                if ($examplesFilled.Count -lt 10) {
                    [void]$examplesFilled.Add("  Артикул=—  Code=`"$code`"  | $name")
                }
            } else {
                $empty++
                if ($examplesEmpty.Count -lt 10) {
                    [void]$examplesEmpty.Add("  порожньо | $name")
                }
            }
        }

        $skip += $rows.Count
        Write-Host -NoNewline "`rпрочитано: $skip"
        if ($rows.Count -lt 1000) { break }
    }
}
catch {
    Write-Host "`n`nПомилка запиту: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Перевір, що 1С опублікована й доступна за адресою $baseUrl"
    exit 1
}

function Pct($n) {
    if ($goods -eq 0) { return "0%" }
    return "{0:N1}%" -f ($n / $goods * 100)
}

Write-Host "`n`n=== Номенклатура (без груп): $goods ==="
Write-Host "  мають Артикул:         $withArtikul  ($(Pct $withArtikul))"
Write-Host "  Артикула нема, є Code: $onlyCode  ($(Pct $onlyCode))"
Write-Host "  порожні обидва:        $empty  ($(Pct $empty))"

if ($examplesFilled.Count -gt 0) {
    Write-Host "`nПриклади заповнених:"
    $examplesFilled | ForEach-Object { Write-Host $_ }
}
if ($examplesEmpty.Count -gt 0) {
    Write-Host "`nПриклади порожніх:"
    $examplesEmpty | ForEach-Object { Write-Host $_ }
}

if (($withArtikul + $onlyCode) -gt 0) {
    Write-Host "`n[OK] Артикули в 1С Є — після виправленої синхронізації вони підтягнуться на сайт." -ForegroundColor Green
} else {
    Write-Host "`n[!] У 1С артикули порожні — доведеться вивантажувати з Impuls." -ForegroundColor Yellow
}
