# -*- coding: utf-8 -*-
"""Генератор probe-stock-orphans.ps1: кирилиця в PS5 живе лише як [char]-коди.

Питання, на яке відповідає проба
--------------------------------
На сайті 923 активні товари показують залишок (19 226 шт на 3,6 млн ₴ за
прайсом), але жодного разу не траплялися в регістрі «ТоварыНаСкладах», який
читає агент. Два пояснення дають протилежні рішення:

  1. Товар РОЗПРОДАНИЙ у нуль. Регістр віддає лише ненульові рядки, тож
     позиція просто зникла з вивантаження, а число на сайті застигло.
     → правильно обнулити залишок на сайті.

  2. Товар возять ПІД ЗАМОВЛЕННЯ, на склад він не лягає взагалі.
     → обнуляти не можна: зникне 3,6 млн ₴ асортименту, який реально
       продається. Потрібен окремий стан «під замовлення».

Розрізняє їх не залишок, а ОБОРОТИ: якщо за рік у регістрі був прихід —
товар через склад проходив і зараз просто скінчився (випадок 1). Якщо
приходу немає, а продажі є — він на склад не потрапляє (випадок 2).
"""

def esc(s):
    out, buf = [], ""
    for ch in s:
        if ord(ch) < 128 and ch != '"':
            buf += ch
        else:
            if buf:
                out.append('"' + buf + '"'); buf = ""
            out.append("[char]0x%04x" % ord(ch) if ch != '"' else '[char]0x0022')
    if buf:
        out.append('"' + buf + '"')
    return "+".join(out) if out else '""'

# П'ять зразків із тих 923: найбільший «фантомний» залишок і продажі за
# останні 45 днів — тобто найгірший випадок, якщо їх мовчки обнулити.
SKUS = ["GR-17318", "551156", "551151", "L2003-10", "551182"]
IN_LIST = ", ".join('"%s"' % s for s in SKUS)

# Рік історії: менше — і сезонний товар виглядав би «таким, що не рухається».
FROM_D = "ДАТАВРЕМЯ(2025, 8, 1)"
TO_D = "ДАТАВРЕМЯ(2026, 12, 31)"

REG = "РегистрНакопления"
STOCK = "ТоварыНаСкладах"

