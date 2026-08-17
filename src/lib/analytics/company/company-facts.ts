/**
 * Факти для АІ-аналізу фірми: чотири секції, чотири збирачі.
 *
 * Модель не рахує нічого. Тут із уже наявних детермінованих модулів
 * (facts, money-facts, clients, abc, turnover, low-stock, drivers) збирається
 * блоб готових цифр українськими ключами, і саме він іде в промпт. Кожна
 * цифра, яку модель потім назве, звіряється з цим блобом — те, чого тут
 * немає, до звіту не потрапить.
 *
 * ТРИ ЧАСОВІ РАМКИ в одному звіті — головна пастка (той самий урок, що в
 * sales-analytics/summary): оборот і маржа — ПОТІК за обраний період;
 * виконання плану — за КАЛЕНДАРНИЙ МІСЯЦЬ кінця періоду (плани місячні);
 * борги, залишки й оборотність — СТАНОМ НА ЗАРАЗ. Кожен блок нижче несе
 * підпис вікна, інакше модель «знаходить» суперечності там, де їх немає.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { parseMonth, type Period } from "@/lib/analytics/period";
import { revenueByRep, profitByBrand } from "@/lib/analytics/facts";
import { momentumByRep } from "@/lib/analytics/trends";
import { portfolioCountsByRep } from "@/lib/analytics/clients";
import {
  receivableRowsByRep,
  agingByRep,
  debtDeltaByRep,
} from "@/lib/analytics/money-facts";
import { attainmentPercent } from "@/lib/motivation/engine";
import { buildAbcReport } from "@/lib/analytics/abc";
import { buildTurnoverReport } from "@/lib/analytics/turnover";
import { buildLowStockReport, DEFAULT_PARAMS } from "@/lib/procurement/low-stock";
import { driverEfficiencyFacts } from "@/lib/drivers/efficiency-facts";
import {
  actionCandidatesByRep,
  ACTION_LABELS,
  type ClientActionCandidate,
} from "@/lib/analytics/company/rep-actions";
import { readReport } from "@/lib/ai/insight-cache";

/** Скільки рядків показувати моделі в товарних таблицях. */
const TOP_BRANDS = 15;
const TOP_PRODUCTS = 20;
const WORST_STALE = 20;

