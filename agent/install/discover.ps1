# Розвідка сервера 1С перед розгортанням агента синхронізації.
#
# Скрипт ЛИШЕ читає: перелічує служби, публікації IIS і робить GET-запити до
# OData. Нічого не встановлює, не змінює й не пише в 1С.
#
# Запуск на сервері 1С у PowerShell:
#   powershell -ExecutionPolicy Bypass -File discover.ps1
#
# Вивід цілком скопіювати й надіслати розробнику.

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

function Section($title) {
    Write-Host ""
    Write-Host ("=" * 60)
    Write-Host $title
    Write-Host ("=" * 60)
}

function Note($text) { Write-Host "  $text" }

Write-Host "РОЗВІДКА СЕРВЕРА 1С"
Write-Host "Час: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Комп'ютер: $env:COMPUTERNAME"
Write-Host "Користувач: $env:USERNAME"

# --- Windows ------------------------------------------------------------
Section "1. СИСТЕМА"
try {
    $os = Get-CimInstance Win32_OperatingSystem
    Note "ОС: $($os.Caption) $($os.Version)"
    Note "Розрядність: $($os.OSArchitecture)"
    Note "ОЗП: $([math]::Round($os.TotalVisibleMemorySize / 1MB, 1)) ГБ"
} catch {
    Note "Не вдалося прочитати відомості про ОС: $_"
}

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Note "Права адміністратора: $(if ($isAdmin) { 'ТАК' } else { 'НІ — частина перевірок може не спрацювати' })"

# --- Платформа 1С -------------------------------------------------------
Section "2. ПЛАТФОРМА 1С"

$platformDirs = @(
    "C:\Program Files\1cv8",
    "C:\Program Files (x86)\1cv8"
) | Where-Object { Test-Path $_ }

if (-not $platformDirs) {
    Note "Каталог платформи не знайдено у стандартних місцях."
} else {
    foreach ($dir in $platformDirs) {
        Note "Каталог: $dir"
        Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^\d+\.\d+\.\d+' } |
            ForEach-Object { Note "  версія $($_.Name)" }
    }
}

Note ""
Note "Служби 1С:"
$srv1c = Get-Service -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '1C|1cv8' -or $_.DisplayName -match '1C|1С' }
if ($srv1c) {
    $srv1c | ForEach-Object { Note "  [$($_.Status)] $($_.Name) — $($_.DisplayName)" }
    Note ""
    Note "Наявність служби агента (1C:Enterprise Server) означає КЛІЄНТ-СЕРВЕРНИЙ режим."
} else {
    Note "  Служб 1С не знайдено → найімовірніше ФАЙЛОВИЙ режим бази."
}

# --- Бази 1С ------------------------------------------------------------
Section "3. БАЗИ 1С"

$listPaths = @(
    "$env:APPDATA\1C\1CEStart\ibases.v8i",
    "$env:USERPROFILE\AppData\Roaming\1C\1CEStart\ibases.v8i",
    "C:\ProgramData\1C\1CEStart\ibases.v8i"
) | Where-Object { Test-Path $_ } | Select-Object -Unique

if (-not $listPaths) {
    Note "Список баз (ibases.v8i) не знайдено."
} else {
    foreach ($p in $listPaths) {
        Note "Файл: $p"
        Get-Content $p -Encoding UTF8 -ErrorAction SilentlyContinue |
            Where-Object { $_ -match '^\[|Connect=' } |
            ForEach-Object { Note "  $_" }
    }
}

Note ""
Note "Пошук файлових баз (1Cv8.1CD) на локальних дисках — може зайняти хвилину..."
Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
    Where-Object { $_.Used -gt 0 } |
    ForEach-Object {
        Get-ChildItem "$($_.Root)" -Filter "1Cv8.1CD" -Recurse -Depth 4 `
            -ErrorAction SilentlyContinue -Force |
            ForEach-Object {
                Note "  $($_.FullName)  ($([math]::Round($_.Length / 1GB, 2)) ГБ)"
            }
    }

# --- MS SQL -------------------------------------------------------------
Section "4. MS SQL SERVER"
$sqlSrv = Get-Service -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^MSSQL' }
if ($sqlSrv) {
    $sqlSrv | ForEach-Object { Note "[$($_.Status)] $($_.Name) — $($_.DisplayName)" }
    Note ""
    Note "Бази на локальному екземплярі:"
    try {
        $q = "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4"
        $out = & sqlcmd -S localhost -E -h -1 -W -Q $q 2>&1
        $out | ForEach-Object { if ("$_".Trim()) { Note "  $_" } }
    } catch {
        Note "  sqlcmd недоступний або немає прав: $_"
    }
} else {
    Note "Служб MS SQL не знайдено → база 1С файлова або SQL на іншому сервері."
}

# --- Веб-сервер ---------------------------------------------------------
Section "5. ВЕБ-СЕРВЕР І ПУБЛІКАЦІЇ"

$iis = Get-Service W3SVC -ErrorAction SilentlyContinue
if ($iis) {
    Note "IIS (W3SVC): $($iis.Status)"
} else {
    Note "IIS не встановлений."
}

$apache = Get-Service -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'Apache' }
if ($apache) { $apache | ForEach-Object { Note "Apache: [$($_.Status)] $($_.Name)" } }

Note ""
Note "Публікації 1С (файли default.vrd):"
$vrdFound = $false
@("C:\inetpub\wwwroot", "C:\Program Files\Apache*", "C:\Apache*") |
    ForEach-Object {
        Get-ChildItem $_ -Filter "default.vrd" -Recurse -Depth 3 `
            -ErrorAction SilentlyContinue |
            ForEach-Object {
                $script:vrdFound = $true
                Note ""
                Note "  Файл: $($_.FullName)"
                $xml = Get-Content $_.FullName -Raw -Encoding UTF8
                if ($xml -match 'base="([^"]+)"') { Note "    base (адреса): $($Matches[1])" }
                if ($xml -match 'ib="([^"]+)"') {
                    # У рядку підключення може бути пароль — маскуємо.
                    $ib = $Matches[1] -replace 'Pwd=[^;]*', 'Pwd=***'
                    Note "    ib (база): $ib"
                }
                $odataOn = $xml -match 'enableStandardOData="true"'
                Note "    OData увімкнено: $(if ($odataOn) { 'ТАК' } else { 'НІ' })"
            }
    }
