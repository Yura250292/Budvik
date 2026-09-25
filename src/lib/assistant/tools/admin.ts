/**
 * Інструменти керівника: уся фірма, а не один портфель.
 *
 * Кожен із них — обгортка над аналітикою, яку вже малює адмінка. Це
 * навмисно: помічник мусить називати ті самі числа, що й розділи, інакше
 * два джерела почнуть сперечатися, а довіри не буде до жодного.
 *
 * Спільні правила всіх восьми:
 * • нічого не пишуть у базу;
 * • ім'я людини розв'язує resolveStaff, а не модель: збігів кілька —
 *   повертаємо «варіанти», і вибір робить людина;
 * • результат тримаємо приблизно до девʼяти тисяч символів, щоб compact()
 *   ніколи не різав таблицю посеред рядка.
 */

import { brandProblem, resolveBrand } from "@/lib/assistant/facts/brands";
import { brandOverviewFacts } from "@/lib/assistant/facts/brand-overview";
import type { ToolDef } from "@/lib/assistant/types";
import { prisma } from "@/lib/prisma";
import { bool, day as validDay, enumOf, int, str } from "@/lib/assistant/validate";
import { uah, pct, ymd } from "@/lib/assistant/format";
import { periodFacts, periodFromArgs } from "@/lib/assistant/period";
import { kyivDayStart, kyivTime } from "@/lib/date/kyiv";
import { fleetReportFacts } from "@/lib/assistant/facts/fleet";
import { listStaff, repKinds, resolveStaff, staffProblem, type RepKind } from "@/lib/assistant/facts/staff";
import { teamBenchmark } from "@/lib/analytics/benchmark";
import { METRICS, type MetricKey } from "@/lib/analytics/benchmarkMetrics";
import {
  agingByRep,
  collectedByRepBrand,
  collectedTotals,
  debtDeltaByRep,
  receivableRowsByRep,
  sumAging,
  toDebtorList,
  type DebtorClient,
  type ReceivableRow,
} from "@/lib/analytics/money-facts";
import { revenueByRepBrand, shiftFactsByUser, fuelCost } from "@/lib/analytics/facts";
import { repTripDays, tripDay, type TripDay, type TripDayFacts } from "@/lib/analytics/trip-facts";
import { payerVerdicts, verdictLabel } from "@/lib/assistant/facts/discipline-cache";
import { monthForecast } from "@/lib/assistant/facts/forecast";
import { livePositions } from "@/lib/track/live-positions";
import { autoCloseStaleShifts } from "@/lib/shift/auto-close";
import { driverEfficiencyFacts } from "@/lib/drivers/efficiency-facts";
import { buildDriverFacts, getRates, loadBonuses } from "@/lib/drivers/payroll-facts";
import { calculateDriverPeriod } from "@/lib/drivers/payroll";
import { buildLowStockReport, DEFAULT_PARAMS } from "@/lib/procurement/low-stock";
import { completeYears, risingGroups } from "@/lib/analytics/seasonality";
import { buildTurnoverReport } from "@/lib/analytics/turnover";
import { buildAbcReport, type AbcBasis, type AbcDimension, type AbcRow } from "@/lib/analytics/abc";
import { deadStockItems } from "@/lib/assistant/facts/product-facts";
import { syncHealthFacts } from "@/lib/sync-ingest/health-facts";
import { DEAD_STOCK_DAYS } from "@/lib/assistant/config";
import { ORDER_STATUS_LABELS, DELIVERY_METHOD_LABELS } from "@/lib/utils";
import type { OrderStatus } from "@prisma/client";

/** Спільний шматок схеми: період беруть шість інструментів із восьми. */
export const PERIOD_PARAMS = {
  days: { type: "integer", description: "Скільки останніх днів. Без цього й без дат — календарний місяць із 1 числа." },
  period_from: { type: "string", description: "Початок періоду, YYYY-MM-DD. Разом із period_to." },
  period_to: { type: "string", description: "Кінець періоду, YYYY-MM-DD." },
} as const;

/** Чи модель узагалі назвала період — інакше інструмент бере свій дефолт. */
export function hasPeriodArgs(args: Record<string, unknown>): boolean {
  return args.days != null || typeof args.period_from === "string" || typeof args.period_to === "string";
}

/** Дати з аргументів перевіряємо, навіть коли модель їх вигадала. */
export function checkedPeriod(today: string, args: Record<string, unknown>) {
  if (typeof args.period_from === "string" || typeof args.period_to === "string") {
    validDay(args.period_from, "period_from", today);
    validDay(args.period_to, "period_to", today);
  }
  return periodFromArgs(today, args);
}

/* ── Команда торгових ─────────────────────────────────────────────────── */

