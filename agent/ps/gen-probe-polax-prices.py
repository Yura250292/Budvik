# -*- coding: utf-8 -*-
"""Генератор probe-polax-prices.ps1: кирилиця в PS5 живе лише як [char]-коди."""

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

# Фільтруємо за КОДОМ типу цін, а не назвою: назви містять «і», лапки й дужки,
# у яких легко помилитись, а код — чиста латиниця з цифрами.
MAG = "000000011"   # 6.МАГАЗИНИ (грн) — саме його читає сайт
OPT = "000000004"   # 4.ОПТ (від 10-50 тис.)
VIP = "000000006"   # 5.VIP
VHID = "000000002"  # 1.ВХІД

def slice_for(type_name, alias):
    return (f'(ВЫБРАТЬ C.Номенклатура КАК Nom, C.Цена КАК Cena, C.Валюта.Код КАК Kod, C.Период КАК Per '
            f'ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних КАК C '
            f'ГДЕ C.ТипЦен.Код = "{type_name}") КАК {alias}')

POLAX = 'N.Наименование ПОДОБНО "POLAX%" И НЕ N.ЭтоГруппа И НЕ N.ПометкаУдаления'

QUERIES = [
    ("polax_total", "Q1: скільки POLAX у номенклатурі (не групи, не помічені на видалення)",
     f'ВЫБРАТЬ КОЛИЧЕСТВО(N.Ссылка), 1 ИЗ Справочник.Номенклатура КАК N ГДЕ {POLAX}', 2, 1),

    ("polax_mag_cnt", "Q2: з них мають ціну в 6.МАГАЗИНИ (>0 / рядок є / рядок нульовий)",
     f'ВЫБРАТЬ КОЛИЧЕСТВО(M.Nom), СУММА(ВЫБОР КОГДА M.Cena > 0 ТОГДА 1 ИНАЧЕ 0 КОНЕЦ) '
     f'ИЗ Справочник.Номенклатура КАК N ЛЕВОЕ СОЕДИНЕНИЕ {slice_for(MAG, "M")} ПО M.Nom = N.Ссылка '
     f'ГДЕ {POLAX}', 2, 1),

    ("polax_gap_cnt", "Q3: НЕМА ціни 6.МАГАЗИНИ, але Є 4.ОПТ — скільки таких",
     f'ВЫБРАТЬ КОЛИЧЕСТВО(N.Ссылка), 1 ИЗ Справочник.Номенклатура КАК N '
     f'ЛЕВОЕ СОЕДИНЕНИЕ {slice_for(MAG, "M")} ПО M.Nom = N.Ссылка '
     f'ЛЕВОЕ СОЕДИНЕНИЕ {slice_for(OPT, "O")} ПО O.Nom = N.Ссылка '
     f'ГДЕ {POLAX} И M.Cena ЕСТЬ NULL И O.Cena > 0', 2, 1),

    ("polax_gap_sample", "Q4: приклади без 6.МАГАЗИНИ (артикул | назва | 4.ОПТ | вал | 5.VIP | 1.ВХІД)",
     f'ВЫБРАТЬ N.Артикул, N.Наименование, O.Cena, O.Kod, P.Cena, T.Cena '
     f'ИЗ Справочник.Номенклатура КАК N '
     f'ЛЕВОЕ СОЕДИНЕНИЕ {slice_for(MAG, "M")} ПО M.Nom = N.Ссылка '
     f'ЛЕВОЕ СОЕДИНЕНИЕ {slice_for(OPT, "O")} ПО O.Nom = N.Ссылка '
     f'ЛЕВОЕ СОЕДИНЕНИЕ {slice_for(VIP, "P")} ПО P.Nom = N.Ссылка '
     f'ЛЕВОЕ СОЕДИНЕНИЕ {slice_for(VHID, "T")} ПО T.Nom = N.Ссылка '
     f'ГДЕ {POLAX} И M.Cena ЕСТЬ NULL И O.Cena > 0', 6, 25),

    ("polax_both", "Q5: є і 6.МАГАЗИНИ, і 4.ОПТ — для розрахунку націнки (арт | МАГ | вал | ОПТ | вал | дата МАГ)",
     f'ВЫБРАТЬ N.Артикул, M.Cena, M.Kod, O.Cena, O.Kod, M.Per '
     f'ИЗ Справочник.Номенклатура КАК N '
     f'ЛЕВОЕ СОЕДИНЕНИЕ {slice_for(MAG, "M")} ПО M.Nom = N.Ссылка '
     f'ЛЕВОЕ СОЕДИНЕНИЕ {slice_for(OPT, "O")} ПО O.Nom = N.Ссылка '
     f'ГДЕ {POLAX} И M.Cena > 0 И O.Cena > 0', 6, 80),

    ("polax_mag_dates", "Q6: коли востаннє писали 6.МАГАЗИНИ для POLAX і для SIGMA (бренд | min | max | к-сть)",
     'ВЫБРАТЬ "POLAX", МИНИМУМ(C.Период), МАКСИМУМ(C.Период), КОЛИЧЕСТВО(C.Номенклатура) '
     'ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних КАК C '
     f'ГДЕ C.ТипЦен.Код = "{MAG}" И C.Номенклатура.Наименование ПОДОБНО "POLAX%" '
     'ОБЪЕДИНИТЬ ВСЕ '
     'ВЫБРАТЬ "SIGMA", МИНИМУМ(C.Период), МАКСИМУМ(C.Период), КОЛИЧЕСТВО(C.Номенклатура) '
     'ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних КАК C '
     f'ГДЕ C.ТипЦен.Код = "{MAG}" И C.Номенклатура.Наименование ПОДОБНО "SIGMA%"', 4, 10),

    ("zero_sku_prices", "Q7: усі ціни для конкретних товарів, що на сайті висять з 0 (арт | тип | ціна | вал | дата)",
     'ВЫБРАТЬ C.Номенклатура.Артикул, C.ТипЦен.Наименование, C.Цена, C.Валюта.Код, C.Период '
     'ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних КАК C '
     'ГДЕ C.Номенклатура.Артикул В ("07-015", "62-001", "25-119", "20-010", "100-486", "36-050")', 5, 60),

    ("polax_by_type_all", "Q8: POLAX по всіх типах цін (тип | вал | к-сть | min | max)",
     'ВЫБРАТЬ C.ТипЦен.Наименование, C.Валюта.Код, КОЛИЧЕСТВО(C.Номенклатура), МИНИМУМ(C.Цена), МАКСИМУМ(C.Цена) '
     'ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних КАК C '
     'ГДЕ C.Номенклатура.Наименование ПОДОБНО "POLAX%" И C.Цена > 0 '
     'СГРУППИРОВАТЬ ПО C.ТипЦен.Наименование, C.Валюта.Код', 5, 20),
]

HEAD = r'''# Probe: why POLAX products show 0 UAH on the site.
# READ ONLY -- only SELECT queries, nothing is written to 1C.
#
# Run in 32-bit PowerShell on SRVKAVETSKIY:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-polax-prices.ps1 > \\tsclient\Downloads\probe-polax-prices.out.txt 2>&1
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
open("/Users/admin/Downloads/probe-polax-prices.ps1", "w", encoding="ascii", newline="\r\n").write(ps)
print("написано /Users/admin/Downloads/probe-polax-prices.ps1", len(ps), "байт")