if (-not $vrdFound) { Note "  Публікацій не знайдено." }

if ($iis) {
    Note ""
    Note "Застосунки IIS:"
    try {
        Import-Module WebAdministration -ErrorAction Stop
        Get-WebApplication | ForEach-Object {
            Note "  $($_.Path) → $($_.PhysicalPath)"
        }
        Get-Website | ForEach-Object {
            Note "  сайт '$($_.Name)' [$($_.State)] прив'язки: $($_.Bindings.Collection.bindingInformation -join ', ')"
        }
    } catch {
        Note "  Модуль WebAdministration недоступний: $_"
    }
}

# --- Перевірка OData ----------------------------------------------------
Section "6. ПЕРЕВІРКА ODATA"

$candidates = @()
Get-ChildItem "C:\inetpub\wwwroot" -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { $candidates += $_.Name }
if (-not $candidates) { $candidates = @("budvik", "trade", "base", "ut", "unf", "bas") }

Note "Перевіряю адреси (без автентифікації — очікується 401, це ДОБРА ознака):"
foreach ($name in ($candidates | Select-Object -Unique)) {
    $url = "http://localhost/$name/odata/standard.odata/`$metadata"
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 `
             -ErrorAction Stop
        Note "  [$($r.StatusCode)] $url  ← ВІДПОВІДАЄ БЕЗ ПАРОЛЯ"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 401) {
            Note "  [401] $url  ← ODATA Є, потрібен логін/пароль"
        } elseif ($code) {
            Note "  [$code] $url"
        } else {
            Note "  [--] $url  (немає відповіді)"
        }
    }
}

Note ""
Note "Якщо жодна адреса не дала 401 — OData не опублікований."
Note "Це вмикається в Конфігураторі: Адміністрування → Публікація на веб-сервері"
Note "→ галочка «Публікувати стандартний інтерфейс OData»."

# --- Node.js ------------------------------------------------------------
Section "7. NODE.JS"
try {
    $nodeVersion = & node --version 2>&1
    Note "node: $nodeVersion"
    Note "npm:  $(& npm --version 2>&1)"
    if ($nodeVersion -match 'v(\d+)') {
        $major = [int]$Matches[1]
        if ($major -lt 20) { Note "УВАГА: потрібна версія 20 або новіша." }
    }
} catch {
    Note "Node.js не встановлений. Потрібен Node.js 20 LTS — https://nodejs.org"
}

# --- Вихідний HTTPS -----------------------------------------------------
Section "8. ВИХІДНИЙ ЗВ'ЯЗОК"
Note "Агент надсилає дані на сайт по HTTPS (443). Перевірка:"
try {
    $r = Invoke-WebRequest -Uri "https://budvik.up.railway.app/api/sync-ingest/health" `
         -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
    Note "  [$($r.StatusCode)] сайт відповідає — вихідний HTTPS працює"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code) {
        Note "  [$code] сайт відповів — вихідний HTTPS працює"
    } else {
        Note "  Немає відповіді: $($_.Exception.Message)"
        Note "  Можлива причина: проксі, фаєрвол або антивірус."
    }
}

$proxy = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" `
         -ErrorAction SilentlyContinue
if ($proxy.ProxyEnable -eq 1) { Note "  Проксі увімкнено: $($proxy.ProxyServer)" }

# --- Підсумок -----------------------------------------------------------
Section "ГОТОВО"
Write-Host ""
Write-Host "Скопіюйте ВЕСЬ вивід вище і надішліть розробнику."
Write-Host ""
Write-Host "Щоб зберегти у файл, запустіть так:"
Write-Host "  powershell -ExecutionPolicy Bypass -File discover.ps1 > C:\rozvidka.txt 2>&1"
Write-Host ""
