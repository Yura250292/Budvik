# -*- coding: utf-8 -*-
"""Генератор probe-costs.ps1: структура Документ.ПрочиеЗатраты і регістру Затраты.

probe-expenses (05.09.2026) довела, що каса в УТ — прохідна: готівка від
покупців 53,4 млн/рік виходить РКО «Прочие расходы денежных средств» 53,5 млн
(здача виручки), власник заносить ~18,8 млн, з яких платять постачальникам
готівкою 18,4 млн, авансові звіти на 3,5 млн — це зарплата за ролями.
Отже витрати за 335 статтями пише Документ.ПрочиеЗатраты (6655 шт з
01.02.2021, регістр Затраты 10 305 рядків з тієї ж дати) — документ,
найпевніше, дописаний програмістом, тож його реквізити й ТЧ невідомі.

Кожен кандидат-реквізит — окремий запит: неіснуючий валить лише себе.
Усі запити — ТІЛЬКИ читання.
"""
import os

def esc(s):
    out, buf, codes = [], "", []
    def flush_buf():
        nonlocal buf
        if buf:
            out.append('"' + buf + '"'); buf = ""
    def flush_codes():
        nonlocal codes
        if codes:
            out.append("(-join [char[]]@(" + ",".join("0x%04x" % c for c in codes) + "))"); codes = []
    for ch in s:
        if ord(ch) < 128 and ch not in '"$`':
            flush_codes(); buf += ch
        else:
            flush_buf(); codes.append(ord(ch))
    flush_buf(); flush_codes()
    return "+".join(out) if out else '""'

SINCE = "ДАТАВРЕМЯ(2025, 9, 1)"
DOC = "Документ"
SPR = "Справочник"
REG = "РегистрНакопления"
PZ = "ПрочиеЗатраты"
PKO = "ПриходныйКассовыйОрдер"
RKO = "РасходныйКассовыйОрдер"

def hdr(label, title, field, cols=2):
    """Чи є реквізит у шапці ПрочиеЗатраты: показуємо 3 значення."""
    return (label, title,
            f"ВЫБРАТЬ ПЕРВЫЕ 3 D.Дата, D.{field} ИЗ {DOC}.{PZ} КАК D ГДЕ D.Проведен", cols, 3)

def tab(label, title, tch, fields):
    return (label, title,
            f"ВЫБРАТЬ ПЕРВЫЕ 3 {', '.join('T.' + f for f in fields)} ИЗ {DOC}.{PZ}.{tch} КАК T", len(fields), 3)

H = "#"