export const teamOverviewTool: ToolDef = {
  name: "team_overview",
  label: "Дивлюся команду торгових",
  kinds: ["ADMIN"],
  description:
    "Продажі всієї команди за період: оборот, місце, реалізації, клієнти, середній чек, зібрані гроші, прострочка, повернення, динаміка, приріст боргу, а в поточному місяці ще й план і прогноз. Параметр rep — по одному торговому (прізвища досить), by_brand — розкладка по брендах. Параметр brand — огляд ОДНОГО бренду замість команди: оборот і зміна до попереднього періоду, частка у фірмі, маржа, помісячно з початку року, найходовіші товари із залишком і днями запасу, хто з торгових його продає (без періоду — 90 днів). Викликай на будь-яке питання про продажі, оборот, команду, «хто скільки продав», «як фірма», «по бренду / по фірмі X».",
  parameters: {
    type: "object",
    properties: {
      rep: { type: "string", description: "Прізвище або ім'я торгового. Без нього — вся команда." },
      by_brand: { type: "boolean", description: "true — додати розкладку обороту по брендах." },
      brand: { type: "string", description: "Назва бренду як у питанні («Сила», «гроссер», «APRO») — огляд цього бренду." },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
    if (typeof args.brand === "string" && args.brand.trim()) {
      const query = str(args.brand, "brand", { min: 2, max: 40 });
      const match = await resolveBrand(query);
      if (!match.ok) return brandProblem(match, query);
      // Бренд за календарний місяць з 1 числа — надто мало, щоб судити про
      // ходові позиції: без явного періоду беремо 90 днів.
      const period = hasPeriodArgs(args) ? checkedPeriod(ctx.today, args) : periodFromArgs(ctx.today, { days: 90 });
      return brandOverviewFacts(match.brand, period);
    }

    const period = checkedPeriod(ctx.today, args);
    const byBrand = bool(args.by_brand, false);

    let onlyRep: { id: string; name: string } | null = null;
    if (typeof args.rep === "string" && args.rep.trim()) {
      const match = await resolveStaff(str(args.rep, "rep", { min: 2, max: 60 }), ["SALES"]);
      if (!match.ok) return staffProblem(match, "торгового");
      onlyRep = { id: match.user.id, name: match.user.name };
    }

    const isCurrentMonth = period.fromDay.slice(0, 7) === ctx.today.slice(0, 7) && period.fromDay.endsWith("-01");

    const [report, debtDelta] = await Promise.all([
      teamBenchmark(period),
      debtDeltaByRep(period.from, period.to),
    ]);

    const reps = onlyRep ? report.reps.filter((r) => r.repId === onlyRep!.id) : report.reps;
    if (reps.length === 0) {
      return {
        період: periodFacts(period),
        знайдено: 0,
        підказка: onlyRep
          ? `${onlyRep.name}: реалізацій за цей період немає`
          : "реалізацій за цей період немає",
      };
    }

    /**
     * План і прогноз коштують по запиту на людину, тож рахуємо їх лише
     * там, де вони що-небудь означають: у поточному місяці. За минулий
     * тиждень «виконання плану» — це число ні про що.
     */
    const forecasts = isCurrentMonth
      ? new Map(
          await Promise.all(
            reps.map(async (r) => [r.repId, await monthForecast(r.repId, ctx.today)] as const)
          )
        )
      : new Map();

    const wide = reps.length <= 9;
    const metricName = (k: MetricKey) => METRICS[k].label;

    return {
      період: periodFacts(period),
      разом: {
        оборот: uah(reps.reduce((s, r) => s + (r.revenue ?? 0), 0)),
        реалізацій: reps.reduce((s, r) => s + (r.docs ?? 0), 0),
        зібрано: uah(reps.reduce((s, r) => s + (r.collected ?? 0), 0)),
        торгових: reps.length,
      },
      медіани: {
        оборот: uah(report.medians.revenue),
        середній_чек: uah(report.medians.avgCheck),
        зібрано: uah(report.medians.collected),
        прострочено_відсотків: pct(report.medians.overdueRatio),
        повернення_відсотків: pct(report.medians.returnRatio),
      },
      порівняння_можливе: report.comparable,
      торгові: reps.map((r) => {
        const f = forecasts.get(r.repId);
        const revenueMetric = f?.показники.find((m: { ключ: string }) => m.ключ === "revenue");
        return {
          торговий_id: r.repId,
          торговий: r.name,
          місце: r.place,
          оборот: uah(r.revenue),
          реалізацій: r.docs,
          клієнтів: r.clients,
          середній_чек: uah(r.avgCheck),
          зібрано: uah(r.collected),
          прострочено_відсотків: pct(r.overdueRatio),
          повернення_відсотків: pct(r.returnRatio),
          sku_на_клієнта: r.skuPerClient == null ? null : Math.round(r.skuPerClient * 10) / 10,
          нових_клієнтів: r.newClients,
          втрачених_клієнтів: r.lostClients,
          динаміка_відсотків: pct(r.momentumPct),
          приріст_боргу: debtDelta.get(r.repId)?.hasOpening ? uah(debtDelta.get(r.repId)!.delta) : null,
          /**
           * План показуємо, лише коли він справді заведений.
           *
           * Планів у базі немає жодного, і «план 0, виконання 0 %»
           * читається як провал, хоча означає протилежне — що порівнювати
           * просто нема з чим.
           */
          план: revenueMetric && revenueMetric.план > 0 ? uah(revenueMetric.план) : undefined,
          виконання_відсотків:
            revenueMetric && revenueMetric.план > 0 ? pct(revenueMetric.виконання_відсотків) : undefined,
          прогноз_місяця: revenueMetric ? uah(revenueMetric.прогноз) : undefined,
          // Сильні й слабкі сторони — лише поки команда мала: на десятьох
          // це чотири зайві рядки на людину й вирізаний хвіст таблиці.
          сильне: wide ? r.strengths.map(metricName) : undefined,
          слабке: wide ? r.weaknesses.map(metricName) : undefined,
        };
      }),
      бренди: byBrand
        ? await brandRows(period.from, period.to, onlyRep?.id ?? null)
        : undefined,
      плани_заведені: isCurrentMonth
        ? [...forecasts.values()].some((f) =>
            f.показники.some((m: { план: number }) => m.план > 0)
          )
        : undefined,
      примітка:
        "У списку всі, на кого в 1С оформлюють документи, включно з офісом — окремої ознаки «польовий торговий» у базі немає.",
    };
  },
};

async function brandRows(from: Date, to: Date, repId: string | null) {
  const rows = await revenueByRepBrand(from, to, repId);
  const byBrand = new Map<string, { назва: string; оборот: number; торгових: Set<string> }>();
  for (const row of rows) {
    const key = row.brandName ?? "без бренду";
    const acc = byBrand.get(key) ?? { назва: key, оборот: 0, торгових: new Set<string>() };
    acc.оборот += row.amount;
    if (row.amount > 0) acc.торгових.add(row.repId);
    byBrand.set(key, acc);
  }
  return [...byBrand.values()]
    .sort((a, b) => b.оборот - a.оборот)
    .slice(0, repId ? 8 : 15)
    .map((b) => ({ бренд: b.назва, оборот: uah(b.оборот), торгових_продають: b.торгових.size }));
}

/* ── Дебіторка ────────────────────────────────────────────────────────── */

export const teamReceivablesTool: ToolDef = {
  name: "team_receivables",
  label: "Дивлюся дебіторку фірми",
  kinds: ["ADMIN"],
  description:
    "Дебіторка всієї фірми: скільки винні й скільки прострочено, розклад по торгових (польові окремо від офісу й власника) із приростом боргу, найбільші боржники-клієнти з вердиктом платника й віком боргу, скільки зібрано за період. Свої рахунки (працівники, склади, ФОП торгових) у списках не рахуються — їх видно окремим рядком. clients_per_rep > 0 дає по кожному торговому його клієнтів-боржників: так відповідай на «дебіторка по торгових і їх клієнтах», «розбий по торгових», «топ N клієнтів кожного». Викликай на «дебіторка», «борги», «хто винен», «прострочка», «найбільші боржники».",
  parameters: {
    type: "object",
    properties: {
      rep: {
        type: "string",
        description: "Прізвище торгового або кілька через кому («Кулик, Передрій, Валентин»). Без нього — вся фірма.",
      },
      clients_per_rep: {
        type: "integer",
        description: "Скільки клієнтів-боржників показати по КОЖНОМУ торговому, до 25. 0 — без розкладу по клієнтах. «Топ 5–7» = 7.",
      },
      older_than_days: {
        type: "integer",
        description:
          "Прострочено = частина боргу, старша за стільки днів від відвантаження. За замовчуванням 15 (робоча відстрочка фірми). «Прострочили понад 30 днів» = 30.",
      },
      overdue_only: { type: "boolean", description: "true — лише клієнти з простроченим боргом." },
      include_internal: { type: "boolean", description: "true — показати й свої рахунки (працівники, склади). За замовчуванням ні." },
      top: {
        type: "integer",
        description:
          "Скільки найбільших боржників фірми показати одним списком (клієнт → торговий → борг → дні), до 50. За замовчуванням 15. «По клієнтах», «які торгові з ними працюють» — 30.",
      },
      days: { type: "integer", description: "За скільки днів рахувати зібрані гроші й приріст боргу. За замовчуванням 30." },
    },
  },
  async run(ctx, args) {
    const top = int(args.top, "top", { min: 3, max: 50, fallback: 15 });
    const window = int(args.days, "days", { min: 1, max: 365, fallback: 30 });
    const olderThan = int(args.older_than_days, "older_than_days", { min: 15, max: 365, fallback: 15 });
    const overdueOnly = bool(args.overdue_only, false);
    const includeInternal = bool(args.include_internal, false);
    const period = periodFromArgs(ctx.today, { days: window });

    /*
     * Кілька торгових одним викликом: «по Олександру, Валентину, Джумазі».
     * Раніше це було п'ять викликів, і модель на третьому впиралась у стелю.
     */
    const wanted =
      typeof args.rep === "string" && args.rep.trim()
        ? str(args.rep, "rep", { min: 2, max: 200 })
            .split(/\s*[,;]\s*|\s+(?:і|й|та)\s+/)
            .map((w) => w.trim())
            .filter((w) => w.length >= 2)
        : [];
    const onlyReps: Array<{ id: string; name: string }> = [];
    for (const w of wanted) {
      const match = await resolveStaff(w, ["SALES"]);
      if (!match.ok) return staffProblem(match, "торгового");
      if (!onlyReps.some((r) => r.id === match.user.id)) onlyReps.push({ id: match.user.id, name: match.user.name });
    }
    const repFilter = onlyReps.length > 0 ? new Set(onlyReps.map((r) => r.id)) : null;
    const perRep = int(args.clients_per_rep, "clients_per_rep", {
      min: 0,
      max: 25,
      fallback: onlyReps.length > 0 ? 10 : 0,
    });

    const [allRows, verdicts, collected, delta, staff, kinds] = await Promise.all([
      receivableRowsByRep(onlyReps.length === 1 ? onlyReps[0].id : null),
      payerVerdicts(),
      collectedByRepBrand(period.from, period.to, onlyReps.length === 1 ? onlyReps[0].id : null),
      debtDeltaByRep(period.from, period.to),
      listStaff(["SALES"]),
      repKinds(),
    ]);

    const scoped = repFilter ? allRows.filter((r) => r.repId && repFilter.has(r.repId)) : allRows;
    const own = scoped.filter((r) => r.internal);
    // Копійчані залишки («Ремонт Rewolt 0 ₴») — не боржники, а округлення 1С.
    const rows = (includeInternal ? scoped : scoped.filter((r) => !r.internal)).filter((r) => r.debt >= 1);

    const nameOf = new Map(staff.map((s) => [s.id, s.name]));
    const total = sumAging(rows);
    const byRep = agingByRep(rows);
    const collectedMap = collectedTotals(collected);

    /** Прострочка за порогом запиту: 15 днів збігається з sumAging, інший поріг — перерахунок. */
    const overdueOf = (r: ReceivableRow) =>
      r.unknownDebt + r.aged.filter((sl) => sl.ageDays > olderThan).reduce((sum, sl) => sum + sl.amount, 0);
    const debtorOf = (d: DebtorClient, r: ReceivableRow) => ({
      клієнт_id: d.counterpartyId,
      клієнт: d.name,
      борг: uah(d.debt),
      прострочено: uah(overdueOf(r)),
      найстаріше_днів: d.oldestDays,
      платник: verdictLabel(verdicts.verdicts.get(d.counterpartyId)),
    });
    const rowOf = new Map(rows.map((r) => [r.counterpartyId, r]));
    const debtors = toDebtorList(rows)
      .map((d) => ({ d, r: rowOf.get(d.counterpartyId)!, overdue: overdueOf(rowOf.get(d.counterpartyId)!) }))
      .filter((x) => (overdueOnly ? x.overdue > 0.5 : true))
      .sort((a, b) => b.overdue - a.overdue || b.d.debt - a.d.debt);

    const KIND_ORDER: Record<RepKind, number> = { польовий: 0, офіс: 1, власник: 2 };
    const repRows = [...byRep.entries()]
      .map(([repId, aging]) => {
        const mine = debtors.filter((x) => x.r.repId === repId);
        return {
          торговий_id: repId,
          торговий: nameOf.get(repId) ?? "—",
          тип: kinds.get(repId) ?? "офіс",
          борг: uah(aging.total),
          прострочено: uah(mine.reduce((s, x) => s + x.overdue, 0)),
          прострочено_відсотків: pct(aging.total > 0 ? (mine.reduce((s, x) => s + x.overdue, 0) / aging.total) * 100 : 0),
          клієнтів_з_боргом: mine.length,
          зібрано_за_період: uah(collectedMap.get(repId)?.amount ?? 0),
          /**
           * Приріст рахується різницею двох знімків сальдо. Немає знімка
           * на початок періоду — немає й приросту: нуль чи «-12 млн» тут
           * означали б не рух боргу, а брак історії.
           */
          приріст_боргу: delta.get(repId)?.hasOpening ? uah(delta.get(repId)!.delta) : null,
        };
      })
      .sort((a, b) => KIND_ORDER[a.тип] - KIND_ORDER[b.тип] || b.борг - a.борг);

    /*
     * Клієнти по кожному торговому — те, чого бракувало 22.09.2026: модель
     * шукала прострочку по клієнтах у query_db, де віку боргу немає, і
     * вигадала «інструмент недоступний». Стеля на весь розклад — щоб
     * відповідь влізла у вікно інструмента (~12 тис. символів).
     */
    const groups = perRep > 0 ? [...repRows.map((r) => r.торговий_id), ...(repFilter ? [] : [null])] : [];
    const cap = groups.length > 0 ? Math.max(3, Math.min(perRep, Math.floor(80 / groups.length))) : 0;
    const clientsByRep = groups
      .map((repId) => {
        const list = debtors.filter((x) => x.r.repId === repId);
        const shown = list.slice(0, cap);
        const rest = list.slice(cap);
        return {
          торговий: repId ? (nameOf.get(repId) ?? "—") : "без торгового",
          тип: repId ? (kinds.get(repId) ?? "офіс") : null,
          клієнтів_з_боргом: list.length,
          клієнти: shown.map((x) => debtorOf(x.d, x.r)),
          ...(rest.length > 0
            ? { ще_не_показано: { клієнтів: rest.length, борг: uah(rest.reduce((s, x) => s + x.d.debt, 0)) } }
            : {}),
        };
      })
      .filter((g) => g.клієнтів_з_боргом > 0);

    return {
      разом: {
        борг_клієнтів: uah(total.total),
        прострочено: uah(debtors.reduce((s, x) => s + x.overdue, 0)),
        прострочено_відсотків: pct(total.total > 0 ? (debtors.reduce((s, x) => s + x.overdue, 0) / total.total) * 100 : 0),
        прострочено_це: `частина боргу, старша за ${olderThan} днів від відвантаження`,
        боржників: rows.length,
        без_торгового: uah(rows.filter((r) => !r.repId).reduce((s, r) => s + r.debt, 0)),
        ...(!includeInternal && own.length > 0
          ? { свої_рахунки_не_враховано: { рахунків: own.length, борг: uah(own.reduce((s, r) => s + r.debt, 0)) } }
          : {}),
      },
      по_торгових: repRows,
      ...(clientsByRep.length > 0 ? { клієнти_по_торгових: clientsByRep } : {}),
      найбільші_боржники: debtors.slice(0, clientsByRep.length > 0 ? Math.min(top, 10) : top).map((x) => ({
        ...debtorOf(x.d, x.r),
        торговий: nameOf.get(x.r.repId ?? "") ?? null,
        тип_торгового: x.r.repId ? (kinds.get(x.r.repId) ?? "офіс") : null,
        // Довгий список і так на межі вікна інструмента — дата лише для короткого.
        ...(top <= 25 ? { останнє_відвантаження: x.d.lastDocAt } : {}),
      })),
      зібрано_за_період: { ...periodFacts(period), сума: uah([...collectedMap.values()].reduce((s, c) => s + c.amount, 0)) },
      примітка:
        "Вік боргу відновлено з наших відвантажень: 1С строків оплати не передає, тому «прострочено» — оцінка. " +
        "Тип торгового: «польовий» — їздить до клієнтів (зміни в застосунку); «офіс» — виписує документи на себе; " +
        "«власник» — Кавецький Віктор, бере клієнтів і документи на себе, тож його борг — не показник роботи торгового. " +
        "Повний список без обмежень — export_file dataset receivables.",
    };
  },
};

/* ── Хто де зараз ─────────────────────────────────────────────────────── */

export const staffNowTool: ToolDef = {
  name: "staff_now",
  label: "Дивлюся, хто де зараз",
  kinds: ["ADMIN"],
  description:
    "Хто сьогодні на зміні й що з їхнім треком: коли востаннє був сигнал, скільки проїхано, скільки замовлень від клієнтів за день, що каже планшет (батарея, дозвіл на GPS, помилка) і висновок, чому не пишеться. Параметр who — конкретна людина, role — лише торгові або лише водії. Викликай на «хто на маршруті», «хто працює», «де зараз», «хто мовчить», «хто не відкрив зміну».",
  parameters: {
    type: "object",
    properties: {
      who: { type: "string", description: "Прізвище торгового або водія." },
      role: { type: "string", enum: ["SALES", "DRIVER"], description: "Звузити до однієї ролі." },
      day: { type: "string", description: "День у форматі YYYY-MM-DD. За замовчуванням сьогодні." },
    },
  },
  async run(ctx, args) {
    const dayIso = validDay(args.day, "day", ctx.today);
    const role = args.role == null ? null : enumOf(args.role, "role", ["SALES", "DRIVER"] as const);

    let onlyId: string | null = null;
    if (typeof args.who === "string" && args.who.trim()) {
      const match = await resolveStaff(
        str(args.who, "who", { min: 2, max: 60 }),
        role ? [role] : ["SALES", "DRIVER"]
      );
      if (!match.ok) return staffProblem(match, "співробітника");
      onlyId = match.user.id;
    }

    const { people } = await livePositions(dayIso);
    const filtered = people
      .filter((p) => (onlyId ? p.userId === onlyId : true))
      .filter((p) => (role ? p.role === role : p.role === "SALES" || p.role === "DRIVER"))
      .slice(0, 30);

    return {
      день: dayIso,
      /**
       * Година — КИЇВСЬКА, а не серверна.
       *
       * `getHours()` бере час машини, а прод живе в UTC: о 13:24 у Львові
       * помічник писав «10:23», і решта відповіді про «зараз» читалася як
       * розповідь про ранок.
       */
      зараз: kyivTime(new Date()),
      людей: filtered.length,
      на_зміні: filtered.filter((p) => p.shift?.status === "OPEN").length,
      мовчать: filtered.filter((p) => p.shift?.status === "OPEN" && (p.minutesAgo == null || p.minutesAgo > 60)).length,
      люди: filtered.map((p) => ({
        user_id: p.userId,
        ім_я: p.name,
        роль: p.role === "DRIVER" ? "водій" : "торговий",
        зміна: p.shift
          ? {
              стан: p.shift.status === "OPEN" ? "відкрита" : "закрита",
              відкрита_о: ymd(p.shift.startedAt),
              тиша_від_початку_хв: p.shift.silentSinceStartMin,
            }
          : null,
        останній_сигнал_хв_тому: p.minutesAgo,
        швидкість_км_год: p.speedKmh == null ? null : Math.round(p.speedKmh),
        пройдено_км: p.distanceKm,
        замовлень_сьогодні: p.ordersToday,
        планшет: p.device
          ? {
              живий: p.device.alive,
              пише_трек: p.device.tracking,
              батарея_відсотків: p.device.batteryPct,
              версія: p.device.appVersion ?? p.installedVersion,
              gps_дозвіл: p.device.locationPermission,
              у_буфері: p.device.buffered,
              остання_помилка: p.device.lastError,
            }
          : null,
        проблема: p.problem,
      })),
      примітка:
        "Тиша планшета не означає, що людина не працює: зв'язку могло не бути, точки приїжджають пачкою пізніше.",
    };
  },
};

/* ── Зміни ────────────────────────────────────────────────────────────── */

export const shiftsReportTool: ToolDef = {
  name: "shifts_report",
  label: "Дивлюся зміни торгових",
  kinds: ["ADMIN"],
  description:
    "Зміни й поїздки торгових за період. mode=\"people\" (за замовчуванням): по людях — змін і днів, робочі км з одометра, GPS-км, особисті, пальне в літрах і гривнях, підозрілі одометри, відкриті зміни і віддача поїздок: продажі й вал у дні змін, скільки відсотків валу з'їло пальне, вал на кілометр, візити, км на візит. mode=\"days\": ПОЇЗДКИ ПО ДНЯХ — кожен день кожної людини: одометр проти треку планшета, візити й пропуски, зібрані гроші, продажі й вал того дня, пальне, вал на км і прапорці «подивись» (трек не писався, їздив без візитів чи продажів, пальне з'їло понад третину валу). Викликай на «зміни», «пробіг», «кілометраж», «пальне», «одометр», «хто не закрив зміну»; days — на «поїздки торгових», «проаналізуй поїздки», «хто їздить без толку», «одометр проти GPS по днях», «чи окупаються виїзди». mode=\"fleet\": АВТОПАРК — машини (авто фірми й власні авто торгових): хто на чому їздить, КІЛОМЕТРАЖ машини за період (робочі + особисті км зі змін, пальне), поточний одометр, коли міняти масло й інше ТО (прострочено / скоро / скільки км і днів лишилось), журнал замін масла й деталей з сумами, витрати на обслуговування за період (без дат — з 1 січня), бухгалтерська амортизація й залишкова вартість; vehicle — номер, модель або прізвище того, хто їздить (тоді ще й журнал). Викликай fleet на «машини», «автопарк», «коли міняти масло», «ТО», «ремонт авто», «скільки пішло на машину», «амортизація».",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["people", "days", "fleet"],
        description: "people — підсумок по людях; days — розбір по днях; fleet — автопарк: машини, ТО, обслуговування, амортизація. Без поля — people.",
      },
      rep: { type: "string", description: "Прізвище людини. Без нього — усі, хто за кермом." },
      vehicle: { type: "string", description: "Лише для fleet: номер, модель або прізвище того, хто їздить." },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
    const period = checkedPeriod(ctx.today, args);
    const mode = enumOf(args.mode, "mode", ["people", "days", "fleet"] as const, "people");

    if (mode === "fleet") {
      // Витрати на машини питають «за рік» частіше, ніж «за місяць».
      const since = hasPeriodArgs(args) ? period.from : kyivDayStart(`${ctx.today.slice(0, 4)}-01-01`);
      const vehicle = typeof args.vehicle === "string" && args.vehicle.trim()
        ? str(args.vehicle, "vehicle", { min: 2, max: 60 })
        : typeof args.rep === "string" && args.rep.trim()
          ? str(args.rep, "rep", { min: 2, max: 60 })
          : null;
      return fleetReportFacts({ today: ctx.today, from: since, to: period.to, vehicle });
    }

    let onlyId: string | null = null;
    if (typeof args.rep === "string" && args.rep.trim()) {
      const match = await resolveStaff(str(args.rep, "rep", { min: 2, max: 60 }), ["SALES", "DRIVER"]);
      if (!match.ok) return staffProblem(match, "співробітника");
      onlyId = match.user.id;
    }

    if (mode === "days") return tripDaysReport(period, onlyId);

    const [facts, vehicles, staff, watch, tripFacts] = await Promise.all([
      shiftFactsByUser(period.from, period.to, onlyId),
      prisma.salesVehicle.findMany({ select: { repId: true, fuelConsumption: true, fuelPricePerL: true } }),
      listStaff(["SALES", "DRIVER", "WAREHOUSE"]),
      prisma.shift.findMany({
        where: {
          startedAt: { gte: period.from, lte: period.to },
          ...(onlyId ? { userId: onlyId } : {}),
          OR: [{ odometerSuspicious: true }, { status: "OPEN" }, { lateCloseSource: { startsWith: "AUTO" } }],
        },
        orderBy: { startedAt: "desc" },
        take: 15,
        select: {
          userId: true,
          startedAt: true,
          endedAt: true,
          status: true,
          distanceKm: true,
          odometerSuspicious: true,
          lateCloseSource: true,
        },
      }),
      repTripDays(period.from, period.to, onlyId),
    ]);

    const nameOf = new Map(staff.map((s) => [s.id, s.name]));
    const vehicleOf = new Map(vehicles.map((v) => [v.repId, v]));
    const marking = visitMarkers(tripFacts);
    const tripsOf = new Map<string, TripDay[]>();
    for (const f of tripFacts) {
      const list = tripsOf.get(f.userId) ?? [];
      list.push(tripDay(f, vehicleOf.get(f.userId) ?? null, { marksVisits: marking.has(f.userId) }));
      tripsOf.set(f.userId, list);
    }

    const rows = facts
      .map((f) => {
        const fuel = fuelCost(f.workKm, vehicleOf.get(f.userId) ?? null, f.daysWorked);
        return {
          user_id: f.userId,
          ім_я: nameOf.get(f.userId) ?? "—",
          змін: f.shifts,
          днів: f.daysWorked,
          робочих_км: Math.round(f.workKm),
          gps_км: Math.round(f.gpsKm),
          особистих_км: Math.round(f.personalKm),
          км_лише_за_gps: Math.round(f.gpsOnlyKm),
          підозрілих: f.suspicious,
          відкритих: f.openShifts,
          пальне_л: Math.round(fuel.liters),
          пальне_грн: uah(fuel.cost),
          поїздки: tripsReturn(tripsOf.get(f.userId) ?? [], fuel.cost, f.workKm),
        };
      })
      .filter((r) => r.ім_я !== "—" || r.змін > 0)
      .sort((a, b) => b.робочих_км - a.робочих_км);

    /**
     * Що зробить автозакриття — лише коли період включає сьогодні.
     * За минулий тиждень це питання не має сенсу: ті зміни вже закриті.
     */
    const includesToday = period.toDay === ctx.today;
    const openNow = includesToday ? await autoCloseStaleShifts(new Date(), { dryRun: true }) : [];

    return {
      період: periodFacts(period),
      по_людях: rows,
      разом: {
        змін: rows.reduce((s, r) => s + r.змін, 0),
        робочих_км: rows.reduce((s, r) => s + r.робочих_км, 0),
        пальне_грн: rows.reduce((s, r) => s + r.пальне_грн, 0),
        підозрілих: rows.reduce((s, r) => s + r.підозрілих, 0),
      },
      подивитись: watch.map((s) => ({
        ім_я: nameOf.get(s.userId) ?? "—",
        день: ymd(s.startedAt),
        що: s.status === "OPEN"
          ? "зміна ще відкрита"
          : s.odometerSuspicious
            ? "неправдоподібний одометр"
            : "закрилася автоматично",
        км: s.distanceKm == null ? null : Math.round(s.distanceKm),
      })),
      зараз_відкриті: openNow.map((d) => ({
        ім_я: d.name,
        відкрита_о: ymd(d.startedAt),
        рішення: d.close ? `закриється (${d.close.source})` : "поки не закривається",
        чому: d.reason,
      })),
      примітка:
        "Робочі кілометри — з одометра (фото зміни); GPS — перевірка, а не база розрахунку. «поїздки» — продажі й вал торгового в дні, коли була зміна (усі його документи тих днів, зокрема телефонні). Розбір по днях — mode=days.",
    };
  },
};

