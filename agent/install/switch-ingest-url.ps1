<#
  Перемикає агента 1С на іншу адресу приймача даних.

  УВАГА ПРО КОДУВАННЯ: цей файл мусить лишатися UTF-8 З BOM.
  Windows PowerShell 5.1 читає .ps1 без BOM як ANSI (CP1251 на цьому сервері),
  і вся кирилиця нижче перетворюється на кашу, яка ламає синтаксис ще до
  запуску. Решта скриптів агента BOM не мають лише тому, що написані
  латиницею. Не «виправляйте» кодування редактором.

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

Say ("Машина: " + $env:COMPUTERNAME)

if (-not $ConfigPath) {
    # Найнадійніше джерело — робоча папка самого завдання планувальника:
    # саме звідти агент читає конфіг щоп'ять хвилин. Ім'я завдання шукаємо
    # за підрядком: воно могло бути зареєстроване інакше або в підпапці.
    try {
        $tasks = Get-ScheduledTask -ErrorAction Stop | Where-Object {
            $_.TaskName -match 'udvik' -or
            (($_.Actions | ForEach-Object { [string]$_.Arguments + [string]$_.WorkingDirectory }) -match 'udvik')
        }
        foreach ($t in $tasks) {
            Say ("  завдання: " + $t.TaskPath + $t.TaskName)
            foreach ($a in $t.Actions) {
                foreach ($dir in @($a.WorkingDirectory)) {
                    if ($dir) {
                        $candidate = Join-Path $dir "config.json"
                        if ((Test-Path $candidate) -and -not $ConfigPath) { $ConfigPath = $candidate }
                    }
                }
                # Робоча папка могла бути не задана — тоді беремо шлях
                # зі -File у аргументах.
                if (-not $ConfigPath -and $a.Arguments -match '-File\s+"?([^"]+\.ps1)"?') {
                    $candidate = Join-Path (Split-Path -Parent $Matches[1]) "config.json"
                    if (Test-Path $candidate) { $ConfigPath = $candidate }
                }
            }
        }
        if (-not $tasks) { Warn "  завдань зі словом Budvik у планувальнику не видно (можливо, потрібні права адміністратора)" }
    } catch {
        Warn ("  планувальник недоступний: " + $_.Exception.Message)
    }
}

if (-not $ConfigPath) {
    foreach ($guess in @(
        "C:\budvik-agent\config.json", "C:\budvik-agent\ps\config.json",
        "C:\budvik\config.json",       "C:\budvik\ps\config.json",
        "D:\budvik-agent\config.json", "D:\budvik-agent\ps\config.json",
        "C:\1c-agent\config.json",     "C:\agent\config.json"
    )) {
        if (Test-Path $guess) { $ConfigPath = $guess; break }
    }
}

if (-not $ConfigPath) {
    # Остання спроба — знайти сам агент на диску за його скриптом. Повільно,
    # тому лише якщо все інше не спрацювало.
    Say ""
    Say "Шукаю агент на дисках (це може зайняти хвилину)..."
    $drives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
              Where-Object { $_.Free -ne $null -and $_.Name.Length -eq 1 }
    foreach ($d in $drives) {
        $found = Get-ChildItem -Path ($d.Name + ":\") -Filter "extract.ps1" -Recurse -File `
                 -ErrorAction SilentlyContinue | Select-Object -First 3
        foreach ($f in $found) {
            $candidate = Join-Path $f.DirectoryName "config.json"
            Say ("  знайдено: " + $f.FullName)
            if ((Test-Path $candidate) -and -not $ConfigPath) { $ConfigPath = $candidate }
        }
        if ($ConfigPath) { break }
    }
}

if (-not $ConfigPath -or -not (Test-Path $ConfigPath)) {
    Warn ""
    Warn "Не знайшов config.json на цій машині."
    Warn "Ймовірно, ви підключені не до того сервера, де стоїть агент 1С,"
    Warn "або агент лежить у нетиповому місці."
    Warn ""
    Warn "Знайти вручну:  Get-ChildItem C:\ -Filter config.json -Recurse -ErrorAction SilentlyContinue | Select FullName"
    Warn "Потім:          -ConfigPath <знайдений шлях>"
    throw "Перемикання скасовано."
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
