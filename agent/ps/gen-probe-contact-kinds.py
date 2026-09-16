# -*- coding: utf-8 -*-
"""Генератор probe-contact-kinds.ps1: види й типи контактної інформації 1С.

Навіщо. Канал counterparty_contact читає РегистрСведений.КонтактнаяИнформация,
а вид контакту на сайті виводить із ПРЕДСТАВЛЕНИЕ(Тип) і ПРЕДСТАВЛЕНИЕ(Вид)
(src/lib/contacts/kinds.ts). Проба probe-contacts.ps1 (25.08.2026) порахувала
види по ВСІХ об'єктах регістру разом — організаціях, кандидатах, фізособах.
Тут — окремо по контрагентах і контактних особах, плюс те, чого бракує для
рішень: чи лежать кілька номерів в одному рядку, чи є в регістрі окремі поля
номера й пошти, скільки часу займає сам запит каналу в тому вигляді, як він
стоїть у queries.json (секція H бере рядок саме звідти).

Кожен кандидат-реквізит — окремий запит: неіснуючий валить лише себе.
Усі запити — ТІЛЬКИ читання.
"""
import json
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


with open(os.path.join(here, "queries.json"), encoding="utf-8") as f:
    CONTACTS_QUERY = json.load(f)["contacts"]

REG = "РегистрСведений.КонтактнаяИнформация"
CP = "Справочник.Контрагенты"
IS_CP = f"K.Объект ССЫЛКА {CP}"
PHONE_TYPE = "ЗНАЧЕНИЕ(Перечисление.ТипыКонтактнойИнформации.Телефон)"
H = "#"


def kinds_for(label, title, catalog, maxrows=40):
    return (label, title,
            f"ВЫБРАТЬ ПРЕДСТАВЛЕНИЕ(K.Тип) КАК TIP, ПРЕДСТАВЛЕНИЕ(K.Вид) КАК VID, КОЛИЧЕСТВО(*) КАК N, "
            f"КОЛИЧЕСТВО(РАЗЛИЧНЫЕ K.Объект) КАК OBJ ИЗ {REG} КАК K ГДЕ K.Объект ССЫЛКА Справочник.{catalog} "
            f"СГРУППИРОВАТЬ ПО K.Тип, K.Вид УПОРЯДОЧИТЬ ПО N УБЫВ", 4, maxrows)


def cat_field(label, title, catalog, field):
    """Чи є реквізит у довіднику контактних осіб: 5 значень поруч із посиланням."""
    return (label, title, f"ВЫБРАТЬ ПЕРВЫЕ 5 C.Ссылка, C.{field} ИЗ Справочник.{catalog} КАК C", 2, 5)


def reg_field(label, title, field):
    """Чи є поле в регістрі: 3 значення поруч із Представлением."""
    return (label, title,
            f"ВЫБРАТЬ ПЕРВЫЕ 3 K.Представление, K.{field} ИЗ {REG} КАК K ГДЕ {IS_CP}", 2, 3)


def reg_filled(label, title, field):
    """Скільки рядків контрагентів мають поле непорожнім. ПОДСТРОКА — бо рядок
    необмеженої довжини порівнювати напряму 1С не дає."""
    return (label, title,
            f'ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ {REG} КАК K ГДЕ {IS_CP} И ПОДСТРОКА(K.{field}, 1, 200) <> ""', 1, 1)


def sep_count(label, title, sep):
    return (label, title,
            f"ВЫБРАТЬ ПРЕДСТАВЛЕНИЕ(K.Тип), КОЛИЧЕСТВО(*) ИЗ {REG} КАК K ГДЕ {IS_CP} "
            f'И ПОДСТРОКА(K.Представление, 1, 300) ПОДОБНО "%{sep}%" СГРУППИРОВАТЬ ПО K.Тип', 2, 10)


PHONES_PER_CP = (f"ВЫБРАТЬ K.Объект КАК O, КОЛИЧЕСТВО(*) КАК N ИЗ {REG} КАК K "
                 f"ГДЕ {IS_CP} И K.Тип = {PHONE_TYPE} СГРУППИРОВАТЬ ПО K.Объект")