/** Хто за період узагалі ставив відмітки візитів — лише їм прапорець «без візитів». */
function visitMarkers(facts: TripDayFacts[]): Set<string> {
  return new Set(facts.filter((f) => f.visitsDone + f.visitsMissed > 0).map((f) => f.userId));
}

/**
 * Віддача поїздок людини за період: що принесли дні зі зміною.
 *
 * Пальне тут те саме, що в рядку людини (одометр × норма машини), тож
 * відсоток і «вал на км» сходяться з колонками поруч.
 */
function tripsReturn(days: TripDay[], fuelUah: number, workKm: number) {
  if (days.length === 0) return null;
  const sales = days.reduce((s, d) => s + d.salesAmount, 0);
  const costed = days.filter((d) => d.marginEst !== null);
  const margin = costed.length ? costed.reduce((s, d) => s + (d.marginEst ?? 0), 0) : null;
  const visits = days.reduce((s, d) => s + d.visitsDone, 0);
  return {
    днів_зі_зміною: days.length,
    днів_без_продажу: days.filter((d) => d.salesDocs === 0).length,
    продажі_грн: uah(sales),
    вал_грн: margin === null ? null : uah(margin),
    пальне_відсотків_валу: margin !== null && margin > 0 ? Math.round((fuelUah / margin) * 1000) / 10 : null,
    вал_на_км: margin !== null && workKm > 0 ? Math.round(margin / workKm) : null,
    візитів: visits,
    км_на_візит: visits > 0 ? Math.round((workKm / visits) * 10) / 10 : null,
    днів_з_прапорцями: days.filter((d) => d.flags.length > 0).length,
  };
}

