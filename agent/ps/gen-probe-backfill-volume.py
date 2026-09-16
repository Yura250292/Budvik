# -*- coding: utf-8 -*-
"""Генератор probe-backfill-volume.ps1: скільки важить історія реалізацій 2024–2025.

Навіщо. Реалізації на сайті є з 2026-01-01 (documents.realizationsFrom), а
для порівняння рік до року й сезонності потрібні 2024 і 2025. Перш ніж
відсувати дату бекфілу, треба знати ціну: скільки документів і рядків поїде
через обмін, скільки товарів уже помічені на видалення (рядки з ними сервер
не зіставить), скільки різних менеджерів доведеться зіставляти з торговими,
скільки документів висить на видалених контрагентах, чи покриє собівартість
ці роки і скільки номерів повторюється між роками (номер 1С унікальний лише
в межах року, а на сайті — глобально).

Кожен рік і кожне питання — окремий запит: упалий валить лише себе.
Дати — літералами ДАТАВРЕМЯ(...), без параметрів.
Усі запити — ТІЛЬКИ читання.
"""
import os

here = os.path.dirname(os.path.abspath(__file__))


def esc(s):
    out, buf, codes = [], "", []

    def flush_buf():
        nonlocal buf
        if buf:
            out.append('"' + buf + '"')
            buf = ""

    def flush_codes():
        nonlocal codes
        if codes:
            out.append("(-join [char[]]@(" + ",".join("0x%04x" % c for c in codes) + "))")
            codes = []

    for ch in s:
        if ord(ch) < 128 and ch not in '"$`':
            flush_codes()
            buf += ch
        else:
            flush_buf()
            codes.append(ord(ch))
    flush_buf()
    flush_codes()
    return "+".join(out) if out else '""'


DOC = "Документ.РеализацияТоваровУслуг"
COST = "РегистрНакопления.ПродажиСебестоимость"
H = "#"


def dt(y):
    return f"ДАТАВРЕМЯ({y}, 1, 1)"


def year_block(y):
    lo, hi = dt(y), dt(y + 1)
    in_year = f"D.Дата >= {lo} И D.Дата < {hi}"
    lines_in_year = f"T.Ссылка.Проведен И T.Ссылка.Дата >= {lo} И T.Ссылка.Дата < {hi}"
    cost_in_year = f"S.Период >= {lo} И S.Период < {hi} И S.Регистратор ССЫЛКА {DOC}"
    return [
        (H, f"{y}: РЕАЛІЗАЦІЇ"),
        (f"r{y}_posted", f"{y}.0 проведені й непроведені: кількість, сума",
         f"ВЫБРАТЬ D.Проведен, КОЛИЧЕСТВО(D.Ссылка), СУММА(D.СуммаДокумента) ИЗ {DOC} КАК D "
         f"ГДЕ {in_year} СГРУППИРОВАТЬ ПО D.Проведен", 3, 2),
        (f"r{y}_month", f"{y}.1 проведені по місяцях: місяць | кількість | сума",
         f"ВЫБРАТЬ МЕСЯЦ(D.Дата) КАК M, КОЛИЧЕСТВО(D.Ссылка) КАК N, СУММА(D.СуммаДокумента) КАК S "
         f"ИЗ {DOC} КАК D ГДЕ D.Проведен И {in_year} СГРУППИРОВАТЬ ПО МЕСЯЦ(D.Дата) УПОРЯДОЧИТЬ ПО M", 3, 12),
        (f"r{y}_lines", f"{y}.2 рядків табличної частини Товары",
         f"ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ {DOC}.Товары КАК T ГДЕ {lines_in_year}", 1, 1),
        (f"r{y}_products", f"{y}.3 різних товарів у рядках",
         f"ВЫБРАТЬ КОЛИЧЕСТВО(РАЗЛИЧНЫЕ T.Номенклатура) ИЗ {DOC}.Товары КАК T ГДЕ {lines_in_year}", 1, 1),
        (f"r{y}_products_deleted", f"{y}.4 з них помічених на видалення",
         f"ВЫБРАТЬ КОЛИЧЕСТВО(РАЗЛИЧНЫЕ T.Номенклатура) ИЗ {DOC}.Товары КАК T "
         f"ГДЕ {lines_in_year} И T.Номенклатура.ПометкаУдаления", 1, 1),
        (f"r{y}_managers", f"{y}.5 менеджери: ім'я | документів | сума",
         f"ВЫБРАТЬ D.Менеджер.Наименование КАК M, КОЛИЧЕСТВО(D.Ссылка) КАК N, СУММА(D.СуммаДокумента) КАК S "
         f"ИЗ {DOC} КАК D ГДЕ D.Проведен И {in_year} "
         f"СГРУППИРОВАТЬ ПО D.Менеджер.Наименование УПОРЯДОЧИТЬ ПО N УБЫВ", 3, 80),
        (f"r{y}_cp_deleted", f"{y}.6 документи на контрагентах, помічених на видалення: документів | сума | контрагентів",
         f"ВЫБРАТЬ КОЛИЧЕСТВО(D.Ссылка), СУММА(D.СуммаДокумента), КОЛИЧЕСТВО(РАЗЛИЧНЫЕ D.Контрагент) "
         f"ИЗ {DOC} КАК D ГДЕ D.Проведен И {in_year} И D.Контрагент.ПометкаУдаления", 3, 1),
        (f"r{y}_cost", f"{y}.7 ПродажиСебестоимость по реалізаціях: рядків | документів | вартість",
         f"ВЫБРАТЬ КОЛИЧЕСТВО(*), КОЛИЧЕСТВО(РАЗЛИЧНЫЕ S.Регистратор), СУММА(S.Стоимость) "
         f"ИЗ {COST} КАК S ГДЕ {cost_in_year}", 3, 1),
        (f"r{y}_cost_grouped", f"{y}.8 те саме, згруповане як в агенті (документ x товар)",
         f"ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ (ВЫБРАТЬ S.Регистратор КАК R, S.Номенклатура КАК P ИЗ {COST} КАК S "
         f"ГДЕ {cost_in_year} СГРУППИРОВАТЬ ПО S.Регистратор, S.Номенклатура) КАК G", 1, 1),
    ]