const round = (n: number | null | undefined, digits = 0): number | null => {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const pct = (part: number, whole: number): number | null =>
  whole > 0 ? round((part / whole) * 100, 1) : null;

// ─────────────────────────────── Торгові ───────────────────────────────

/**
 * Факти по торгових.
 *
 * Маржа завжди йде в парі з покриттям: вал порахований лише по документах,
 * де відома собівартість, і без знаменника «32%» читалося б як факт по
 * всьому обороту.
 */
export async function buildRepsSectionFacts(period: Period) {
  const month = parseMonth(period.toDay.slice(0, 7));

  const [revenue, momentum, portfolio, receivables, debtDelta, reps, plans, monthRevenue] =
    await Promise.all([
      revenueByRep(period.from, period.to),
      momentumByRep(period),
      portfolioCountsByRep(period),
      receivableRowsByRep(null),
      debtDeltaByRep(period.from, period.to),
      prisma.user.findMany({
        where: { role: "SALES" },
        select: { id: true, name: true },
      }),
      prisma.salesPlan.findMany({
        where: {
          period: "MONTH",
          metric: "REVENUE",
          periodStart: month.periodStart,
          brandId: null,
        },
        select: { repId: true, targetValue: true },
      }),
      revenueByRep(month.from, month.to),
    ]);

  const aging = agingByRep(receivables);
  const nameById = new Map(reps.map((r) => [r.id, r.name ?? "—"]));
  const planByRep = new Map(plans.filter((p) => p.repId).map((p) => [p.repId as string, p.targetValue]));
  const monthByRep = new Map(monthRevenue.map((r) => [r.repId, r.amount]));

  // Лише ті, хто справді продавав за період.
  //
  // docs > 0, а не amount !== 0: за реального прогону в списку опинився
  // торговий із нулем реалізацій і одним поверненням на 1 690 ₴ — оборот
  // від'ємний, маржа null, і модель отримувала блок, у якому нема чого
  // аналізувати. Повернення без продажів це не робота торгового за період,
  // а хвіст старої угоди.
  const active = revenue.filter((r) => r.docs > 0);
  const candidates = await actionCandidatesByRep(
    active.map((r) => r.repId),
    period
  );

  const описДій = (list: ClientActionCandidate[]) =>
    list.map((c) => ({
      clientId: c.counterpartyId,
      клієнт: c.name,
      тип: c.kind,
      тип_підпис: ACTION_LABELS[c.kind],
      чому: c.why,
      оборот_за_період: c.amountPeriod,
      днів_без_замовлень: c.daysSinceLast,
      звичний_ритм_днів: c.avgIntervalDays,
      борг: c.debt,
      прострочено: c.overdue,
      платник: c.verdict,
      позицій: c.skuCount,
      брендів: c.brandCount,
    }));

  const торгові = active
    .sort((a, b) => b.amount - a.amount)
    .map((r) => {
      const m = momentum.get(r.repId);
      const p = portfolio.get(r.repId);
      const a = aging.get(r.repId);
      const d = debtDelta.get(r.repId);
      const target = planByRep.get(r.repId) ?? 0;
      const fact = monthByRep.get(r.repId) ?? 0;
      const list = candidates.get(r.repId) ?? [];

      const порахованоДій: Record<string, number> = {};
      for (const c of list) {
        порахованоДій[ACTION_LABELS[c.kind]] = (порахованоДій[ACTION_LABELS[c.kind]] ?? 0) + 1;
      }

      return {
        repId: r.repId,
        торговий: nameById.get(r.repId) ?? "—",
        за_період: {
          оборот: round(r.amount),
          документів: r.docs,
          клієнтів: r.clients,
          повернення: round(r.returns),
          вал: round(r.profit),
          рентабельність_відсотків: pct(r.profit, r.costedAmount),
          оборот_з_відомою_собівартістю: round(r.costedAmount),
          покриття_собівартістю_відсотків: pct(r.costedAmount, r.amount),
        },
        темп: m?.comparable
          ? {
              оборот_зміна_відсотків: round(m.amountDeltaPct, 1),
              документи_зміна_відсотків: round(m.docsDeltaPct, 1),
              середній_чек_зміна_відсотків: round(m.avgCheckDeltaPct, 1),
              клієнти_зміна_відсотків: round(m.clientsDeltaPct, 1),
            }
          : "порівнювати нема з чим: попереднє вікно виходить за межі історії",
        портфель: p
          ? {
              усього_клієнтів: p.totalClients,
              активних: p.activeClients,
              нових: p.newClients,
              відстають: p.slippingClients,
              втрачених: p.lostClients,
            }
          : null,
        дебіторка_станом_на_зараз: a
          ? {
              усього: round(a.total),
              прострочено: round(a.overdue),
              частка_простроченого_відсотків: round(a.overdueRatio, 1),
              понад_90_днів: round(a.buckets.OVERDUE_90_PLUS),
              борг_без_відвантажень: round(a.unknown),
            }
          : null,
        зміна_боргу_за_період: d?.hasOpening
          ? { на_початок: round(d.opening), на_кінець: round(d.closing), зміна: round(d.delta) }
          : "знімка на початок періоду немає",
        план_на_місяць: target > 0
          ? {
              місяць: month.month,
              план: round(target),
              факт: round(fact),
              виконання_відсотків: round(attainmentPercent("REVENUE", fact, target), 1),
            }
          : "план на місяць не заданий",
        кандидати_дій: описДій(list),
        кандидатів_за_типами: порахованоДій,
      };
    });

  const totals = active.reduce(
    (acc, r) => ({
      amount: acc.amount + r.amount,
      profit: acc.profit + r.profit,
      costed: acc.costed + r.costedAmount,
      docs: acc.docs + r.docs,
    }),
    { amount: 0, profit: 0, costed: 0, docs: 0 }
  );

  const marginValues = торгові
    .map((r) => r.за_період.рентабельність_відсотків)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  return {
    секція: "Торгові",
    період: { від: period.fromDay, до: period.toDay, днів: period.days },
    як_читати: {
      оборот_і_маржа: `потік за період ${period.fromDay} — ${period.toDay}`,
      план: `календарний місяць ${month.month} (плани в системі місячні)`,
      борги: "сальдо станом на зараз, не на кінець періоду",
      рентабельність:
        "вал = сума документа мінус собівартість його рядків, лише по документах із відомою собівартістю; дивись покриття_собівартістю_відсотків",
      кандидати_дій:
        "готовий список, порахований правилами: борг, відставання від власного ритму клієнта, стан портфеля, ширина асортименту. Твоє завдання — впорядкувати й пояснити, а не додати нових клієнтів",
    },
    підсумок_компанії: {
      оборот: round(totals.amount),
      вал: round(totals.profit),
      рентабельність_відсотків: pct(totals.profit, totals.costed),
      покриття_собівартістю_відсотків: pct(totals.costed, totals.amount),
      документів: totals.docs,
      торгових_із_продажами: active.length,
      медіанна_рентабельність_відсотків:
        marginValues.length > 0
          ? round(marginValues[Math.floor(marginValues.length / 2)], 1)
          : null,
    },
    торгові,
  };
}

// ──────────────────────────────── Товари ────────────────────────────────

/** Факти по товарах: рентабельність, ABC/XYZ, неліквід, дефіцит. */
export async function buildProductsSectionFacts(period: Period) {
  const [brands, abcBrand, abcProduct, turnover, lowStock] = await Promise.all([
    profitByBrand(period.from, period.to),
    buildAbcReport(period.from, period.to, "brand", null, 100),
    buildAbcReport(period.from, period.to, "product", null, TOP_PRODUCTS),
    buildTurnoverReport(null, { worstLimit: WORST_STALE }),
    buildLowStockReport({ ...DEFAULT_PARAMS, brandId: null }),
  ]);

  const brandTotal = brands.reduce((s, b) => s + b.amount, 0);
  const brandRows = brands
    .filter((b) => b.amount > 0)
    .slice(0, TOP_BRANDS)
    .map((b) => ({
      id: b.brandId ?? "БЕЗ_БРЕНДУ",
      бренд: b.brandName ?? "Без бренду",
      оборот: round(b.amount),
      частка_обороту_відсотків: pct(b.amount, brandTotal),
      вал: round(b.profit),
      рентабельність_відсотків: pct(b.profit, b.costedAmount),
      покриття_собівартістю_відсотків: pct(b.costedAmount, b.amount),
      документів: b.docs,
      штук: round(b.qty, 1),
    }));

  const abcClasses = (report: typeof abcBrand) =>
    report.summary.map((s) => ({
      клас: s.abc,
      позицій: s.count,
      оборот: round(s.amount),
      частка_обороту_відсотків: round(s.amountShare, 1),
    }));

  return {
    секція: "Товари",
    період: { від: period.fromDay, до: period.toDay, днів: period.days },
    як_читати: {
      продажі: `оборот, вал і ABC — за період ${period.fromDay} — ${period.toDay}`,
      склад:
        "залишки, оборотність і дефіцит — СТАНОМ НА ЗАРАЗ, за вікном швидкості 90 днів; з періодом вище вони не пов'язані",
      оцінка_запасу:
        "змішана: собівартість там, де відома, інакше ціна продажу — тому загальна вартість запасу завищена на маржу тієї частини",
      рентабельність_бренду:
        "рахується з рядків документів, тому знижка з шапки сюди не потрапляє і маржа бренду трохи оптимістичніша за компанію",
      групування: "по бренду, а не категорії: 84% рядків у 1С сидять в одній звалищній категорії",
    },
    рентабельність_брендів: brandRows,
    abc_по_брендах: {
      пояснення: "A — 80% обороту, B — до 95%, C — решта; XYZ за стабільністю продажів по місяцях",
      покриття_собівартістю_відсотків: round(abcBrand.coverage, 1),
      класи: abcClasses(abcBrand),
      xyz_доступний: abcBrand.xyzAvailable,
      топ: abcBrand.rows.slice(0, TOP_BRANDS).map((r) => ({
        id: r.id,
        назва: r.name,
        оборот: round(r.amount),
        рентабельність_відсотків: round(r.marginPct, 1),
        abc: r.abc,
        xyz: r.xyz,
        місяців_із_продажами: r.activeMonths,
      })),
    },
    топ_товарів: abcProduct.rows.slice(0, TOP_PRODUCTS).map((r) => ({
      id: r.id,
      товар: r.name,
      бренд: r.brandName ?? null,
      оборот: round(r.amount),
      вал: round(r.profit),
      рентабельність_відсотків: round(r.marginPct, 1),
      документів: r.docs,
      abc: r.abc,
      xyz: r.xyz,
    })),
    склад_станом_на_зараз: {
      вікно_швидкості_днів: turnover.velocityDays,
      позицій_із_залишком: turnover.totals.items,
      вартість_запасу: round(turnover.totals.stockValue),
      з_них_за_собівартістю: round(turnover.totals.costKnownValue),
      з_них_за_ціною_продажу: round(turnover.totals.priceOnlyValue),
      без_руху_позицій: turnover.totals.stale,
      без_руху_на_суму: round(turnover.totals.staleValue),
      частка_мертвих_грошей_відсотків: round(turnover.totals.staleShare, 1),
      надлишок_позицій: turnover.totals.overstock,
      надлишок_на_суму: round(turnover.totals.overstockValue),
      оборотів_на_рік: round(turnover.totals.turns, 2),
      за_давністю: turnover.byBucket.map((b) => ({
        група: b.label,
        позицій: b.items,
        сума: round(b.value),
      })),
      найгірші_бренди: turnover.byBrand
        .slice()
        .sort((a, b) => b.staleValue - a.staleValue)
        .slice(0, TOP_BRANDS)
        .map((b) => ({
          id: b.brandId ?? "БЕЗ_БРЕНДУ",
          бренд: b.brandName,
          позицій: b.items,
          без_руху: b.stale,
          запас_на_суму: round(b.stockValue),
          без_руху_на_суму: round(b.staleValue),
          оборотів_на_рік: round(b.turns, 2),
          вистачить_на_днів: round(b.daysOfStock),
        })),
      найгірші_позиції: turnover.worst.slice(0, WORST_STALE).map((i) => ({
        id: i.id,
        товар: i.name,
        бренд: i.brandName,
        залишок: round(i.stock, 1),
        сума: round(i.value),
        днів_без_продажу: i.daysSinceSale,
        група: i.bucket,
        // Скільки живих грошей повернеться при різних глибинах знижки.
        // Рахуємо тут, а не в моделі: їй заборонено арифметику, а керівнику
        // саме ці три цифри й потрібні, щоб вирішити глибину акції.
        повернемо_зі_знижкою: {
          "10%": round((i.value ?? 0) * 0.9),
          "25%": round((i.value ?? 0) * 0.75),
          "40%": round((i.value ?? 0) * 0.6),
        },
      })),
      акційний_потенціал: {
        пояснення:
          "гроші, що лежать без руху, і скільки з них повернеться при розпродажі. Оцінка запасу змішана (собівартість/ціна), тож це орієнтир глибини знижки, а не точний виторг",
        заморожено_всього: round(turnover.totals.staleValue),
        повернемо_зі_знижкою_10: round((turnover.totals.staleValue ?? 0) * 0.9),
        повернемо_зі_знижкою_25: round((turnover.totals.staleValue ?? 0) * 0.75),
        повернемо_зі_знижкою_40: round((turnover.totals.staleValue ?? 0) * 0.6),
        найдовше_лежить: turnover.byBucket
          .filter((b) => b.items > 0)
          .map((b) => ({ група: b.label, позицій: b.items, сума: round(b.value) })),
      },
    },
    дефіцит_станом_на_зараз: lowStock
      ? {
          пояснення:
            "дефіцит рахується за швидкістю продажів, а не за порогом кількості: 33 тис. позицій каталогу мертві й порогом їх не відрізнити",
          позицій_до_замовлення: lowStock.toOrder,
          пекучих_продається_і_скінчилось: lowStock.urgent,
          сума_закупівлі: round(lowStock.orderCost),
          топ_брендів: lowStock.brands
            .slice()
            .sort((a, b) => b.toOrder - a.toOrder)
            .slice(0, TOP_BRANDS)
            .map((b) => ({
              id: b.id,
              бренд: b.name,
              до_замовлення: b.toOrder,
              скінчилось: b.outOfStock,
              сума: round(b.orderCost),
            })),
        }
      : "звіт дефіциту недоступний",
  };
}

// ────────────────────────────── Логістика ──────────────────────────────

/** Факти по водіях і маршрутних листах. */
export async function buildLogisticsSectionFacts(period: Period) {
  const report = await driverEfficiencyFacts(period.from, period.to);

  const totals = report.drivers.reduce(
    (acc, d) => ({
      sheets: acc.sheets + d.sheets,
      km: acc.km + d.totalKm,
      points: acc.points + d.points,
      payroll: acc.payroll + d.payrollTotal,
      turnover: acc.turnover + d.deliveredTurnover,
      collected: acc.collected + d.incasation.collectedVisits,
      // Зарплата тих водіїв, у кого оборот узагалі відомий — знаменник і
      // чисельник мають бути з одного набору листів.
      payrollWithTurnover:
        acc.payrollWithTurnover + (d.deliveredTurnover > 0 ? d.payrollTotal : 0),
      sheetsWithTurnover: acc.sheetsWithTurnover + (d.deliveredTurnover > 0 ? d.sheets : 0),
    }),
    {
      sheets: 0,
      km: 0,
      points: 0,
      payroll: 0,
      turnover: 0,
      collected: 0,
      payrollWithTurnover: 0,
      sheetsWithTurnover: 0,
    }
  );

  return {
    секція: "Логістика",
    період: { від: period.fromDay, до: period.toDay, днів: period.days },
    як_читати: {
      джерело:
        "маршрут планувальника сайту — головне джерело; лист 1С береться лише на дні, коли маршруту сайту немає (у 1С лист — порожня шапка, кілометраж заповнений у 2 листах із 40)",
      ставка: "рахується ЗА КОЖЕН ЛИСТ, не за день: два виїзди — дві ставки",
      точки: "оплачуються унікальні адреси вигрузки в межах листа; дублі адреси безкоштовні",
      інкасація:
        "дві РІЗНІ цифри, не сумувати: collectedVisits — відмітки водія на планшеті; sheetsDebts — база, віднята з обороту в зарплаті. Для маршрутів сайту друга виводиться з першої",
      причин_немає:
        "чому саме розійшлися кілометри або чому одометр підозрілий — у даних немає. Фіксуй розбіжність, не вигадуй пояснення",
      привезений_оборот:
        "заповнений лише в маршрутах сайту. У листах 1С суми немає взагалі, тож у водія, який їздив тільки за ними, оборот нульовий — це порожні дані, а не робота за безцінь. Відношення зарплати до обороту рахуй лише там, де воно є",
    },
    підсумок: {
      водіїв: report.drivers.length,
      листів: totals.sheets,
      листів_без_водія: report.unassignedSheets,
      кілометрів: round(totals.km, 1),
      оплачуваних_точок: totals.points,
      зарплата: round(totals.payroll),
      привезений_оборот: round(totals.turnover),
      // Відношення лише по тих водіях, у кого оборот відомий: інакше
      // 84 листи 1С без сум дали б «зарплата 135% від обороту».
      зарплата_до_обороту_відсотків: pct(totals.payrollWithTurnover, totals.turnover),
      оборот_відомий_для_листів: `${totals.sheetsWithTurnover} із ${totals.sheets}`,
      інкасація_за_відмітками: round(totals.collected),
    },
    медіани_команди: {
      грн_за_точку: report.medians.costPerPoint,
      км_на_точку: report.medians.kmPerPoint,
      зарплата_до_обороту_відсотків: report.medians.payrollToTurnoverPct,
    },
    водії: report.drivers.map((d) => ({
      driverId: d.driverId,
      водій: d.name ?? "—",
      листів: d.sheets,
      кілометрів: d.totalKm,
      план_кілометрів: d.plannedKm,
      факт_проти_плану_відсотків: d.kmVsPlanPct,
      джерело_кілометрів: d.kmSource,
      листів_без_кілометражу: d.sheetsWithoutKm,
      точки: { місто: d.cityPoints, область: d.oblastPoints, оплачуваних_разом: d.points },
      зарплата: d.payrollTotal,
      привезений_оборот: d.deliveredTurnover,
      грн_за_точку: d.costPerPoint,
      км_на_точку: d.kmPerPoint,
      зарплата_до_обороту_відсотків: d.payrollToTurnoverPct,
      інкасація: {
        за_відмітками: d.incasation.collectedVisits,
        борги_з_листів: d.incasation.sheetsDebts,
      },
      аномалії: {
        підозрілих_змін: d.anomalies.suspiciousShifts,
        закрито_автоматично: d.anomalies.autoClosedShifts,
        одометр_до_gps: d.anomalies.avgOdometerToGpsRatio,
        одометр_до_gps_норма: "1,2–1,6",
        порівняння_є_для_змін: `${d.anomalies.ratioCoverage.withRatio} із ${d.anomalies.ratioCoverage.shifts}`,
        листів_понад_план_на_30_відсотків: d.anomalies.kmOverPlan,
      },
    })),
  };
}

// ────────────────────────────── Стратегія ──────────────────────────────

const SECTION_KINDS = {
  reps: "company_reps",
  products: "company_products",
  logistics: "company_logistics",
} as const;

const SECTION_LABELS: Record<keyof typeof SECTION_KINDS, string> = {
  reps: "Торгові",
  products: "Товари",
  logistics: "Логістика",
};

export type StrategyFactsResult =
  | { ok: true; facts: unknown }
  | { ok: false; missing: string[] };

/**
 * Дайджест трьох секцій — вхід для стратегії.
 *
 * Стратегія не перераховує компанію заново: вона будується на вже
 * згенерованих і ВАЛІДОВАНИХ висновках інших секцій. Тому якщо якоїсь
 * секції за цей період немає — це не привід згенерувати гіршу стратегію,
 * а привід спершу зробити секції.
 */
export async function buildStrategySectionFacts(period: Period): Promise<StrategyFactsResult> {
  const entries = await Promise.all(
    (Object.keys(SECTION_KINDS) as Array<keyof typeof SECTION_KINDS>).map(async (key) => ({
      key,
      report: await readReport(SECTION_KINDS[key], null, period.fromDay, period.toDay),
    }))
  );

  const missing = entries.filter((e) => !e.report).map((e) => SECTION_LABELS[e.key]);
  if (missing.length > 0) return { ok: false, missing };

  const byKey = new Map(entries.map((e) => [e.key, e.report!]));

  /**
   * Витягує з payload секції коротку витримку: заголовки з доказами.
   *
   * Кожен рядок підписується тим, ПРО КОГО він. Без цього стратегія на
   * реальному прогоні приписала прострочку одного торгового іншому: у
   * дайджесті лежали самі заголовки, і зв'язок «висновок → людина» губився
   * разом із блоком, у якому висновок стояв.
   */
  const digest = (payload: unknown, limit = 5, whoById?: Map<string, string>) => {
    const seen: Array<{
      про_кого?: string;
      заголовок: string;
      серйозність?: string;
      докази?: unknown;
    }> = [];

    const walk = (node: unknown, depth = 0, who?: string) => {
      if (seen.length >= limit || depth > 6 || !node) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1, who);
        return;
      }
      if (typeof node !== "object") return;
      const obj = node as Record<string, unknown>;

      // Спустилися в блок людини — далі всі заголовки належать їй.
      const personId = (obj.repId ?? obj.driverId) as string | undefined;
      const owner = (personId && whoById?.get(personId)) || who;
      if (typeof obj.title === "string" || typeof obj.заголовок === "string") {
        seen.push({
          ...(owner ? { про_кого: owner } : {}),
          заголовок: (obj.title ?? obj.заголовок) as string,
          серйозність: (obj.severity ?? obj.серйозність) as string | undefined,
          докази: obj.evidence ?? obj.докази,
        });
      }
      for (const value of Object.values(obj)) walk(value, depth + 1, owner);
    };
    walk(payload);
    return seen;
  };

  const repsFacts = byKey.get("reps")!.facts as Awaited<ReturnType<typeof buildRepsSectionFacts>>;
  const productsFacts = byKey.get("products")!
    .facts as Awaited<ReturnType<typeof buildProductsSectionFacts>>;
  const logisticsFacts = byKey.get("logistics")!
    .facts as Awaited<ReturnType<typeof buildLogisticsSectionFacts>>;

  const repNames = new Map(repsFacts.торгові.map((r) => [r.repId, r.торговий]));
  const driverNames = new Map(logisticsFacts.водії.map((d) => [d.driverId, d.водій]));

  return {
    ok: true,
    facts: {
      секція: "Стратегія",
      період: { від: period.fromDay, до: period.toDay, днів: period.days },
      як_читати: {
        джерело:
          "це витримка з уже згенерованих і перевірених секцій «Торгові», «Товари» і «Логістика» за цей самий період",
        завдання:
          "звести їх у 3–6 пріоритетів для власника і сказати, що робити з кожною людиною; нових цифр не вводити",
      },
      компанія: {
        ...repsFacts.підсумок_компанії,
        склад_без_руху_на_суму: productsFacts.склад_станом_на_зараз.без_руху_на_суму,
        склад_частка_мертвих_грошей_відсотків:
          productsFacts.склад_станом_на_зараз.частка_мертвих_грошей_відсотків,
        логістика_зарплата: logisticsFacts.підсумок.зарплата,
        логістика_зарплата_до_обороту_відсотків:
          logisticsFacts.підсумок.зарплата_до_обороту_відсотків,
      },
      люди: {
        торгові: repsFacts.торгові.map((r) => ({
          personId: r.repId,
          роль: "rep" as const,
          імя: r.торговий,
          оборот: r.за_період.оборот,
          рентабельність_відсотків: r.за_період.рентабельність_відсотків,
          прострочено: r.дебіторка_станом_на_зараз?.прострочено ?? null,
          кандидатів_дій: r.кандидати_дій.length,
          кандидатів_за_типами: r.кандидатів_за_типами,
        })),
        водії: logisticsFacts.водії.map((d) => ({
          personId: d.driverId,
          роль: "driver" as const,
          імя: d.водій,
          листів: d.листів,
          грн_за_точку: d.грн_за_точку,
          зарплата_до_обороту_відсотків: d.зарплата_до_обороту_відсотків,
          підозрілих_змін: d.аномалії.підозрілих_змін,
        })),
      },
      висновки_секцій: {
        пояснення:
          "«про_кого» — людина, у чиєму блоці стояв висновок. Приписати її цифри комусь іншому не можна",
        // Ліміт більший за кількість людей: по 2–3 висновки на дев'ятьох
        // торгових не влізали в п'ять рядків, і хвіст команди зникав із
        // стратегії саме тому, що дайджест обривався на перших блоках.
        торгові: digest(byKey.get("reps")!.insights, 30, repNames),
        товари: digest(byKey.get("products")!.insights, 8),
        логістика: digest(byKey.get("logistics")!.insights, 12, driverNames),
      },
    },
  };
}

/** Київська дата — для підпису «станом на». */
export const asOfToday = () => kyivDate(new Date());
