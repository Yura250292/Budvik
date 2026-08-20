<#
  Перемикає агента 1С на іншу адресу приймача даних.

  Навіщо окремий скрипт, а не «відкрити config.json і поправити рядок»:
  правка руками в RDP — це шанс зіпсувати кодування (файл UTF-8 з кирилицею
  в коментарях) або мовчки залишити невірний секрет і виявити це вже на
  бойовому прогоні. Тут спершу перевіряється зв'язок і підпис, і лише потім
  торкається файл.

  Запуск на сервері 1С (PowerShell від імені того ж користувача, під яким
  працює завдання планувальника):

      powershell -ExecutionPolicy Bypass -File switch-ingest-url.ps1

  Повернутись на сайт (відкат):

      powershell -ExecutionPolicy Bypass -File switch-ingest-url.ps1 -Url https://www.budvik27.com
#>

param(
    # Куди перемикати. Типово — воркер обміну на Railway.
    [string] $Url = "https://budvik-sync-worker-production.up.railway.app",
    # Шлях до config.json. Якщо не вказано — шукається автоматично.
    [string] $ConfigPath
)

$ErrorActionPreference = "Stop"

# TLS 1.2 не є типовим на Windows Server + PS5 для вихідних викликів;
# без цього рядка будь-який HTTPS-запит падає ще на рукостисканні.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Say($msg)  { Write-Host $msg }
function Good($msg) { Write-Host $msg -ForegroundColor Green }
function Warn($msg) { Write-Host $msg -ForegroundColor Yellow }

# ---------------------------------------------------------------- пошук ----

if (-not $ConfigPath) {
    # Найнадійніше джерело — робоча папка самого завдання планувальника:
    # саме звідти агент читає конфіг щоп'ять хвилин.
    try {
        $task = Get-ScheduledTask -TaskName "BudvikSyncLight" -ErrorAction Stop
        $dir  = $task.Actions[0].WorkingDirectory
        if ($dir) {
            $candidate = Join-Path $dir "config.json"
            if (Test-Path $candidate) { $ConfigPath = $candidate }
        }
    } catch {
        Warn "Завдання BudvikSyncLight не знайдено — шукаю конфіг у типових місцях."
    }
}

if (-not $ConfigPath) {
    foreach ($guess in @("C:\budvik-agent\config.json", "C:\budvik-agent\ps\config.json")) {
        if (Test-Path $guess) { $ConfigPath = $guess; break }
    }
}

if (-not $ConfigPath -or -not (Test-Path $ConfigPath)) {
    throw "Не знайшов config.json. Запустіть ще раз, вказавши шлях: -ConfigPath C:\шлях\до\config.json"
}

Say ("Конфіг: " + $ConfigPath)

# ------------------------------------------------------------- поточний ----

$raw = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8)

# У конфізі рівно один ключ "url" — усередині ingest. Якщо колись зʼявиться
# другий, краще зупинитись, ніж навмання переписати не той.
$urlHits = [regex]::Matches($raw, '"url"\s*:\s*"([^"]*)"')
if ($urlHits.Count -ne 1) {
    throw ("Очікував один ключ `"url`" у config.json, знайшов " + $urlHits.Count + ". Поправте вручну.")
}

$current = $urlHits[0].Groups[1].Value
$target  = $Url.TrimEnd("/")

Say ("Зараз:  " + $current)
Say ("Стане:  " + $target)

if ($current -eq $target) {
    Good "Адреса вже така — міняти нічого."
    exit 0
}

# ------------------------------------------------------- перевірка звʼязку --

$config  = $raw | ConvertFrom-Json
$agentId = $config.ingest.agentId
$secret  = $config.ingest.agentSecret

if ([string]::IsNullOrWhiteSpace($secret)) { throw "ingest.agentSecret порожній у config.json" }

Say ""
Say "Перевіряю звʼязок і підпис із новою адресою..."

$hmac = New-Object Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)

# GET /health підписується з порожнім тілом — так само, як це робить send.ps1.
$ts        = [string][int][double]::Parse((Get-Date -Date (Get-Date).ToUniversalTime() -UFormat %s))
$signBytes = [Text.Encoding]::UTF8.GetBytes($ts + "." + "")
$sig       = -join ($hmac.ComputeHash($signBytes) | ForEach-Object { $_.ToString("x2") })

try {
    $health = Invoke-RestMethod -Method Get -Uri ($target + "/api/sync-ingest/health") `
              -Headers @{
                  "x-sync-agent"     = $agentId
                  "x-sync-timestamp" = $ts
                  "x-sync-signature" = $sig
              } -TimeoutSec 60
} catch {
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode } catch { }
    Warn ""
    Warn "НЕ ВДАЛОСЯ достукатись до нової адреси. Конфіг НЕ змінено."
    if ($status -eq 403) {
        Warn "  403 — не збігається agentSecret. Звірте секрет із тим, що заведено на воркері."
    } elseif ($status -eq 401) {
        Warn "  401 — розійшовся годинник сервера (допустимо ±5 хв) або немає заголовків."
    } elseif ($status) {
        Warn ("  HTTP " + $status)
    } else {
        Warn ("  " + $_.Exception.Message)
    }
    throw "Перемикання скасовано."
}

Good ("  Звʼязок є. Час сервера: " + $health.serverTime)
if ($health.lastRun) {
    Say ("  Останній прогін у базі: " + $health.lastRun.runId + " (" + $health.lastRun.status + ")")
}

# ------------------------------------------------------------------ запис --

$backup = $ConfigPath + ".bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
Copy-Item $ConfigPath $backup
Say ""
Say ("Резервна копія: " + $backup)

# Точкова заміна рядка, а не перезбирання JSON: ConvertTo-Json у PS5 екранує
# кирилицю в \uXXXX і перетворює коментарі конфігу на нечитабельні.
$updated = $raw.Remove($urlHits[0].Groups[1].Index, $urlHits[0].Groups[1].Length).Insert($urlHits[0].Groups[1].Index, $target)

# UTF-8 без BOM — так само, як файл виглядав досі.
[IO.File]::WriteAllText($ConfigPath, $updated, (New-Object Text.UTF8Encoding($false)))

# Перечитуємо з диска й перевіряємо, що вийшов валідний JSON із потрібним значенням.
$check = ([IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8) | ConvertFrom-Json)
if ($check.ingest.url -ne $target) {
    Copy-Item $backup $ConfigPath -Force
    throw "Перевірка після запису не зійшлася — конфіг повернуто з резервної копії."
}

Good ""
Good "Готово. Агент тепер надсилає дані на:"
Good ("  " + $target)
Say ""
Say "Найближчий прогін планувальника (до 5 хвилин) піде вже туди."
Say "Перевірити зараз:  Start-ScheduledTask -TaskName BudvikSyncLight"
Say ("Відкотити:         powershell -ExecutionPolicy Bypass -File switch-ingest-url.ps1 -Url " + $current)