def pair(label, title, y1, y2, sample=False):
    """Номери, які є і в році y1, і в році y2. Псевдоніми латинські A/B:
    кирилична «В» зарезервована під оператор В(...)."""
    cond = (f"A.Дата >= {dt(y1)} И A.Дата < {dt(y1 + 1)} И B.Дата >= {dt(y2)} И B.Дата < {dt(y2 + 1)}")
    join = f"ИЗ {DOC} КАК A ВНУТРЕННЕЕ СОЕДИНЕНИЕ {DOC} КАК B ПО A.Номер = B.Номер ГДЕ {cond}"
    if sample:
        return (label, title, f"ВЫБРАТЬ ПЕРВЫЕ 10 A.Номер, A.Дата, B.Дата {join}", 3, 10)
    return (label, title, f"ВЫБРАТЬ КОЛИЧЕСТВО(*) {join}", 1, 1)


QUERIES = [
    (H, "0. КОНТЕКСТ: 2023"),
    ("r2023_posted", "0.1 реалізації 2023: проведені й непроведені, кількість, сума",
     f"ВЫБРАТЬ D.Проведен, КОЛИЧЕСТВО(D.Ссылка), СУММА(D.СуммаДокумента) ИЗ {DOC} КАК D "
     f"ГДЕ D.Дата >= {dt(2023)} И D.Дата < {dt(2024)} СГРУППИРОВАТЬ ПО D.Проведен", 3, 2),
    *year_block(2024),
    *year_block(2025),
    (H, "X. НОМЕРИ, ЩО ПОВТОРЮЮТЬСЯ МІЖ РОКАМИ"),
    ("num_multi_year", "X1 номерів, що трапляються в 2+ роках від 2023",
     f"ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ (ВЫБРАТЬ D.Номер КАК NUM, КОЛИЧЕСТВО(РАЗЛИЧНЫЕ ГОД(D.Дата)) КАК Y "
     f"ИЗ {DOC} КАК D ГДЕ D.Дата >= {dt(2023)} СГРУППИРОВАТЬ ПО D.Номер) КАК T ГДЕ T.Y > 1", 1, 1),
    pair("num_2024_2025", "X2 пар «той самий номер» 2024 і 2025", 2024, 2025),
    pair("num_2025_2026", "X3 пар «той самий номер» 2025 і 2026", 2025, 2026),
    pair("num_2024_2026", "X4 пар «той самий номер» 2024 і 2026", 2024, 2026),
    pair("num_sample", "X5 зразок: номер | дата 2024 | дата 2025", 2024, 2025, sample=True),
]