/** Скільки днів віддаємо за раз: більше — вже не читається і дорого в токенах. */
const TRIP_DAYS_LIMIT = 60;

/** shifts_report mode=days: поїздки кожного дня кожної людини. */
async function tripDaysReport(period: ReturnType<typeof checkedPeriod>, onlyId: string | null) {
  const [facts, vehicles, staff] = await Promise.all([
    repTripDays(period.from, period.to, onlyId),
    prisma.salesVehicle.findMany({ select: { repId: true, label: true, fuelConsumption: true, fuelPricePerL: true } }),
    listStaff(["SALES", "DRIVER", "WAREHOUSE"]),
  ]);
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const vehicleOf = new Map(vehicles.map((v) => [v.repId, v]));
  const marking = visitMarkers(facts);
  const days = facts.map((f) => tripDay(f, vehicleOf.get(f.userId) ?? null, { marksVisits: marking.has(f.userId) }));

  const shown = days.slice(0, TRIP_DAYS_LIMIT);
  const people = [...new Set(days.map((d) => d.userId))];
  const flagCount = new Map<string, number>();
  for (const d of days) for (const f of d.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1);

  return {
    період: periodFacts(period),
    по_днях: shown.map((d) => ({
      день: d.day,
      ім_я: nameOf.get(d.userId) ?? "—",
      км_одометр: d.odometerKm === null ? null : Math.round(d.odometerKm),
      км_трек: d.gpsKm === null ? null : Math.round(d.gpsKm),
      км_лише_трек: d.gpsOnlyKm > 0 ? Math.round(d.gpsOnlyKm) : undefined,
      одометр_до_треку: d.odometerToGps,
      пальне_грн: d.fuel === null ? null : uah(d.fuel),
      візитів: d.visitsDone,
      пропущено: d.visitsMissed,
      зібрано_грн: uah(d.collected),
      продажі_грн: uah(d.salesAmount),
      документів: d.salesDocs,
      клієнтів_купили: d.salesClients,
      вал_грн: d.marginEst === null ? null : uah(d.marginEst),
      пальне_відсотків_валу: d.fuelShareOfMarginPct,
      вал_на_км: d.marginPerKm,
      км_на_візит: d.kmPerVisit,
      подивитись: d.flags.length ? d.flags : undefined,
    })),
    показано_днів: shown.length,
    усього_днів: days.length,
    що_найчастіше: [...flagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([що, днів]) => ({ що, днів })),
    норми_пального: people.map((id) => {
      const v = vehicleOf.get(id);
      return {
        ім_я: nameOf.get(id) ?? "—",
        норма: v
          ? `${v.fuelConsumption} на 100 км × ${v.fuelPricePerL} ₴${v.label ? ` (${v.label})` : ""}`
          : "машину не заведено — типові 10 л/100 км × 56 ₴",
      };
    }),
    примітка: [
      days.length > shown.length
        ? `Показано ${shown.length} найсвіжіших днів з ${days.length} — для решти звузь період або назви людину.`
        : "",
      marking.size === 0
        ? "Відміток візитів за період немає ні в кого — заїзди до клієнтів видно лише з треку на екрані зміни, тож мірило дня тут — «клієнтів_купили»."
        : "",
      "Км одометра — з фото зміни, км треку — лише їзда за GPS планшета в тих самих змінах; норма «одометр/трек» 0,8–1,3; км_лише_трек — зміни без фото одометра, у пальне не йдуть. Пальне — з одометра за нормою машини людини. Продажі й вал — усі документи торгового того дня (зокрема телефонні), вал — сума мінус собівартість. Дні без зміни сюди не входять.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/* ── Водії ────────────────────────────────────────────────────────────── */

export const driversReportTool: ToolDef = {
  name: "drivers_report",
  label: "Дивлюся водіїв і зарплату",
  kinds: ["ADMIN"],
  description:
    "Водії за період: маршрутні листи, кілометри й факт проти плану, оплачувані точки в місті й області, зарплата, привезений оборот, гривні на точку й частка зарплати від обороту — з медіанами команди. Параметр driver додає розклад по листах і бонусах. Викликай на «зарплата водіїв», «скільки заробив», «ефективність водіїв», «вартість точки».",
  parameters: {
    type: "object",
    properties: {
      driver: { type: "string", description: "Прізвище водія. Без нього — усі водії." },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
    const period = checkedPeriod(ctx.today, args);

    let onlyDriver: { id: string; name: string } | null = null;
    if (typeof args.driver === "string" && args.driver.trim()) {
      const match = await resolveStaff(str(args.driver, "driver", { min: 2, max: 60 }), ["DRIVER"]);
      if (!match.ok) return staffProblem(match, "водія");
      onlyDriver = { id: match.user.id, name: match.user.name };
    }

    const report = await driverEfficiencyFacts(period.from, period.to);
    const drivers = onlyDriver ? report.drivers.filter((d) => d.driverId === onlyDriver!.id) : report.drivers;

    let details: unknown = undefined;
    if (onlyDriver) {
      const [sheets, bonuses, rates] = await Promise.all([
        buildDriverFacts(onlyDriver.id, period.from, period.to),
        loadBonuses(period.from, period.to, onlyDriver.id),
        getRates(),
      ]);
      const payroll = calculateDriverPeriod(onlyDriver.id, sheets, bonuses, rates);
      details = {
        листи: payroll.sheets.slice(0, 20).map((s) => ({
          день: s.facts.day,
          номер: s.facts.number,
          джерело: s.facts.source === "SHEET_1C" ? "лист 1С" : "маршрут сайту",
          км: Math.round(s.facts.distanceKm),
          точок: s.facts.cityPoints + s.facts.oblastPoints,
          сума_замовлень: uah(s.facts.ordersTotal),
          борги_в_листі: uah(s.facts.debtsTotal),
          заробіток: uah(s.total),
        })),
        бонуси: payroll.bonusLines.map((b) => ({ за_що: b.label, сума: uah(b.amount) })),
        разом: {
          за_листи: uah(payroll.sheetsTotal),
          бонуси: uah(payroll.bonusesTotal),
          разом: uah(payroll.total),
        },
      };
    }

    return {
      період: periodFacts(period),
      водії: drivers.map((d) => ({
        водій_id: d.driverId,
        водій: d.name,
        листів: d.sheets,
        листів_без_пробігу: d.sheetsWithoutKm,
        км: Math.round(d.totalKm),
        км_проти_плану_відсотків: pct(d.kmVsPlanPct),
        точок_місто: d.cityPoints,
        точок_область: d.oblastPoints,
        зарплата: uah(d.payrollTotal),
        привезено_обороту: uah(d.deliveredTurnover),
        зарплата_від_обороту_відсотків: pct(d.payrollToTurnoverPct),
        грн_на_точку: uah(d.costPerPoint),
        км_на_точку: d.kmPerPoint == null ? null : Math.round(d.kmPerPoint * 10) / 10,
        підозрілих_змін: d.anomalies.suspiciousShifts,
        автозакритих_змін: d.anomalies.autoClosedShifts,
        листів_понад_план: d.anomalies.kmOverPlan,
      })),
      медіани: {
        грн_на_точку: uah(report.medians.costPerPoint),
        км_на_точку: report.medians.kmPerPoint == null ? null : Math.round(report.medians.kmPerPoint * 10) / 10,
        зарплата_від_обороту_відсотків: pct(report.medians.payrollToTurnoverPct),
      },
      листів_без_водія: report.unassignedSheets,
      деталі: details,
      примітка:
        "Зарплата рахується за маршрутними листами сайту; лист із 1С без маршруту платить нижній тір, а майбутні дні не платяться взагалі.",
    };
  },
};

/* ── Замовлення з сайту ───────────────────────────────────────────────── */

/** Скільки годин чекання ще норма, а скільки вже запізно. */
const ORDER_WARN_H = 2;
const ORDER_LATE_H = 12;

export const siteOrdersTool: ToolDef = {
  name: "site_orders",
  label: "Дивлюся замовлення з сайту",
  kinds: ["ADMIN"],
  description:
    "Замовлення з інтернет-магазину: скільки й на яку суму по кожному статусу за період, які найдовше чекають обробки (з містом, сумою й способом доставки), і скільки чернеток висить у торгових. Викликай на «замовлення з сайту», «нові замовлення», «необроблені», «чернетки торгових».",
  parameters: {
    type: "object",
    properties: {
      ...PERIOD_PARAMS,
      include_drafts: { type: "boolean", description: "Додати чернетки торгових. За замовчуванням так." },
    },
  },
  async run(ctx, args) {
    // Без жодного натяку на період — тиждень, а не місяць: сайтові замовлення живуть днями.
    const period = hasPeriodArgs(args) ? checkedPeriod(ctx.today, args) : periodFromArgs(ctx.today, { days: 7 });
    const withDrafts = bool(args.include_drafts, true);

    const [byStatus, pending, drafts, staff] = await Promise.all([
      prisma.order.groupBy({
        by: ["status"],
        where: { createdAt: { gte: period.from, lte: period.to } },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      /**
       * Нові замовлення беремо БЕЗ періоду: замовлення, яке висить із
       * минулого тижня, — найважливіше з усього звіту, а період його б
       * якраз і сховав.
       */
      prisma.order.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        take: 15,
        select: {
          orderNumber: true,
          createdAt: true,
          contactName: true,
          city: true,
          totalAmount: true,
          deliveryMethod: true,
          salesRep: { select: { name: true } },
          user: { select: { name: true } },
        },
      }),
      withDrafts
        ? prisma.salesDocument.groupBy({
            by: ["salesRepId"],
            where: { docType: "ORDER", status: "DRAFT" },
            _count: { _all: true },
            _sum: { totalAmount: true },
          })
        : Promise.resolve([]),
      listStaff(["SALES"]),
    ]);

    const nameOf = new Map(staff.map((s) => [s.id, s.name]));
    const now = Date.now();

    return {
      період: periodFacts(period),
      по_статусах: byStatus
        .map((s) => ({
          статус: ORDER_STATUS_LABELS[s.status as OrderStatus] ?? s.status,
          кількість: s._count._all,
          сума: uah(s._sum.totalAmount ?? 0),
        }))
        .sort((a, b) => b.кількість - a.кількість),
      чекають_обробки: pending.map((o) => ({
        номер: o.orderNumber,
        створено: ymd(o.createdAt),
        годин_чекає: Math.round((now - o.createdAt.getTime()) / 3_600_000),
        клієнт: o.contactName ?? o.user?.name ?? "—",
        місто: o.city,
        сума: uah(o.totalAmount),
        доставка: DELIVERY_METHOD_LABELS[o.deliveryMethod as "DELIVERY" | "PICKUP"] ?? o.deliveryMethod,
        торговий: o.salesRep?.name ?? null,
      })),
      чернетки_торгових: withDrafts
        ? drafts
            .map((d) => ({
              торговий: d.salesRepId ? (nameOf.get(d.salesRepId) ?? "—") : "без торгового",
              чернеток: d._count._all,
              сума: uah(d._sum.totalAmount ?? 0),
            }))
            .sort((a, b) => b.чернеток - a.чернеток)
        : undefined,
      примітка: `Чекає ${ORDER_WARN_H} год — норма, ${ORDER_LATE_H} год — уже запізно. Чернетка торгового — заготовка з 1С, не замовлення покупця.`,
    };
  },
};

/* ── Склад ────────────────────────────────────────────────────────────── */

/**
 * ABC/XYZ одним обʼєктом для моделі.
 *
 * Звіт віддає до 300 рядків — моделі стільки не треба: класи, матриця й
 * три короткі списки (A, A×Z, C×Z) відповідають на «що тримає оборот» і
 * «що виводити» без переказу всієї таблиці. Артикули дотягуємо окремо:
 * у рядках звіту їх немає, а без артикула товар в офісі не знайдуть.
 */
async function abcFacts(
  period: ReturnType<typeof periodFromArgs>,
  dimension: AbcDimension,
  basis: AbcBasis,
  brand: { id: string; name: string } | null
) {
  const report = await buildAbcReport(period.from, period.to, dimension, null, 300, basis);
  // Бренд звужує лише списки: класи рахувалися по всьому асортименту.
  const rows =
    brand && dimension === "product"
      ? report.rows.filter((r) => (r.brandName ?? "").toLowerCase() === brand.name.toLowerCase())
      : report.rows;

  const topA = rows.filter((r) => r.abc === "A").slice(0, 15);
  const shakyA = rows.filter((r) => r.abc === "A" && r.xyz === "Z").slice(0, 5);
  const deadC = dimension === "product" ? rows.filter((r) => r.abc === "C" && r.xyz === "Z").slice(0, 5) : [];

  const skuOf = new Map<string, string | null>();
  if (dimension === "product") {
    const ids = [...new Set([...topA, ...shakyA, ...deadC].map((r) => r.id))];
    const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true } });
    for (const p of products) skuOf.set(p.id, p.sku);
  }

  const idKey = dimension === "product" ? "товар_id" : dimension === "client" ? "клієнт_id" : "бренд_id";
  const row = (r: AbcRow) => ({
    [idKey]: r.id,
    назва: r.name,
    ...(dimension === "product" ? { артикул: skuOf.get(r.id) ?? null, бренд: r.brandName ?? null } : {}),
    клас: `${r.abc}${r.xyz ?? ""}`,
    оборот: uah(r.amount),
    прибуток: r.marginPct == null ? null : uah(r.profit),
    маржа_відсотків: r.marginPct == null ? null : pct(r.marginPct),
    частка_обороту_відсотків: pct(r.share),
    документів: r.docs,
    місяців_активних: r.activeMonths,
  });

  return {
    період: periodFacts(period),
    вимір: dimension === "product" ? "товари" : dimension === "brand" ? "бренди" : "клієнти",
    база: basis === "profit" ? "прибуток" : "оборот",
    бренд: brand?.name ?? "усі бренди",
    разом_оборот: uah(report.total),
    покриття_собівартості_відсотків: pct(report.coverage),
    місяців: report.months,
    xyz_доступний: report.xyzAvailable,
    класи: report.summary.map((s) => ({
      клас: s.abc,
      позицій: s.count,
      оборот: uah(s.amount),
      частка_позицій_відсотків: pct(s.countShare),
      частка_обороту_відсотків: pct(s.amountShare),
    })),
    матриця: report.matrix.map((c) => ({ клас: `${c.abc}${c.xyz}`, позицій: c.count, оборот: uah(c.amount) })),
    топ_A: topA.map(row),
    A_нерівні: shakyA.length ? shakyA.map(row) : undefined,
    C_нерівні_кандидати_на_виведення: deadC.length ? deadC.map(row) : undefined,
    примітка:
      "A — перші 80 % обороту, B — наступні 15 %, C — останні 5 %. X/Y/Z — рівність продажів по місяцях: Z — беруть від випадку до випадку. Маржа — лише де 1С передала собівартість; за прибутком (basis=profit) класи рахуються тільки по таких рядках." +
      (brand && dimension === "product" ? " Бренд звузив лише списки, класи рахувались по всьому асортименту." : ""),
  };
}

export const stockHealthTool: ToolDef = {
  name: "stock_health",
  label: "Дивлюся склад",
  kinds: ["ADMIN"],
  description:
    "Стан складу: дефіцит (що продається й скінчилось, скільки замовити й на яку суму, по яких брендах), оборотність (запас у грошах, скільки лежить без руху, обертів на рік), мертві залишки, ABC/XYZ (mode=abc) і СЕЗОН (mode=season: які групи входять у сезон найближчі місяці й чого бракує на складі саме під нього). Параметр brand звужує до бренду, mode обирає блок. Викликай на «що замовити», «дефіцит», «закінчується», «нуль на складі», «оборотність», «мертвий запас», «ABC», «що тримає оборот по товарах», а на «що сезонне», «до чого готуватись», «що брати на зиму», «сезонність» — mode=season.",
  parameters: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Назва бренду або її частина." },
      mode: {
        type: "string",
        enum: ["low", "turnover", "dead", "all", "abc", "season"],
        description:
          "low — дефіцит (за замовчуванням), turnover — оборотність, dead — мертві залишки, all — усе разом, abc — ABC/XYZ-аналіз, season — сезон: що входить у сезон і чого під нього бракує.",
      },
      dimension: {
        type: "string",
        enum: ["product", "brand", "client"],
        description: "Лише для mode=abc: по товарах (за замовчуванням), брендах чи клієнтах.",
      },
      basis: {
        type: "string",
        enum: ["amount", "profit"],
        description: "Лише для mode=abc: класи за оборотом (за замовчуванням) чи за валовим прибутком.",
      },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
    const mode =
      args.mode == null
        ? "low"
        : enumOf(args.mode, "mode", ["low", "turnover", "dead", "all", "abc", "season"] as const);

    let brand: { id: string; name: string } | null = null;
    if (typeof args.brand === "string" && args.brand.trim()) {
      const query = str(args.brand, "brand", { min: 2, max: 40 });
      // Не findFirst: на «бриг» він мовчки брав першого з трьох «Бригадирів».
      const match = await resolveBrand(query);
      if (!match.ok) return brandProblem(match, query);
      brand = match.brand;
    }

    if (mode === "abc") {
      const dimension =
        (args.dimension == null
          ? null
          : enumOf(args.dimension, "dimension", ["product", "brand", "client"] as const)) ?? "product";
      const basis = (args.basis == null ? null : enumOf(args.basis, "basis", ["amount", "profit"] as const)) ?? "amount";
      // ABC без періоду — пів року: місяць дає замало місяців для XYZ.
      const period = hasPeriodArgs(args) ? checkedPeriod(ctx.today, args) : periodFromArgs(ctx.today, { days: 180 });
      return abcFacts(period, dimension, basis, brand);
    }

    if (mode === "season") {
      /*
       * Сезон: що входить у сезон і чого під нього бракує.
       *
       * Два питання, які власник ставив живцем і на які помічник не міг
       * відповісти: «який саме зимовий товар треба закупити» і «у мене на
       * залишках мало генераторів, чому ти мені їх не пропонуєш».
       *
       * Інструмент віддає ГОТОВЕ очікування або нічого. Індекс сам по
       * собі сюди не потрапляє як число, яке можна на щось помножити:
       * модель уже одного разу намагалася перемножити коефіцієнт на
       * оборот і отримати прогноз у гривнях.
       */
      const month = Number(ctx.today.slice(5, 7));
      const [rising, low] = await Promise.all([
        risingGroups({ month, aheadMonths: 2, limit: 8 }),
        buildLowStockReport({ brandId: brand?.id ?? null, ...DEFAULT_PARAMS, season: true }),
      ]);

      if (rising.length === 0 && (low?.seasonWatch.length ?? 0) === 0) {
        const { years } = await completeYears();
        return {
          бренд: brand?.name ?? "усі бренди",
          сезон: null,
          пояснення:
            years.length === 0
              ? "Сезонний профіль ще не побудований: у базі немає жодного повного року реалізацій. Порівнювати місяці з минулими роками поки нема з чим."
              : `Профіль побудований на роках ${years.join(", ")}, але груп з високою довірою, що входять у сезон найближчі два місяці, зараз немає.`,
        };
      }

      return {
        бренд: brand?.name ?? "усі бренди",
        місяць: month,
        входять_у_сезон: rising.map((g) => ({
          група: g.label,
          у_скільки_разів_більше_за_поточний_місяць: Math.round(g.factor * 100) / 100,
          роки_спостережень: g.years,
        })),
        готуватися_до_сезону: (low?.seasonWatch ?? []).slice(0, 15).map((i) => ({
          товар_id: i.id,
          назва: i.name,
          артикул: i.sku,
          бренд: i.brandName,
          залишок: i.stock,
          замовити: i.suggested,
          ціна: uah(i.price),
          сезон_підняв_у_разів: i.seasonFactor,
          сезон_узято_з: i.seasonFrom,
        })),
        як_читати:
          "Числа «у скільки разів» — це порівняння місяця з місяцем усередині року, вже очищене від загального руху фірми. Множити їх на оборот НЕ можна: скільки замовити — уже пораховано в полі «замовити».",
      };
    }

    const wantLow = mode === "low" || mode === "all";
    const wantTurnover = mode === "turnover" || mode === "all";
    const wantDead = mode === "dead" || mode === "all";

    const [low, turnover, dead] = await Promise.all([
      wantLow ? buildLowStockReport({ brandId: brand?.id ?? null, ...DEFAULT_PARAMS }) : Promise.resolve(null),
      wantTurnover ? buildTurnoverReport(brand?.id ?? null, { worstLimit: 10 }) : Promise.resolve(null),
      wantDead
        ? deadStockItems({
            repId: ctx.scope.repId,
            brand: brand?.name ?? null,
            minDays: DEAD_STOCK_DAYS,
            limit: 10,
          })
        : Promise.resolve(null),
    ]);

    // Пекучі позиції лежать у sections → groups → items; розгортаємо в один список.
    const urgent = low
      ? low.sections
          .flatMap((s) => s.groups.flatMap((g) => g.items))
          .filter((i) => i.severity <= 1)
          .sort((a, b) => a.severity - b.severity || b.sold90 - a.sold90)
          .slice(0, 15)
          .map((i) => ({
            товар_id: i.id,
            назва: i.name,
            артикул: i.sku,
            бренд: i.brandName,
            залишок: i.stock,
            продано_за_вікно: i.sold90,
            вистачить_днів: i.daysLeft,
            замовити: i.suggested,
            ціна: uah(i.price),
          }))
      : undefined;

    return {
      бренд: brand?.name ?? "усі бренди",
      дефіцит: low
        ? {
            позицій: low.total,
            до_замовлення: low.toOrder,
            нуль_на_складі: low.zeroStock,
            пекучих: low.urgent,
            сума_закупівлі: uah(low.orderCost),
            без_ціни: low.noPrice,
            вікно_днів: low.velocityDays,
            по_брендах: low.brands.slice(0, 12).map((b) => ({
              бренд: b.name,
              до_замовлення: b.toOrder,
              нуль: b.outOfStock,
              сума: uah(b.orderCost),
            })),
            пекучі: urgent,
          }
        : undefined,
      оборотність: turnover
        ? {
            позицій: turnover.totals.items,
            запас_грн: uah(turnover.totals.stockValue),
            без_руху_позицій: turnover.totals.stale,
            без_руху_грн: uah(turnover.totals.staleValue),
            частка_мертвих_відсотків: pct(turnover.totals.staleShare),
            обертів_на_рік: turnover.totals.turns == null ? null : Math.round(turnover.totals.turns * 100) / 100,
            найгірші: turnover.worst.slice(0, 10).map((w) => ({
              товар_id: w.id,
              назва: w.name,
              артикул: w.sku,
              залишок: w.stock,
              вартість: uah(w.value),
              днів_без_продажу: w.daysSinceSale,
            })),
          }
        : undefined,
      мертві: dead
        ? dead.map((d) => ({
            товар_id: d.productId,
            назва: d.name,
            артикул: d.sku,
            бренд: d.brand,
            залишок: d.free,
            собівартість: uah(d.lastCost),
            остання_продажа: ymd(d.lastSale),
          }))
        : undefined,
      примітка:
        "Запас оцінено собівартістю там, де вона відома, і прайсом там, де ні — тобто трохи завищено.",
    };
  },
};

