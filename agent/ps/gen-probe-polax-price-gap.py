# -*- coding: utf-8 -*-
"""Генератор probe-polax-price-gap.ps1 — вивантажує з 1С усе потрібне,
щоб проставити тип цін «6.МАГАЗИНИ» для Polax.

На відміну від першої проби, пише не в консоль (та калічить «і» на «?»),
а прямо у CSV в UTF-8: назви лишаються цілими.
"""

def esc(s):
    out, buf = [], ""
    for ch in s:
        if ord(ch) < 128 and ch != '"':
            buf += ch
        else:
            if buf:
                out.append('"' + buf + '"'); buf = ""
            out.append("[char]0x%04x" % ord(ch))
    if buf:
        out.append('"' + buf + '"')
    return "+".join(out) if out else '""'

MAG, OPT, VIP, VHID_UAH, VHID_USD = "000000011", "000000004", "000000006", "000000002", "000000001"

def sl(code, alias):
    return (f'(ВЫБРАТЬ C.Номенклатура КАК Nom, C.Цена КАК Cena, C.Валюта.Код КАК Kod, C.Период КАК Per '
            f'ИЗ РегистрСведений.ЦеныНоменклатуры.СрезПоследних КАК C '
            f'ГДЕ C.ТипЦен.Код = "{code}") КАК {alias}')

def brand(b):
    return f'N.Наименование ПОДОБНО "{b}%" И НЕ N.ЭтоГруппа И НЕ N.ПометкаУдаления'

JOINS = (f'ЛЕВОЕ СОЕДИНЕНИЕ {sl(MAG, "M")} ПО M.Nom = N.Ссылка '
         f'ЛЕВОЕ СОЕДИНЕНИЕ {sl(OPT, "O")} ПО O.Nom = N.Ссылка '
         f'ЛЕВОЕ СОЕДИНЕНИЕ {sl(VIP, "P")} ПО P.Nom = N.Ссылка '
         f'ЛЕВОЕ СОЕДИНЕНИЕ {sl(VHID_UAH, "T")} ПО T.Nom = N.Ссылка '
         f'ЛЕВОЕ СОЕДИНЕНИЕ {sl(VHID_USD, "U")} ПО U.Nom = N.Ссылка ')

DUMPS = [
    # file, header, query, cols
    ("polax-price-gap.csv", "art;name;opt;opt_cur;vip;vip_cur;vhid_uah;vhid_usd",
     f'ВЫБРАТЬ N.Артикул, N.Наименование, O.Cena, O.Kod, P.Cena, P.Kod, T.Cena, U.Cena '
     f'ИЗ Справочник.Номенклатура КАК N {JOINS}'
     f'ГДЕ {brand("POLAX")} И M.Cena ЕСТЬ NULL И O.Cena > 0', 8),

    ("polax-stale.csv", "art;name;mag;mag_cur;mag_date;opt;opt_cur",
     f'ВЫБРАТЬ N.Артикул, N.Наименование, M.Cena, M.Kod, M.Per, O.Cena, O.Kod '
     f'ИЗ Справочник.Номенклатура КАК N {JOINS}'
     f'ГДЕ {brand("POLAX")} И M.Cena > 0', 7),

    ("sigma-markup.csv", "art;mag;mag_cur;opt;opt_cur",
     f'ВЫБРАТЬ N.Артикул, M.Cena, M.Kod, O.Cena, O.Kod '
     f'ИЗ Справочник.Номенклатура КАК N {JOINS}'
     f'ГДЕ {brand("SIGMA")} И M.Cena > 0 И O.Cena > 0', 5),

    ("rates.csv", "code;name;rate;mult",
     'ВЫБРАТЬ V.Код, V.Наименование, K.Курс, K.Кратность '
     'ИЗ Справочник.Валюты КАК V ЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.КурсыВалют.СрезПоследних КАК K '
     'ПО K.Валюта = V.Ссылка', 4),
]

HEAD = r'''# Probe: dump everything needed to fill price type 6.MAGAZYNY for POLAX in 1C.
# READ ONLY -- only SELECT queries. Writes CSV files (UTF-8) next to the script,
# i.e. into the Mac Downloads folder when run from \\tsclient\Downloads.
#
# Run in 32-bit PowerShell on SRVKAVETSKIY:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-polax-price-gap.ps1
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1.

$ErrorActionPreference = "Continue"

$candidates = @()
if ($PSScriptRoot) { $candidates += (Join-Path $PSScriptRoot "config.json") }
$candidates += "C:\Users\fedyshyn\budvik-agent\config.json"
$candidates += "C:\budvik-agent\config.json"
$configPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $configPath) { throw "config.json not found in: $($candidates -join '; ')" }
$config = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
Write-Host ("config: " + $configPath)

# CSV lands beside the script -- that is \\tsclient\Downloads, i.e. straight onto the Mac.
$OutDir = if ($PSScriptRoot) { $PSScriptRoot } else { "\\tsclient\Downloads" }
Write-Host ("out: " + $OutDir)

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";Usr=""{2}"";Pwd=""{3}"";" -f `
    [string]$config.oneC.server, [string]$config.oneC.base, [string]$config.oneC.user, [string]$config.oneC.password
$ib = $conn.Connect($cs)
Write-Host "CONNECTED"

function Cell($v) {
    if ($null -eq $v) { return "" }
    if ($v -is [datetime]) { return $v.ToString("yyyy-MM-dd") }
    $s = [string]$v
    if ($s -eq "System.__ComObject") { return "" }
    return $s.Replace(";", ",").Replace("`r", " ").Replace("`n", " ").Trim()
}

function Dump($file, $header, $queryText, $cols) {
    try {
        $q = $ib.NewObject("Query")
        $q.Text = [string]$queryText
        $rs = $q.Execute()
        if ($null -eq $rs) { Write-Host ("  -- {0}: Execute returned null" -f $file); return }
        $r = $rs.Choose()
        $sb = New-Object System.Text.StringBuilder
        [void]$sb.AppendLine($header)
        $n = 0
        while ($r.Next()) {
            $parts = @()
            for ($i = 0; $i -lt $cols; $i++) { $parts += (Cell $r.Get($i)) }
            [void]$sb.AppendLine($parts -join ";")
            $n++
        }
        $path = Join-Path $OutDir $file
        [IO.File]::WriteAllText($path, $sb.ToString(), (New-Object System.Text.UTF8Encoding($true)))
        Write-Host ("  OK {0}   rows={1}" -f $file, $n)
    }
    catch {
        Write-Host ("  -- {0}: {1}" -f $file, $_.Exception.Message)
    }
}
'''

parts = [HEAD]
for f, hdr, q, cols in DUMPS:
    parts.append('Dump "%s" "%s" (%s) %d' % (f, hdr, esc(q), cols))
parts.append('\nWrite-Host "DONE"')
ps = "\n".join(parts)
assert all(ord(c) < 128 for c in ps), "не-ASCII у скрипті"
open("/Users/admin/Downloads/probe-polax-price-gap.ps1", "w", encoding="ascii", newline="\r\n").write(ps)
print("написано probe-polax-price-gap.ps1,", len(ps), "байт")