QUERIES = [
    ("reg_total", "Q0 КОНТРОЛЬ: скільки взагалі позицій у регістрі залишків (сайт бачить 6289)",
     f'ВЫБРАТЬ КОЛИЧЕСТВО(РАЗЛИЧНЫЕ О.Номенклатура), СУММА(О.КоличествоОстаток) '
     f'ИЗ {REG}.{STOCK}.Остатки КАК О', 2, 1),

    ("nom_exists", "Q1: чи є ці артикули в номенклатурі (артикул | назва | помітка видалення)",
     f'ВЫБРАТЬ N.Артикул, N.Наименование, N.ПометкаУдаления '
     f'ИЗ Справочник.Номенклатура КАК N ГДЕ N.Артикул В ({IN_LIST})', 3, 20),

    ("balance_now", "Q2: залишок ЗАРАЗ у ТоварыНаСкладах (очікуємо порожньо — саме тому їх і немає в обміні)",
     f'ВЫБРАТЬ О.Номенклатура.Артикул, О.Склад.Наименование, О.КоличествоОстаток '
     f'ИЗ {REG}.{STOCK}.Остатки(, Номенклатура.Артикул В ({IN_LIST})) КАК О', 3, 40),

    ("turnover_year", "Q3 ГОЛОВНЕ: обороти за рік (артикул | склад | поч. | ПРИХІД | розхід | кін.)",
     f'ВЫБРАТЬ О.Номенклатура.Артикул, О.Склад.Наименование, О.КоличествоНачальныйОстаток, '
     f'О.КоличествоПриход, О.КоличествоРасход, О.КоличествоКонечныйОстаток '
     f'ИЗ {REG}.{STOCK}.ОстаткиИОбороты({FROM_D}, {TO_D}, , , '
     f'Номенклатура.Артикул В ({IN_LIST})) КАК О', 6, 40),

    ("sales_docs", "Q4: як їх продавали (дата | номер | склад | артикул | к-сть)",
     f'ВЫБРАТЬ ПЕРВЫЕ 20 Т.Ссылка.Дата, Т.Ссылка.Номер, Т.Ссылка.Склад, Т.Номенклатура.Артикул, Т.Количество '
     f'ИЗ Документ.РеализацияТоваровУслуг.Товары КАК Т '
     f'ГДЕ Т.Номенклатура.Артикул В ({IN_LIST}) И Т.Ссылка.Проведен '
     f'УПОРЯДОЧИТЬ ПО Т.Ссылка.Дата УБЫВ', 5, 20),

    ("receipt_docs", "Q5: чи приходили вони на склад (дата | номер | склад | артикул | к-сть)",
     f'ВЫБРАТЬ ПЕРВЫЕ 20 Т.Ссылка.Дата, Т.Ссылка.Номер, Т.Ссылка.Склад, Т.Номенклатура.Артикул, Т.Количество '
     f'ИЗ Документ.ПоступлениеТоваровУслуг.Товары КАК Т '
     f'ГДЕ Т.Номенклатура.Артикул В ({IN_LIST}) И Т.Ссылка.Проведен '
     f'УПОРЯДОЧИТЬ ПО Т.Ссылка.Дата УБЫВ', 5, 20),

    # Якщо товар лежить в іншому регістрі — обнуляти не можна, треба читати ще й той.
    ("alt_reserve", "Q6: а може вони в резерві (ТоварыВРезервеНаСкладах)",
     f'ВЫБРАТЬ О.Номенклатура.Артикул, О.КоличествоОстаток '
     f'ИЗ {REG}.ТоварыВРезервеНаСкладах.Остатки(, Номенклатура.Артикул В ({IN_LIST})) КАК О', 2, 20),

    ("alt_org", "Q7: а може в обліку по організаціях (ТоварыОрганизаций)",
     f'ВЫБРАТЬ О.Номенклатура.Артикул, О.КоличествоОстаток '
     f'ИЗ {REG}.ТоварыОрганизаций.Остатки(, Номенклатура.Артикул В ({IN_LIST})) КАК О', 2, 20),

    ("alt_transit", "Q8: а може в дорозі (ТоварыВПутиНаСклады)",
     f'ВЫБРАТЬ О.Номенклатура.Артикул, О.КоличествоОстаток '
     f'ИЗ {REG}.ТоварыВПутиНаСклады.Остатки(, Номенклатура.Артикул В ({IN_LIST})) КАК О', 2, 20),

    ("alt_toget", "Q9: а може очікуються (ТоварыКПолучению)",
     f'ВЫБРАТЬ О.Номенклатура.Артикул, О.КоличествоОстаток '
     f'ИЗ {REG}.ТоварыКПолучению.Остатки(, Номенклатура.Артикул В ({IN_LIST})) КАК О', 2, 20),

    ("scale", "Q10 МАСШТАБ: скільки позицій продавалися цього року, але залишку зараз не мають",
     f'ВЫБРАТЬ КОЛИЧЕСТВО(РАЗЛИЧНЫЕ Т.Номенклатура), 1 '
     f'ИЗ Документ.РеализацияТоваровУслуг.Товары КАК Т '
     f'ЛЕВОЕ СОЕДИНЕНИЕ {REG}.{STOCK}.Остатки КАК О ПО О.Номенклатура = Т.Номенклатура '
     f'ГДЕ Т.Ссылка.Проведен И Т.Ссылка.Дата >= ДАТАВРЕМЯ(2026, 1, 1) И О.Номенклатура ЕСТЬ NULL', 2, 1),
]

HEAD = r'''# Probe: 923 products show stock on the site but never appear in the
# TovaryNaSkladah register that the agent reads. Sold out, or never stocked?
#
# READ ONLY -- only SELECT queries, nothing is written to 1C.
#
# Run in 32-bit PowerShell on the 1C server:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-stock-orphans.ps1 > \\tsclient\Downloads\probe-stock-orphans.out.txt 2>&1
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1,
# so every Cyrillic string is built from [char] codes.

$ErrorActionPreference = "Continue"

$candidates = @()
if ($PSScriptRoot) { $candidates += (Join-Path $PSScriptRoot "config.json") }
$candidates += "C:\Users\fedyshyn\budvik-agent\config.json"
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
Write-Host "CONNECTED"
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
    return "<ref>"
}

function Probe($label, $queryText, $cols, $maxRows) {
    if (-not $maxRows) { $maxRows = 40 }
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
        Write-Host ("  OK {0}   rows={1}" -f $label, $n)
        $lines | ForEach-Object { Write-Host $_ }
    }
    catch {
        Write-Host ("  -- {0}: {1}" -f $label, $_.Exception.Message)
    }
    Write-Host ""
}
'''

parts = [HEAD]
for label, title, text, cols, maxrows in QUERIES:
    parts.append('Write-Host ("-- "+%s)' % esc(title.replace('"', "'")))
    parts.append("Probe %s (%s) %d %d\n" % (esc(label), esc(text), cols, maxrows))
parts.append('Write-Host "DONE"')
ps = "\n".join(parts)
assert all(ord(c) < 128 for c in ps), "у скрипті лишилися не-ASCII символи"

import os
out = os.path.expanduser("~/Downloads/probe-stock-orphans.ps1")
open(out, "w", encoding="ascii", newline="\r\n").write(ps)
print("написано", out, len(ps), "байт")