QUERIES = [
    (H, "A. ДОКУМЕНТ ПрочиеЗатраты — шапка"),
    ("pz_span", "A0 всього, від, до (проведені)",
     f"ВЫБРАТЬ КОЛИЧЕСТВО(D.Ссылка), МИНИМУМ(D.Дата), МАКСИМУМ(D.Дата) ИЗ {DOC}.{PZ} КАК D ГДЕ D.Проведен", 3, 1),
    ("pz_by_year", "A1 документів по роках",
     f"ВЫБРАТЬ ГОД(D.Дата), КОЛИЧЕСТВО(D.Ссылка) ИЗ {DOC}.{PZ} КАК D ГДЕ D.Проведен СГРУППИРОВАТЬ ПО ГОД(D.Дата)", 2, 10),
    hdr("pz_sumdoc", "A2 реквізит СуммаДокумента", "СуммаДокумента"),
    hdr("pz_sum", "A3 реквізит Сумма", "Сумма"),
    hdr("pz_item", "A4 реквізит СтатьяЗатрат", "СтатьяЗатрат.Наименование"),
    hdr("pz_org", "A5 реквізит Организация", "Организация.Наименование"),
    hdr("pz_unit", "A6 реквізит Подразделение", "Подразделение.Наименование"),
    hdr("pz_cp", "A7 реквізит Контрагент", "Контрагент.Наименование"),
    hdr("pz_cash", "A8 реквізит Касса", "Касса.Наименование"),
    hdr("pz_person", "A9 реквізит ФизЛицо", "ФизЛицо.Наименование"),
    hdr("pz_resp", "A10 реквізит Ответственный", "Ответственный.Наименование"),
    hdr("pz_comment", "A11 реквізит Комментарий", "Комментарий"),
    hdr("pz_currency", "A12 реквізит ВалютаДокумента", "ВалютаДокумента.Наименование"),
    hdr("pz_ddoc", "A13 реквізит ДокументОснование", "ДокументОснование"),

    (H, "B. ДОКУМЕНТ ПрочиеЗатраты — табличні частини (назва ТЧ × поля)"),
    tab("pz_tch_zatraty", "B1 ТЧ Затраты: СтатьяЗатрат, Сумма", "Затраты", ["СтатьяЗатрат.Наименование", "Сумма"]),
    tab("pz_tch_rashody", "B2 ТЧ Расходы", "Расходы", ["СтатьяЗатрат.Наименование", "Сумма"]),
    tab("pz_tch_prochee", "B3 ТЧ Прочее", "Прочее", ["СтатьяЗатрат.Наименование", "Сумма"]),
    tab("pz_tch_statyi", "B4 ТЧ Статьи", "Статьи", ["СтатьяЗатрат.Наименование", "Сумма"]),
    tab("pz_tch_tovary", "B5 ТЧ Товары", "Товары", ["Номенклатура.Наименование", "Сумма"]),
    tab("pz_tch_uslugi", "B6 ТЧ Услуги", "Услуги", ["Номенклатура.Наименование", "Сумма"]),
    tab("pz_tch_spisok", "B7 ТЧ Список", "Список", ["СтатьяЗатрат.Наименование", "Сумма"]),
    tab("pz_tch_tch1", "B8 ТЧ ТабличнаяЧасть1", "ТабличнаяЧасть1", ["СтатьяЗатрат.Наименование", "Сумма"]),

    (H, "C. РЕГІСТР Затраты — структура (те, що й треба читати обміну)"),
    ("z_sample_a", "C1 зразок рядків: Период, Регистратор, СтатьяЗатрат, Сумма",
     f"ВЫБРАТЬ ПЕРВЫЕ 5 R.Период, R.Регистратор, R.СтатьяЗатрат.Наименование, R.Сумма ИЗ {REG}.Затраты КАК R", 4, 5),
    ("z_sample_b", "C2 зразок: СтатьяЗатрат, СуммаЗатрат",
     f"ВЫБРАТЬ ПЕРВЫЕ 5 R.Период, R.СтатьяЗатрат.Наименование, R.СуммаЗатрат ИЗ {REG}.Затраты КАК R", 3, 5),
    ("z_sample_c", "C3 зразок: Статья, Сумма",
     f"ВЫБРАТЬ ПЕРВЫЕ 5 R.Период, R.Статья.Наименование, R.Сумма ИЗ {REG}.Затраты КАК R", 3, 5),
    ("z_unit", "C4 вимір Подразделение",
     f"ВЫБРАТЬ ПЕРВЫЕ 3 R.Период, R.Подразделение.Наименование ИЗ {REG}.Затраты КАК R", 2, 3),
    ("z_org", "C5 вимір Организация",
     f"ВЫБРАТЬ ПЕРВЫЕ 3 R.Период, R.Организация.Наименование ИЗ {REG}.Затраты КАК R", 2, 3),
    ("z_cp", "C6 вимір Контрагент",
     f"ВЫБРАТЬ ПЕРВЫЕ 3 R.Период, R.Контрагент.Наименование ИЗ {REG}.Затраты КАК R", 2, 3),
    ("z_person", "C7 вимір ФизЛицо",
     f"ВЫБРАТЬ ПЕРВЫЕ 3 R.Период, R.ФизЛицо.Наименование ИЗ {REG}.Затраты КАК R", 2, 3),
    ("z_kind", "C8 ВидДвижения (є = регістр залишків, нема = оборотний)",
     f"ВЫБРАТЬ ПЕРВЫЕ 3 R.Период, R.ВидДвижения ИЗ {REG}.Затраты КАК R", 2, 3),
    ("z_active", "C9 Активность",
     f"ВЫБРАТЬ ПЕРВЫЕ 3 R.Период, R.Активность ИЗ {REG}.Затраты КАК R", 2, 3),
    ("z_regs", "C10 хто пише в регістр: ПрочиеЗатраты / АвансовыйОтчет / OTHER (за рік)",
     f"ВЫБРАТЬ V.T, КОЛИЧЕСТВО(*), СУММА(V.S) ИЗ (ВЫБРАТЬ ВЫБОР "
     f'КОГДА R.Регистратор ССЫЛКА {DOC}.{PZ} ТОГДА "PZ" '
     f'КОГДА R.Регистратор ССЫЛКА {DOC}.АвансовыйОтчет ТОГДА "AO" '
     f'ИНАЧЕ "OTHER" КОНЕЦ КАК T, R.Сумма КАК S ИЗ {REG}.Затраты КАК R ГДЕ R.Период >= {SINCE}) КАК V '
     f"СГРУППИРОВАТЬ ПО V.T", 3, 10),

    (H, "D. ВИТРАТИ ЗА РІК — те, заради чого все"),
    ("z_by_group", "D1 по групах статей (Родитель) за рік",
     f"ВЫБРАТЬ R.СтатьяЗатрат.Родитель.Наименование, КОЛИЧЕСТВО(*) КАК N, СУММА(R.Сумма) КАК S "
     f"ИЗ {REG}.Затраты КАК R ГДЕ R.Период >= {SINCE} СГРУППИРОВАТЬ ПО R.СтатьяЗатрат.Родитель.Наименование УПОРЯДОЧИТЬ ПО S УБЫВ", 3, 40),
    ("z_by_item", "D2 по статтях за рік: топ-60",
     f"ВЫБРАТЬ ПЕРВЫЕ 60 R.СтатьяЗатрат.Наименование, КОЛИЧЕСТВО(*) КАК N, СУММА(R.Сумма) КАК S "
     f"ИЗ {REG}.Затраты КАК R ГДЕ R.Период >= {SINCE} СГРУППИРОВАТЬ ПО R.СтатьяЗатрат.Наименование УПОРЯДОЧИТЬ ПО S УБЫВ", 3, 60),
    ("z_by_month", "D3 по місяцях за рік",
     f"ВЫБРАТЬ НАЧАЛОПЕРИОДА(R.Период, МЕСЯЦ), КОЛИЧЕСТВО(*), СУММА(R.Сумма) "
     f"ИЗ {REG}.Затраты КАК R ГДЕ R.Период >= {SINCE} СГРУППИРОВАТЬ ПО НАЧАЛОПЕРИОДА(R.Период, МЕСЯЦ)", 3, 14),
    ("z_by_year", "D4 по роках за весь час",
     f"ВЫБРАТЬ ГОД(R.Период), КОЛИЧЕСТВО(*), СУММА(R.Сумма) ИЗ {REG}.Затраты КАК R СГРУППИРОВАТЬ ПО ГОД(R.Период)", 3, 10),
    ("z_turnover_vt", "D5 те саме через віртуальну таблицю Обороты (якщо C1 не пройшло)",
     f"ВЫБРАТЬ O.СтатьяЗатрат.Родитель.Наименование, СУММА(O.СуммаОборот) ИЗ {REG}.Затраты.Обороты({SINCE}, , , ) КАК O "
     f"СГРУППИРОВАТЬ ПО O.СтатьяЗатрат.Родитель.Наименование", 2, 40),

    (H, "E. ЩО ЛИШИЛОСЬ ПО КАСІ"),
    ("pko_by_contract", "E1 оплати покупця за рік по назві договору (чи заносять банк як ПКО)",
     f"ВЫБРАТЬ ПЕРВЫЕ 12 D.ДоговорКонтрагента.Наименование, КОЛИЧЕСТВО(D.Ссылка) КАК N, СУММА(D.СуммаДокумента) КАК S "
     f"ИЗ {DOC}.{PKO} КАК D ГДЕ D.Проведен И D.Дата >= {SINCE} "
     f"И D.ВидОперации = ЗНАЧЕНИЕ(Перечисление.ВидыОперацийПКО.ОплатаПокупателя) "
     f"СГРУППИРОВАТЬ ПО D.ДоговорКонтрагента.Наименование УПОРЯДОЧИТЬ ПО S УБЫВ", 3, 12),
    ("pko_present", "E2 види операцій ПКО через ПРЕДСТАВЛЕНИЕ (перевірка функції)",
     f"ВЫБРАТЬ ПРЕДСТАВЛЕНИЕ(D.ВидОперации), КОЛИЧЕСТВО(D.Ссылка), СУММА(D.СуммаДокумента) ИЗ {DOC}.{PKO} КАК D "
     f"ГДЕ D.Проведен И D.Дата >= {SINCE} СГРУППИРОВАТЬ ПО D.ВидОперации", 3, 10),
    ("rko_present", "E3 види операцій РКО через ПРЕДСТАВЛЕНИЕ",
     f"ВЫБРАТЬ ПРЕДСТАВЛЕНИЕ(D.ВидОперации), КОЛИЧЕСТВО(D.Ссылка), СУММА(D.СуммаДокумента) ИЗ {DOC}.{RKO} КАК D "
     f"ГДЕ D.Проведен И D.Дата >= {SINCE} СГРУППИРОВАТЬ ПО D.ВидОперации", 3, 10),
    ("pko_other_dds", "E4 ПКО не-оплата-покупця за рік: по статті ДДС з ТЧ",
     f"ВЫБРАТЬ T.СтатьяДвиженияДенежныхСредств.Наименование, КОЛИЧЕСТВО(*), СУММА(T.СуммаПлатежа) "
     f"ИЗ {DOC}.{PKO}.РасшифровкаПлатежа КАК T ГДЕ T.Ссылка.Проведен И T.Ссылка.Дата >= {SINCE} "
     f"И T.Ссылка.ВидОперации <> ЗНАЧЕНИЕ(Перечисление.ВидыОперацийПКО.ОплатаПокупателя) "
     f"СГРУППИРОВАТЬ ПО T.СтатьяДвиженияДенежныхСредств.Наименование", 3, 10),
    ("rko_other_cp_type", "E5 РКО «прочие»: тип одержувача — ФизическиеЛица?",
     f"ВЫБРАТЬ КОЛИЧЕСТВО(D.Ссылка), СУММА(D.СуммаДокумента) ИЗ {DOC}.{RKO} КАК D "
     f"ГДЕ D.Проведен И D.Дата >= {SINCE} И D.Контрагент ССЫЛКА {SPR}.ФизическиеЛица", 2, 1),
    ("rko_other_cp_org", "E6 РКО «прочие»: тип одержувача — Организации?",
     f"ВЫБРАТЬ КОЛИЧЕСТВО(D.Ссылка), СУММА(D.СуммаДокумента) ИЗ {DOC}.{RKO} КАК D "
     f"ГДЕ D.Проведен И D.Дата >= {SINCE} И D.Контрагент ССЫЛКА {SPR}.Организации", 2, 1),
    ("rko_other_comment", "E7 РКО за рік: топ-20 коментарів (без фільтра по контрагенту)",
     f"ВЫБРАТЬ ПЕРВЫЕ 20 D.Комментарий, КОЛИЧЕСТВО(D.Ссылка) КАК N, СУММА(D.СуммаДокумента) КАК S ИЗ {DOC}.{RKO} КАК D "
     f"ГДЕ D.Проведен И D.Дата >= {SINCE} СГРУППИРОВАТЬ ПО D.Комментарий УПОРЯДОЧИТЬ ПО S УБЫВ", 3, 20),
]

HEAD = r'''# Probe: structure of Dokument.ProchieZatraty and the Zatraty register --
# the place where the 335 cost items are actually booked -- plus the last
# open questions about the cash desk.
#
# Follow-up to probe-expenses.ps1 (05.09.2026). READ ONLY.
#
# Run in 32-bit PowerShell on the 1C server (avoid 20:00-20:30 Kyiv):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-costs.ps1 > \\tsclient\Downloads\probe-costs.out.txt 2>&1
#
# ASCII-only source; Cyrillic is built from char codes (see gen-probe-costs.py).

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

here = os.path.dirname(os.path.abspath(__file__))
for out in [os.path.join(here, "probe-costs.ps1"), os.path.expanduser("~/Downloads/probe-costs.ps1")]:
    open(out, "w", encoding="ascii", newline="\r\n").write(ps)
    print("написано", out, len(ps), "байт")
print("запитів:", sum(1 for e in QUERIES if e[0] != H))