/* ── Обмін із 1С ──────────────────────────────────────────────────────── */

export const syncHealthTool: ToolDef = {
  name: "sync_health",
  label: "Перевіряю обмін з 1С",
  kinds: ["ADMIN"],
  description:
    "Стан обміну з 1С: чи озивається агент на сервері, коли був останній прогін і чим закінчився, скільки прогонів і збоїв за добу, коли кожен канал (ціни, залишки, документи, борги) востаннє привозив дані, які розбіжності не розібрані. Викликай на «обмін», «синхронізація», «1С», «чи оновилось», «розбіжності», «агент».",
  parameters: { type: "object", properties: {} },
  async run() {
    const h = await syncHealthFacts();
    return {
      зараз: ymd(h.now),
      агент: {
        останній_звязок: ymd(h.agent.lastSeen),
        хвилин_тому: h.agent.minutesAgo,
        стан: h.agent.silent ? "мовчить" : "живий",
      },
      останній_прогін: h.lastRun
        ? {
            коли: h.lastRun.startedAt,
            тип: h.lastRun.type,
            стан: h.lastRun.status,
            завершено: h.lastRun.completedAt,
          }
        : null,
      за_добу: { прогонів: h.last24h.jobs, невдалих: h.last24h.failed },
      останні_прогони: h.recentJobs.map((j) => ({
        коли: ymd(j.startedAt),
        тип: j.type,
        стан: j.status,
        записів: j.total,
        помилок: j.failed,
        розбіжностей: j.discrepancies,
      })),
      свіжість_каналів: h.channels.map((c) => ({
        канал: c.entityType,
        останній_батч: ymd(c.lastAt),
        годин_тому: c.hoursAgo,
        свіжий: !c.stale,
      })),
      розбіжності: h.unresolved.slice(0, 12).map((u) => ({
        вид: u.entityType,
        поле: u.field,
        кількість: u.count,
      })),
      борги_оновлено: ymd(h.debtsSyncedAt),
      помилки: h.recentJobs.flatMap((j) => j.errors).slice(0, 5),
      примітка:
        "Успішний прогін не означає свіжі дані по КОЖНОМУ каналу: запит на боці 1С міг упасти окремо — про це каже саме свіжість каналів.",
    };
  },
};

/** Порядок тут — порядок, у якому їх читає модель: спершу «що зараз», далі гроші, далі склад. */
/* Реєстрація — у tools/index.ts: порядок там і є порядком у схемі для моделі. */
