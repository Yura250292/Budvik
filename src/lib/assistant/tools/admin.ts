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

import type { ToolDef } from "@/lib/assistant/types";
import { prisma } from "@/lib/prisma";
import { bool, day as validDay, enumOf, int, str } from "@/lib/assistant/validate";
import { uah, pct, ymd } from "@/lib/assistant/format";
import { periodFacts, periodFromArgs } from "@/lib/assistant/period";
import { kyivTime } from "@/lib/date/kyiv";
import { listStaff, resolveStaff, staffProblem } from "@/lib/assistant/facts/staff";
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
} from "@/lib/analytics/money-facts";
import { revenueByRepBrand, shiftFactsByUser, fuelCost } from "@/lib/analytics/facts";
import { payerVerdicts, verdictLabel } from "@/lib/assistant/facts/discipline-cache";
import { monthForecast } from "@/lib/assistant/facts/forecast";
import { livePositions } from "@/lib/track/live-positions";
import { autoCloseStaleShifts } from "@/lib/shift/auto-close";
import { driverEfficiencyFacts } from "@/lib/drivers/efficiency-facts";
import { buildDriverFacts, getRates, loadBonuses } from "@/lib/drivers/payroll-facts";
import { calculateDriverPeriod } from "@/lib/drivers/payroll";
import { buildLowStockReport, DEFAULT_PARAMS } from "@/lib/procurement/low-stock";
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
    "Продажі всієї команди за період: оборот, місце, реалізації, клієнти, середній чек, зібрані гроші, прострочка, повернення, динаміка, приріст боргу, а в поточному місяці ще й план і прогноз. Параметр rep — по одному торговому (прізвища досить), by_brand — розкладка по брендах. Викликай на будь-яке питання про продажі, оборот, команду, «хто скільки продав», «як фірма».",
  parameters: {
    type: "object",
    properties: {
      rep: { type: "string", description: "Прізвище або ім'я торгового. Без нього — вся команда." },
      by_brand: { type: "boolean", description: "true — додати розкладку обороту по брендах." },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
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
    "Дебіторка всієї фірми: скільки винні й скільки прострочено, розклад по торгових із приростом боргу, найбільші боржники з вердиктом платника й віком боргу, скільки зібрано за період. Параметр rep звужує до одного торгового. Викликай на «дебіторка», «борги», «хто винен», «прострочка», «найбільші боржники».",
  parameters: {
    type: "object",
    properties: {
      rep: { type: "string", description: "Прізвище торгового. Без нього — вся фірма." },
      overdue_only: { type: "boolean", description: "true — лише клієнти з простроченим боргом." },
      top: { type: "integer", description: "Скільки боржників показати, до 25. За замовчуванням 15." },
      days: { type: "integer", description: "За скільки днів рахувати зібрані гроші. За замовчуванням 30." },
    },
  },
  async run(ctx, args) {
    const top = int(args.top, "top", { min: 3, max: 25, fallback: 15 });
    const window = int(args.days, "days", { min: 1, max: 365, fallback: 30 });
    const overdueOnly = bool(args.overdue_only, false);
    const period = periodFromArgs(ctx.today, { days: window });

    let onlyRep: { id: string; name: string } | null = null;
    if (typeof args.rep === "string" && args.rep.trim()) {
      const match = await resolveStaff(str(args.rep, "rep", { min: 2, max: 60 }), ["SALES"]);
      if (!match.ok) return staffProblem(match, "торгового");
      onlyRep = { id: match.user.id, name: match.user.name };
    }

    const [rows, verdicts, collected, delta, staff] = await Promise.all([
      receivableRowsByRep(onlyRep?.id ?? null),
      payerVerdicts(),
      collectedByRepBrand(period.from, period.to, onlyRep?.id ?? null),
      debtDeltaByRep(period.from, period.to),
      listStaff(["SALES"]),
    ]);

    const nameOf = new Map(staff.map((s) => [s.id, s.name]));
    const total = sumAging(rows);
    const byRep = agingByRep(rows);
    const collectedMap = collectedTotals(collected);

    const debtors = toDebtorList(rows)
      .filter((d) => (overdueOnly ? d.overdue > 0 : true))
      .slice(0, top);
    const repOfClient = new Map(rows.map((r) => [r.counterpartyId, r.repId]));

    return {
      разом: {
        борг: uah(total.total),
        прострочено: uah(total.overdue),
        прострочено_відсотків: pct(total.overdueRatio),
        боржників: new Set(rows.map((r) => r.counterpartyId)).size,
        без_торгового: uah(rows.filter((r) => !r.repId).reduce((s, r) => s + r.debt, 0)),
      },
      по_торгових: [...byRep.entries()]
        .map(([repId, aging]) => ({
          торговий_id: repId,
          торговий: nameOf.get(repId) ?? "—",
          борг: uah(aging.total),
          прострочено: uah(aging.overdue),
          прострочено_відсотків: pct(aging.overdueRatio),
          зібрано_за_період: uah(collectedMap.get(repId)?.amount ?? 0),
          /**
           * Приріст рахується різницею двох знімків сальдо. Немає знімка
           * на початок періоду — немає й приросту: нуль чи «-12 млн» тут
           * означали б не рух боргу, а брак історії.
           */
          приріст_боргу: delta.get(repId)?.hasOpening ? uah(delta.get(repId)!.delta) : null,
        }))
        .sort((a, b) => b.борг - a.борг),
      найбільші_боржники: debtors.map((d) => ({
        клієнт_id: d.counterpartyId,
        клієнт: d.name,
        торговий: nameOf.get(repOfClient.get(d.counterpartyId) ?? "") ?? null,
        борг: uah(d.debt),
        прострочено: uah(d.overdue),
        найстаріше_днів: d.oldestDays,
        платник: verdictLabel(verdicts.verdicts.get(d.counterpartyId)),
        останнє_відвантаження: d.lastDocAt,
      })),
      зібрано_за_період: { ...periodFacts(period), сума: uah([...collectedMap.values()].reduce((s, c) => s + c.amount, 0)) },
      примітка:
        "Вік боргу відновлено з наших відвантажень: 1С строків оплати не передає, тому «прострочено» — оцінка.",
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
    "Зміни за період: скільки змін і робочих днів, робочі кілометри з одометра, GPS-кілометри, особисті, пальне в літрах і гривнях, підозрілі одометри й відкриті зміни. Плюс список того, що варто подивитися, і що зробить автозакриття з відкритими зараз. Викликай на «зміни», «пробіг», «кілометраж», «пальне», «одометр», «хто не закрив зміну».",
  parameters: {
    type: "object",
    properties: {
      rep: { type: "string", description: "Прізвище людини. Без нього — усі, хто за кермом." },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
    const period = checkedPeriod(ctx.today, args);

    let onlyId: string | null = null;
    if (typeof args.rep === "string" && args.rep.trim()) {
      const match = await resolveStaff(str(args.rep, "rep", { min: 2, max: 60 }), ["SALES", "DRIVER"]);
      if (!match.ok) return staffProblem(match, "співробітника");
      onlyId = match.user.id;
    }

    const [facts, vehicles, staff, watch] = await Promise.all([
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
    ]);

    const nameOf = new Map(staff.map((s) => [s.id, s.name]));
    const vehicleOf = new Map(vehicles.map((v) => [v.repId, v]));

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
        "Робочі кілометри — з одометра (фото зміни). GPS занижує: трек іде по прямій, тож він перевірка, а не база розрахунку.",
    };
  },
};

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
    "Стан складу: дефіцит (що продається й скінчилось, скільки замовити й на яку суму, по яких брендах), оборотність (запас у грошах, скільки лежить без руху, обертів на рік), мертві залишки і ABC/XYZ (mode=abc: класи по товарах, брендах або клієнтах за оборотом чи прибутком, з матрицею XYZ). Параметр brand звужує до бренду, mode обирає блок. Викликай на «що замовити», «дефіцит», «закінчується», «нуль на складі», «оборотність», «мертвий запас», «ABC», «що тримає оборот по товарах».",
  parameters: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Назва бренду або її частина." },
      mode: {
        type: "string",
        enum: ["low", "turnover", "dead", "all", "abc"],
        description:
          "low — дефіцит (за замовчуванням), turnover — оборотність, dead — мертві залишки, all — усе разом, abc — ABC/XYZ-аналіз.",
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
      args.mode == null ? "low" : enumOf(args.mode, "mode", ["low", "turnover", "dead", "all", "abc"] as const);

    let brand: { id: string; name: string } | null = null;
    if (typeof args.brand === "string" && args.brand.trim()) {
      const query = str(args.brand, "brand", { min: 2, max: 40 });
      brand = await prisma.brand.findFirst({
        where: { name: { contains: query, mode: "insensitive" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      if (!brand) return { помилка: `Бренду «${query}» у базі немає` };
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