HEAD = r'''# Probe: volume of a 2024-2025 realization backfill -- documents and sums per
# month, tabular lines, products (and how many are deletion-marked), managers,
# documents on deletion-marked counterparties, cost-of-sales rows, and document
# numbers that repeat across years.
#
# Sizing only, before documents.realizationsFrom is moved back. READ ONLY --
# every statement below is a SELECT.
#
# Run in 32-bit PowerShell on the 1C server (avoid 20:00-20:30 Kyiv; the
# yearly scans are the heaviest queries we run, so prefer the morning):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-backfill-volume.ps1 > \\tsclient\Downloads\probe-backfill-volume.out.txt 2>&1
#
# ASCII-only source; Cyrillic is built from char codes (see gen-probe-backfill-volume.py).

$ErrorActionPreference = "Continue"

$candidates = @()
if ($PSScriptRoot) { $candidates += (Join-Path $PSScriptRoot "config.json") }
$candidates += "C:\Users\fedyshyn\budvik-agent\config.json"
$candidates += "C:\Users\fedyshyn\budvik-agent\ps\config.json"
$candidates += "C:\budvik-agent\config.json"
$configPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $configPath) { throw "config.json not found in: $($candidates -join '; ')" }
Write-Host ("config: " + $configPath)
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json

$NAIM = ([char]0x041D+[char]0x0430+[char]0x0438+[char]0x043C+[char]0x0435+[char]0x043D+[char]0x043E+[char]0x0432+[char]0x0430+[char]0x043D+[char]0x0438+[char]0x0435)

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    [string]$config.oneC.server, [string]$config.oneC.base, [string]$config.oneC.user, [string]$config.oneC.password
$ib = $conn.Connect($cs)
Write-Host ("CONNECTED to " + [string]$config.oneC.base + " -- READ ONLY")
Write-Host ("started " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host ""

function Show($v) {
    if ($null -eq $v) { return "<null>" }
    if ($v -is [datetime]) { return $v.ToString("yyyy-MM-dd") }
    $s = [string]$v
    if ($s -ne "System.__ComObject") { return $s }
    try {
        $p = $v.$NAIM
        if ($null -ne $p) {
            $ps = [string]$p
            if ($ps -and $ps -ne "System.__ComObject") { return $ps }
        }
    } catch { }
    try { return ("<ref " + [string]$ib.XMLString($v) + ">") } catch { }
    return "<ref>"
}

function Probe($label, $queryText, $cols, $maxRows) {
    if (-not $maxRows) { $maxRows = 40 }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queryText
        $rs = $q.Execute()
        if ($null -eq $rs) { Write-Host ("  -- {0}: Execute returned null" -f $label); return }
        $r = $rs.Choose()
        $n = 0
        $lines = @()
        while ($r.Next()) {
            $n++
            if ($n -le $maxRows) {
                $parts = @()
                for ($i = 0; $i -lt $cols; $i++) { $parts += (Show $r.Get($i)) }
                $lines += ("       " + ($parts -join " | "))
            }
        }
        Write-Host ("  OK {0}   rows={1}   {2:N1}s" -f $label, $n, $sw.Elapsed.TotalSeconds)
        $lines | ForEach-Object { Write-Host $_ }
        if ($n -gt $maxRows) { Write-Host ("       ... {0} more rows not shown" -f ($n - $maxRows)) }
    }
    catch {
        Write-Host ("  -- {0}: {1}" -f $label, $_.Exception.Message)
    }
    Write-Host ""
}
'''

TAIL = r'''
Write-Host ("finished " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host "Nothing was written to 1C."
'''

parts = [HEAD]
for entry in QUERIES:
    if entry[0] == H:
        parts.append('Write-Host ""')
        parts.append('Write-Host ("=== "+%s+" ===")' % esc(entry[1]))
        parts.append('Write-Host ""')
        continue
    label, title, text, cols, maxrows = entry
    parts.append('Write-Host ("-- "+%s)' % esc(title.replace('"', "'")))
    parts.append("Probe %s (%s) %d %d\n" % (esc(label), esc(text), cols, maxrows))
parts.append(TAIL)
ps = "\n".join(parts)
assert all(ord(c) < 128 for c in ps), "у скрипті лишилися не-ASCII символи"

for out in [os.path.join(here, "probe-backfill-volume.ps1"), os.path.expanduser("~/Downloads/probe-backfill-volume.ps1")]:
    with open(out, "w", encoding="ascii", newline="\r\n") as f:
        f.write(ps)
    print("написано", out, len(ps), "байт")
print("запитів:", sum(1 for e in QUERIES if e[0] != H))