PHONES_PER_CP_BY_NAME = (f"ВЫБРАТЬ K.Объект КАК O, КОЛИЧЕСТВО(*) КАК N ИЗ {REG} КАК K "
                         f'ГДЕ {IS_CP} И K.Вид.Наименование ПОДОБНО "%елефон%" СГРУППИРОВАТЬ ПО K.Объект')

QUERIES = [
    (H, "A. КОНТРАГЕНТИ: Тип x Вид"),
    ("cp_total", "A0 рядків і різних контрагентів у регістрі",
     f"ВЫБРАТЬ КОЛИЧЕСТВО(*), КОЛИЧЕСТВО(РАЗЛИЧНЫЕ K.Объект) ИЗ {REG} КАК K ГДЕ {IS_CP}", 2, 1),
    kinds_for("cp_kinds", "A1 Тип | Вид | рядків | контрагентів", "Контрагенты", 60),

    (H, "B. КОНТАКТНІ ОСОБИ: Тип x Вид (яка з назв довідника існує)"),
    kinds_for("cl_kinds", "B1 Справочник.КонтактныеЛица", "КонтактныеЛица"),
    kinds_for("clk_kinds", "B2 Справочник.КонтактныеЛицаКонтрагентов", "КонтактныеЛицаКонтрагентов"),
    kinds_for("fl_kinds", "B3 Справочник.ФизическиеЛица (для порівняння: види «Телефон физ.лица»)", "ФизическиеЛица"),

    (H, "C. ДОВІДНИК КОНТАКТНИХ ОСІБ: реквізити (кожен окремо)"),
    ("cl_count", "C1 КонтактныеЛица: скільки всього",
     "ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ Справочник.КонтактныеЛица КАК C", 1, 1),
    cat_field("cl_owner", "C2 КонтактныеЛица.Владелец", "КонтактныеЛица", "Владелец"),
    cat_field("cl_objowner", "C3 КонтактныеЛица.ОбъектВладелец", "КонтактныеЛица", "ОбъектВладелец"),
    cat_field("cl_name", "C4 КонтактныеЛица.Наименование", "КонтактныеЛица", "Наименование"),
    cat_field("cl_position", "C5 КонтактныеЛица.Должность", "КонтактныеЛица", "Должность"),
    ("cl_owner_cp", "C6 КонтактныеЛица, де Владелец — контрагент",
     f"ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ Справочник.КонтактныеЛица КАК C ГДЕ C.Владелец ССЫЛКА {CP}", 1, 1),
    ("cl_objowner_cp", "C7 КонтактныеЛица, де ОбъектВладелец — контрагент",
     f"ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ Справочник.КонтактныеЛица КАК C ГДЕ C.ОбъектВладелец ССЫЛКА {CP}", 1, 1),
    ("clk_count", "C8 КонтактныеЛицаКонтрагентов: скільки всього",
     "ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ Справочник.КонтактныеЛицаКонтрагентов КАК C", 1, 1),
    cat_field("clk_owner", "C9 КонтактныеЛицаКонтрагентов.Владелец", "КонтактныеЛицаКонтрагентов", "Владелец"),
    cat_field("clk_name", "C10 КонтактныеЛицаКонтрагентов.Наименование", "КонтактныеЛицаКонтрагентов", "Наименование"),
    cat_field("clk_position", "C11 КонтактныеЛицаКонтрагентов.Должность", "КонтактныеЛицаКонтрагентов", "Должность"),

    (H, "D. РЕГІСТР: окремі поля номера, пошти, коментаря (кожне окремо)"),
    reg_field("f_phone", "D1 поле НомерТелефона", "НомерТелефона"),
    reg_field("f_email", "D2 поле АдресЭП", "АдресЭП"),
    reg_field("f_comment", "D3 поле Комментарий", "Комментарий"),
    reg_field("f_pole1", "D4 поле Поле1", "Поле1"),
    reg_filled("f_comment_n", "D5 Комментарий непорожній (рядків контрагентів)", "Комментарий"),
    reg_filled("f_pole1_n", "D6 Поле1 непорожнє (рядків контрагентів)", "Поле1"),

    (H, "E. КОНТРАГЕНТИ З КІЛЬКОМА ТЕЛЕФОННИМИ РЯДКАМИ"),
    ("multi_by_type", "E1 телефонних рядків на контрагента -> скільки контрагентів (тип = Телефон)",
     f"ВЫБРАТЬ T.N, КОЛИЧЕСТВО(*) ИЗ ({PHONES_PER_CP}) КАК T СГРУППИРОВАТЬ ПО T.N УПОРЯДОЧИТЬ ПО T.N", 2, 10),
    ("multi_by_name", "E2 те саме за назвою виду (якщо E1 упав на назві перелічення)",
     f"ВЫБРАТЬ T.N, КОЛИЧЕСТВО(*) ИЗ ({PHONES_PER_CP_BY_NAME}) КАК T СГРУППИРОВАТЬ ПО T.N УПОРЯДОЧИТЬ ПО T.N", 2, 10),
    ("multi_sample", "E3 10 контрагентів із 2+ телефонними рядками",
     f"ВЫБРАТЬ ПЕРВЫЕ 10 T.O, T.N ИЗ ({PHONES_PER_CP_BY_NAME}) КАК T ГДЕ T.N >= 2", 2, 10),

    (H, "F. КІЛЬКА НОМЕРІВ В ОДНОМУ РЯДКУ: роздільники , ; /"),
    sep_count("sep_comma", "F1 кома, по типах (в адресах кома — норма)", ","),
    sep_count("sep_semicolon", "F2 крапка з комою, по типах", ";"),
    sep_count("sep_slash", "F3 слеш, по типах", "/"),
    ("sep_sample", "F4 15 телефонних рядків із роздільником",
     f"ВЫБРАТЬ ПЕРВЫЕ 15 K.Объект, K.Представление ИЗ {REG} КАК K ГДЕ {IS_CP} "
     f'И K.Вид.Наименование ПОДОБНО "%елефон%" И (ПОДСТРОКА(K.Представление, 1, 300) ПОДОБНО "%,%" '
     f'ИЛИ ПОДСТРОКА(K.Представление, 1, 300) ПОДОБНО "%;%" ИЛИ ПОДСТРОКА(K.Представление, 1, 300) ПОДОБНО "%/%")', 2, 15),

    (H, "G. ЗРАЗОК: 20 рядків контрагентів"),
    ("sample", "G1 Объект | Тип | Вид | Представление",
     f"ВЫБРАТЬ ПЕРВЫЕ 20 K.Объект, ПРЕДСТАВЛЕНИЕ(K.Тип), ПРЕДСТАВЛЕНИЕ(K.Вид), K.Представление ИЗ {REG} КАК K ГДЕ {IS_CP}", 4, 20),

    (H, "H. ЗАПИТ КАНАЛУ contacts РІВНО ЯК У queries.json: чи виконується і скільки триває"),
    ("contacts_query", "H1 повний запит (показано 5 рядків, rows = усього)", CONTACTS_QUERY, 4, 5),
]

HEAD = r'''# Probe: kinds and types of contact information for counterparties and
# contact persons, multi-number rows, spare register fields, and the timing of
# the counterparty_contact channel query exactly as queries.json holds it.
#
# Follow-up to probe-contacts.ps1 (25.08.2026), which counted kinds over the
# whole register at once. READ ONLY -- every statement below is a SELECT.
#
# Run in 32-bit PowerShell on the 1C server (avoid 20:00-20:30 Kyiv):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-contact-kinds.ps1 > \\tsclient\Downloads\probe-contact-kinds.out.txt 2>&1
#
# ASCII-only source; Cyrillic is built from char codes (see gen-probe-contact-kinds.py).

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

for out in [os.path.join(here, "probe-contact-kinds.ps1"), os.path.expanduser("~/Downloads/probe-contact-kinds.ps1")]:
    with open(out, "w", encoding="ascii", newline="\r\n") as f:
        f.write(ps)
    print("написано", out, len(ps), "байт")
print("запитів:", sum(1 for e in QUERIES if e[0] != H))
