# -*- coding: utf-8 -*-
"""Генератор probe-buh-base.ps1: що всередині бази «Buhgalteria».

05.09.2026 проба probe-server-bases.ps1 показала: у кластері 8.2 на
SRVKAVETSKIY дві інфобази — kavetskiy (УТ 2.3, її читає обмін) і Buhgalteria.
Про другу невідомо нічого: конфігурація, період, чи дублює вона торгівлю з УТ
через обмін, чи веде лише банк/податки/зарплату.

Проба відповідає на це одним прогоном, не знаючи наперед конфігурації: кожен
кандидат — окремий запит у try/catch, відсутній обʼєкт валить лише себе.
Імена — з «Бухгалтерія для України 1.2» (та сама генерація, що УТ 2.3, і та
сама платформа 8.2 — інших варіантів у цьому кластері бути не може).

Облікові дані: користувачі 1С живуть окремо в кожній базі, budvik_sync у
Buhgalteria немає. Скрипт приймає -User/-Password; без них пробує зайти
без імені (спрацює лише якщо в базі не заведено жодного користувача).

Усі запити — ТІЛЬКИ читання. Правила екранування — як у gen-probe-accounting.py.
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
LEDGER = "РегистрБухгалтерии.Хозрасчетный"

def span(label, title, obj, posted=True):
    where = " ГДЕ D.Проведен" if posted else ""
    return (label, title,
            f"ВЫБРАТЬ КОЛИЧЕСТВО(D.Ссылка), МИНИМУМ(D.Дата), МАКСИМУМ(D.Дата) ИЗ {DOC}.{obj} КАК D{where}", 3, 1)

def sum12(label, title, obj):
    return (label, title,
            f"ВЫБРАТЬ КОЛИЧЕСТВО(D.Ссылка), СУММА(D.СуммаДокумента) ИЗ {DOC}.{obj} КАК D "
            f"ГДЕ D.Проведен И D.Дата >= {SINCE}", 2, 1)

def by_field(label, title, obj, field, top=None, order=True):
    first = f"ПЕРВЫЕ {top} " if top else ""
    ordr = " УПОРЯДОЧИТЬ ПО S УБЫВ" if order else ""
    return (label, title,
            f"ВЫБРАТЬ {first}D.{field}, КОЛИЧЕСТВО(D.Ссылка) КАК N, СУММА(D.СуммаДокумента) КАК S "
            f"ИЗ {DOC}.{obj} КАК D ГДЕ D.Проведен И D.Дата >= {SINCE} СГРУППИРОВАТЬ ПО D.{field}{ordr}", 3, top or 40)

def by_month(label, title, obj):
    return (label, title,
            f"ВЫБРАТЬ НАЧАЛОПЕРИОДА(D.Дата, МЕСЯЦ), КОЛИЧЕСТВО(D.Ссылка), СУММА(D.СуммаДокумента) "
            f"ИЗ {DOC}.{obj} КАК D ГДЕ D.Проведен И D.Дата >= {SINCE} СГРУППИРОВАТЬ ПО НАЧАЛОПЕРИОДА(D.Дата, МЕСЯЦ)", 3, 14)

def count_ref(label, title, obj):
    return (label, title,
            f"ВЫБРАТЬ КОЛИЧЕСТВО(S.Ссылка), КОЛИЧЕСТВО(РАЗЛИЧНЫЕ S.Наименование) ИЗ {SPR}.{obj} КАК S", 2, 1)

def balances(label, title, acct_like, group="O.Счет.Код, O.Счет.Наименование", top=None, order=None):
    """Сальдо по рахунках через віртуальну таблицю Остатки з умовою на рахунок."""
    first = f"ПЕРВЫЕ {top} " if top else ""
    cols = group
    ordr = f" УПОРЯДОЧИТЬ ПО {order}" if order else ""
    return (label, title,
            f"ВЫБРАТЬ {first}{cols}, СУММА(O.СуммаОстатокДт) КАК DT, СУММА(O.СуммаОстатокКт) КАК KT "
            f'ИЗ {LEDGER}.Остатки(, Счет.Код ПОДОБНО "{acct_like}", , ) КАК O '
            f"СГРУППИРОВАТЬ ПО {group}{ordr}", len(group.split(",")) + 2, top or 120)

def turnover(label, title, acct_like, group="O.Счет.Код, O.Счет.Наименование", period="", top=None, order=None):
    first = f"ПЕРВЫЕ {top} " if top else ""
    ordr = f" УПОРЯДОЧИТЬ ПО {order}" if order else ""
    return (label, title,
            f"ВЫБРАТЬ {first}{group}, СУММА(O.СуммаОборотДт) КАК DT, СУММА(O.СуммаОборотКт) КАК KT "
            f'ИЗ {LEDGER}.Обороты({SINCE}, , {period}, Счет.Код ПОДОБНО "{acct_like}", , ) КАК O '
            f"СГРУППИРОВАТЬ ПО {group}{ordr}", len(group.split(",")) + 2, top or 60)

H = "#"

QUERIES = [
    (H, "A. ЩО ЦЕ ЗА БАЗА — план рахунків, період, організації, обсяг довідників"),
    ("ledger_span", "A1 регістр Хозрасчетный: проводок, від, до (є = це Бухгалтерія)",
     f"ВЫБРАТЬ КОЛИЧЕСТВО(*), МИНИМУМ(R.Период), МАКСИМУМ(R.Период) ИЗ {LEDGER} КАК R", 3, 1),
    ("ledger_by_year", "A2 проводок по роках (глибина історії)",
     f"ВЫБРАТЬ ГОД(R.Период), КОЛИЧЕСТВО(*) ИЗ {LEDGER} КАК R СГРУППИРОВАТЬ ПО ГОД(R.Период)", 2, 30),
    ("chart_top", "A3 план рахунків: рахунки верхнього рівня",
     f"ВЫБРАТЬ S.Код, S.Наименование ИЗ ПланСчетов.Хозрасчетный КАК S "
     f"ГДЕ S.Родитель = ЗНАЧЕНИЕ(ПланСчетов.Хозрасчетный.ПустаяСсылка) УПОРЯДОЧИТЬ ПО S.Код", 2, 120),
    ("orgs", "A4 організації",
     f"ВЫБРАТЬ O.Код, O.Наименование, O.ПометкаУдаления ИЗ {SPR}.Организации КАК O", 3, 30),
    ("orgs_attrs", "A5 організації: юр/фіз, ІПН",
     f"ВЫБРАТЬ O.Наименование, O.ЮрФизЛицо, O.ИНН ИЗ {SPR}.Организации КАК O", 3, 30),
    ("orgs_edrpou", "A6 організації: ЄДРПОУ",
     f"ВЫБРАТЬ O.Наименование, O.КодПоЕДРПОУ ИЗ {SPR}.Организации КАК O", 2, 30),
    count_ref("counterparties", "A7 контрагентів (в УТ 3702)", "Контрагенты"),
    count_ref("nomenclature", "A8 номенклатури (в УТ ~20 000)", "Номенклатура"),
    count_ref("users", "A9 користувачів 1С", "Пользователи"),
    ("users_list", "A10 імена користувачів",
     f"ВЫБРАТЬ P.Наименование, P.ПометкаУдаления ИЗ {SPR}.Пользователи КАК P", 2, 40),
    ("exchange_plan_1", "A11 план обміну з УТ (варіант 1)",
     f"ВЫБРАТЬ P.Код, P.Наименование, P.ЭтотУзел ИЗ ПланОбмена.ОбменУправлениеТорговлейБухгалтерияПредприятия КАК P", 3, 10),
    ("exchange_plan_2", "A12 план обміну з УТ (варіант 2)",
     f"ВЫБРАТЬ P.Код, P.Наименование, P.ЭтотУзел ИЗ ПланОбмена.ОбменУправлениеТорговлей КАК P", 3, 10),
    ("exchange_plan_3", "A13 план обміну (повний)",
     f"ВЫБРАТЬ P.Код, P.Наименование, P.ЭтотУзел ИЗ ПланОбмена.ПолныйОбмен КАК P", 3, 10),

    (H, "B. БАЛАНС — сальдо по рахунках на сьогодні"),
    balances("balance_all", "B1 сальдо по всіх рахунках (код | назва | Дт | Кт)", "%"),

    (H, "C. БАНК — те, чого в УТ немає"),
    ("bank_accounts", "C1 банківські рахунки",
     f"ВЫБРАТЬ B.Наименование, B.НомерСчета, B.ПометкаУдаления ИЗ {SPR}.БанковскиеСчета КАК B", 3, 40),
    ("bank_accounts_bank", "C2 банківські рахунки: банк, валюта",
     f"ВЫБРАТЬ B.Наименование, B.Банк.Наименование, B.ВалютаДенежныхСредств.Наименование ИЗ {SPR}.БанковскиеСчета КАК B", 3, 40),
    balances("bank_balance", "C3 гроші на рахунках 31 (по рахунку і субконто)", "31%",
             group="O.Счет.Код, O.Субконто1"),
    span("pp_in_span", "C4 ПП вхідне (гроші від клієнтів на рахунок): всього, від, до", "ПлатежноеПоручениеВходящее"),
    by_field("pp_in_by_kind", "C5 ПП вхідне за рік по виду операції", "ПлатежноеПоручениеВходящее", "ВидОперации", order=False),
    by_month("pp_in_by_month", "C6 ПП вхідне по місяцях за рік", "ПлатежноеПоручениеВходящее"),
    by_field("pp_in_top_payers", "C7 ПП вхідне: топ-25 платників за рік", "ПлатежноеПоручениеВходящее", "Контрагент.Наименование", top=25),
    span("pp_out_span", "C8 ПП вихідне: всього, від, до", "ПлатежноеПоручениеИсходящее"),
    by_field("pp_out_by_kind", "C9 ПП вихідне за рік по виду операції", "ПлатежноеПоручениеИсходящее", "ВидОперации", order=False),
    by_field("pp_out_top", "C10 ПП вихідне: топ-25 одержувачів за рік", "ПлатежноеПоручениеИсходящее", "Контрагент.Наименование", top=25),
    span("po_in_span", "C11 платіжний ордер: надходження", "ПлатежныйОрдерПоступлениеДенежныхСредств"),
    span("po_out_span", "C12 платіжний ордер: списання", "ПлатежныйОрдерСписаниеДенежныхСредств"),
    span("bank_stmt_span", "C13 банківська виписка як документ", "БанковскаяВыписка", posted=False),
    ("bank_docs_reg", "C14 контроль: обороти по 31 за рік (Дт = надійшло, Кт = списано)",
     f"ВЫБРАТЬ O.Счет.Код, СУММА(O.СуммаОборотДт), СУММА(O.СуммаОборотКт) "
     f'ИЗ {LEDGER}.Обороты({SINCE}, , , Счет.Код ПОДОБНО "31%", , ) КАК O СГРУППИРОВАТЬ ПО O.Счет.Код', 3, 10),

    (H, "D. КАСА — чи дублює вона касу УТ"),
    span("pko_span", "D1 ПКО: всього, від, до", "ПриходныйКассовыйОрдер"),
    by_field("pko_by_kind", "D2 ПКО за рік по виду операції (в УТ: 8243 оплати покупця)", "ПриходныйКассовыйОрдер", "ВидОперации", order=False),
    span("rko_span", "D3 РКО: всього, від, до", "РасходныйКассовыйОрдер"),
    by_field("rko_by_kind", "D4 РКО за рік по виду операції", "РасходныйКассовыйОрдер", "ВидОперации", order=False),
    by_field("rko_by_dds", "D5 РКО за рік по статті руху грошей", "РасходныйКассовыйОрдер", "СтатьяДвиженияДенежныхСредств.Наименование", top=30),
    balances("cash_balance", "D6 гроші в касі 30", "30%", group="O.Счет.Код, O.Субконто1"),

    (H, "E. ТОРГІВЛЯ — чи є тут копія реалізацій/надходжень з УТ"),
    span("sales_span", "E1 реалізації: всього, від, до", "РеализацияТоваровУслуг"),
    by_month("sales_by_month", "E2 реалізації по місяцях за рік (в УТ ~850/міс)", "РеализацияТоваровУслуг"),
    span("receipts_span", "E3 надходження: всього, від, до", "ПоступлениеТоваровУслуг"),
    by_month("receipts_by_month", "E4 надходження по місяцях за рік", "ПоступлениеТоваровУслуг"),
    span("returns_span", "E5 повернення від покупця", "ВозвратТоваровОтПокупателя"),
    balances("receivables", "E6 дебіторка 36: топ-25 боржників", "36%",
             group="O.Субконто1", top=25, order="DT УБЫВ"),
    balances("payables", "E7 кредиторка 63: топ-25 кому винні", "63%",
             group="O.Субконто1", top=25, order="KT УБЫВ"),
    balances("stock_cost", "E8 товари на 28 у собівартості по субрахунках", "28%"),
    balances("advances", "E9 аванси 371/681", "%",
             group="O.Счет.Код, O.Счет.Наименование"),

    (H, "F. ПОДАТКИ ТА ЗВІТНІСТЬ"),
    span("tax_inv_span", "F1 податкові накладні: всього, від, до", "НалоговаяНакладная"),
    sum12("tax_inv_12m", "F2 податкові накладні за рік", "НалоговаяНакладная"),
    span("tax_in_span", "F3 вхідні податкові документи", "РегистрацияВходящегоНалоговогоДокумента"),
    balances("taxes_64", "F4 розрахунки за податками 64 по субрахунках", "64%"),
    span("reg_reports", "F5 регламентовані звіти (декларації)", "РегламентированныйОтчет", posted=False),
    ("vat_rates", "F6 ставки ПДВ у реалізаціях за рік",
     f"ВЫБРАТЬ T.СтавкаНДС, КОЛИЧЕСТВО(*), СУММА(T.Сумма) ИЗ {DOC}.РеализацияТоваровУслуг.Товары КАК T "
     f"ГДЕ T.Ссылка.Проведен И T.Ссылка.Дата >= {SINCE} СГРУППИРОВАТЬ ПО T.СтавкаНДС", 3, 6),

    (H, "G. ЗАРПЛАТА І ПЕРСОНАЛ"),
    count_ref("employees", "G1 співробітники організацій", "СотрудникиОрганизаций"),
    count_ref("persons", "G2 фізичні особи", "ФизическиеЛица"),
    span("payroll_span", "G3 нарахування зарплати: всього, від, до", "НачислениеЗарплатыРаботникамОрганизаций"),
    span("payout_span", "G4 зарплата до виплати", "ЗарплатаКВыплатеОрганизаций"),
    span("hire_span", "G5 прийом на роботу", "ПриемНаРаботуВОрганизацию"),
    span("fire_span", "G6 звільнення", "УвольнениеИзОрганизации"),
    balances("wages_66", "G7 розрахунки з оплати праці 66", "66%"),
    turnover("wages_turn", "G8 обороти по 66 за рік (Дт = виплачено, Кт = нараховано)", "66%"),

    (H, "H. ОСНОВНІ ЗАСОБИ — авто, обладнання"),
    count_ref("fixed_assets", "H1 основних засобів у довіднику", "ОсновныеСредства"),
    ("fixed_assets_list", "H2 основні засоби: перші 40 назв",
     f"ВЫБРАТЬ ПЕРВЫЕ 40 F.Код, F.Наименование ИЗ {SPR}.ОсновныеСредства КАК F", 2, 40),
    span("os_accept_span", "H3 прийняття до обліку ОЗ", "ПринятиеКУчетуОС"),
    balances("os_10", "H4 ОЗ на 10 по субрахунках", "10%"),
    balances("os_13", "H5 знос 13", "13%"),
    span("advance_span", "H6 авансові звіти (пальне водіїв!): всього, від, до", "АвансовыйОтчет"),
    sum12("advance_12m", "H7 авансові звіти за рік", "АвансовыйОтчет"),

    (H, "I. ДОХОДИ І ВИТРАТИ — скелет P&L за рік"),
    turnover("income_70", "I1 дохід 70 по місяцях (Кт)", "70%", group="O.Период, O.Счет.Код", period="Месяц"),
    turnover("cogs_90", "I2 собівартість 90 по місяцях (Дт)", "90%", group="O.Период, O.Счет.Код", period="Месяц"),
    turnover("expenses_9x", "I3 витрати 92/93/94 по рахунках за рік", "9%"),
    turnover("expenses_by_item", "I4 витрати 92/93 по статтях за рік: топ-30", "9%",
             group="O.Субконто1", top=30, order="DT УБЫВ"),
    turnover("result_79", "I5 фінрезультат 79 за рік", "79%"),
    turnover("result_44", "I6 нерозподілений прибуток 44", "44%"),
]

HEAD = r'''# Probe: what is inside the second infobase of this cluster, "Buhgalteria".
#
# probe-server-bases.ps1 (05.09.2026) proved the cluster holds two bases:
# kavetskiy (UT 2.3, read by the exchange) and Buhgalteria, about which
# nothing is known -- configuration, history depth, whether it mirrors UT
# through an exchange plan, whether it holds the bank, taxes and payroll.
#
# READ ONLY -- only SELECT queries, nothing is written to 1C.
#
# 1C users live per infobase; budvik_sync does not exist here. Pass the
# credentials of a user of THIS base (32-bit PowerShell, avoid 20:00-20:30):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-buh-base.ps1 -User "NAME" -Password "PWD" > \\tsclient\Downloads\probe-buh-base.out.txt 2>&1
# Without -User it tries to connect with no name, which works only when the
# base has no user list at all.
#
# ASCII-only source: PowerShell 5 mangles Cyrillic literals in .ps1,
# so every Cyrillic string is built from char codes (see gen-probe-buh.py).

[CmdletBinding()]
param(
    [string] $Server = "SRVKAVETSKIY",
    [string] $Base = "Buhgalteria",
    [string] $User = "",
    [string] $Password = ""
)

$ErrorActionPreference = "Continue"

$NAIM = ([char]0x041D+[char]0x0430+[char]0x0438+[char]0x043C+[char]0x0435+[char]0x043D+[char]0x043E+[char]0x0432+[char]0x0430+[char]0x043D+[char]0x0438+[char]0x0435)

$conn = New-Object -ComObject "V82.COMConnector"
$cs = "Srvr=""{0}"";Ref=""{1}"";" -f $Server, $Base
if ($User) { $cs += "Usr=""{0}"";Pwd=""{1}"";" -f $User, $Password }
Write-Host ("connecting to " + $Base + " as '" + $User + "' ...")
try {
    $ib = $conn.Connect($cs)
} catch {
    Write-Host ("CONNECT FAILED: " + $_.Exception.Message)
    Write-Host "If the message is about user/password: pass -User/-Password of a user of THIS base."
    exit 1
}
Write-Host ("CONNECTED to " + $Base + " -- READ ONLY")
Write-Host ("started " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host ""

# Configuration identity: Metadata is null through COM on 8.2 (known), but try anyway.
try {
    $m = $ib.Metadata
    if ($null -ne $m) { Write-Host ("config: " + [string]$m.Name + "  version " + [string]$m.Version + "  " + [string]$m.Synonym) }
    else { Write-Host "config: Metadata not available via COM (expected on 8.2) -- identify by A1/A3 below" }
} catch { Write-Host ("config: " + $_.Exception.Message) }
try {
    $si = $ib.NewObject("SystemInfo")
    Write-Host ("platform: " + [string]$si.AppVersion)
} catch { }
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
Write-Host ""
Write-Host "How to read:"
Write-Host "  A1 OK with rows        = accounting ledger exists, this is a Buhgalteriya-type base"
Write-Host "  E2 close to UT volumes = the base mirrors UT through an exchange; else it is kept by hand"
Write-Host "  C4-C7 with rows        = bank money from customers lives HERE, not in UT"
Write-Host "  --  Object reference   = object or field absent in this configuration"
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
for out in [os.path.join(here, "probe-buh-base.ps1"), os.path.expanduser("~/Downloads/probe-buh-base.ps1")]:
    open(out, "w", encoding="ascii", newline="\r\n").write(ps)
    print("написано", out, len(ps), "байт")
print("запитів:", sum(1 for e in QUERIES if e[0] != H))
