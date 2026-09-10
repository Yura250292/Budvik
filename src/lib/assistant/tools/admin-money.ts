/**
 * Друга половина інструментів керівника: гроші, глибша аналітика, сайт.
 *
 * Винесено окремим файлом від admin.ts не за темою, а за розміром: разом
 * вони давали б півтори тисячі рядків, у яких важко знайти потрібний.
 * Правила ті самі — лише читання, імена через довідник, результат до
 * девʼяти тисяч символів.
 *
 * Кожен інструмент має параметр mode: це свідомий спосіб не роздувати
 * список. Схема кожного інструмента їде в КОЖНОМУ запиті ходу, тож три
 * інструменти з режимами коштують утричі дешевше за девʼять окремих, а
 * модель обирає з коротшого списку й помиляється рідше.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { enumOf } from "@/lib/assistant/validate";
import { uah, pct, ymd } from "@/lib/assistant/format";
import { periodFacts, periodFromArgs } from "@/lib/assistant/period";
import { getAccountingReport } from "@/lib/erp/accounting";
import { listPurchaseOrders } from "@/lib/erp/purchase-orders";
import { buildDiscountReport } from "@/lib/analytics/discounts";
import { buildGeoRevenueReport } from "@/lib/analytics/geo-revenue";
import { buildCohortReport } from "@/lib/analytics/cohorts";
import { siteTrafficFacts } from "@/lib/webstats/traffic";
import { siteOrdersTool } from "@/lib/assistant/tools/admin";

const PERIOD_PARAMS = {
  days: { type: "integer", description: "Скільки останніх днів. Без цього й без дат — календарний місяць із 1 числа." },
  period_from: { type: "string", description: "Початок періоду, YYYY-MM-DD. Разом із period_to." },
  period_to: { type: "string", description: "Кінець періоду, YYYY-MM-DD." },
} as const;

/* ── Гроші фірми ──────────────────────────────────────────────────────── */

export const moneyFlowsTool: ToolDef = {
  name: "money_flows",
  label: "Дивлюся гроші фірми",
  kinds: ["ADMIN"],
  description:
    "Гроші фірми за період. mode=flows: скільки відвантажили, скільки повернули, скільки зібрали грішми, скільки завезли товару, розрив між відвантаженим і зібраним, помісячна динаміка, аванси покупців. mode=purchases: закупівлі — скільки документів і на яку суму, по яких постачальниках, останні надходження. Викликай на «рух коштів», «скільки завезли», «аванси», «закупівлі», «постачальники», «чи більше збираємо ніж відвантажуємо».",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["flows", "purchases"],
        description: "flows — рух коштів (за замовчуванням), purchases — закупівлі й постачальники.",
      },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
    const period = periodFromArgs(ctx.today, args);
    const mode = args.mode == null ? "flows" : enumOf(args.mode, "mode", ["flows", "purchases"] as const);

    if (mode === "purchases") {
      const list = await listPurchaseOrders({
        from: period.fromDay,
        to: period.toDay,
        take: 15,
      });

      // Постачальники в підсумку лише пораховані — розкладку збираємо самі.
      const bySupplier = new Map<string, { назва: string; документів: number; сума: number }>();
      for (const po of list.items) {
        const key = po.supplier?.name ?? "без постачальника";
        const acc = bySupplier.get(key) ?? { назва: key, документів: 0, сума: 0 };
        acc.документів += 1;
        acc.сума += po.totalAmount;
        bySupplier.set(key, acc);
      }

      return {
        період: periodFacts(period),
        разом: {
          документів: list.summary.count,
          сума: uah(list.summary.total),
          постачальників: list.summary.suppliers,
        },
        по_постачальниках: [...bySupplier.values()]
          .sort((a, b) => b.сума - a.сума)
          .slice(0, 12)
          .map((s) => ({ ...s, сума: uah(s.сума) })),
        останні: list.items.slice(0, 10).map((po) => ({
          номер: po.number,
          коли: ymd(po.createdAt),
          постачальник: po.supplier?.name ?? null,
          склад: po.stockLocation?.name ?? null,
          позицій: po._count.items,
          сума: uah(po.totalAmount),
          джерело: po.externalId ? "1С" : "сайт",
        })),
        показано_не_всі: list.truncated,
      };
    }

    const report = await getAccountingReport(period);

    return {
      період: periodFacts(period),
      відвантажено: {
        сума: uah(report.shipped.total),
        документів: report.shipped.count,
        клієнтів: report.shipped.clients,
      },
      повернено: { сума: uah(report.returned.total), документів: report.returned.count },
      відвантажено_нетто: uah(report.shippedNet),
      зібрано: {
        сума: uah(report.collected.total),
        платежів: report.collected.count,
        клієнтів: report.collected.clients,
      },
      завезено: {
        сума: uah(report.purchased.total),
        документів: report.purchased.count,
        постачальників: report.purchased.suppliers,
      },
      /**
       * Розрив між відвантаженим і зібраним — це і є приріст боргу за
       * період. Додатне означає, що фірма кредитує клієнтів більше, ніж
       * вони повертають грошей.
       */
      розрив_відвантажено_мінус_зібрано: uah(report.gap),
      дебіторка_зараз: {
        борг: uah(report.receivables.total),
        прострочено: uah(report.receivables.overdue),
        прострочено_відсотків: pct(report.receivables.overdueRatio),
      },
      аванси_покупців: {
        сума: uah(report.advances.total),
        клієнтів: report.advances.count,
        найбільші: report.advances.clients.slice(0, 8).map((c) => ({
          клієнт_id: c.id,
          клієнт: c.name,
          сума: uah(c.amount),
        })),
      },
      помісячно: report.months.slice(-6).map((m) => ({
        місяць: m.month,
        відвантажено: uah(m.shipped),
        зібрано: uah(m.collected),
      })),
      чого_немає: report.gaps,
    };
  },
};

/* ── Глибша аналітика продажів ────────────────────────────────────────── */

export const salesAnalysisTool: ToolDef = {
  name: "sales_analysis",
  label: "Розбираю продажі глибше",
  kinds: ["ADMIN"],
  description:
    "Три розрізи продажів, яких немає в team_overview. mode=discounts: скільки віддали знижками — явними й прихованими (продаж нижче медіанної ціни), по торгових, клієнтах і товарах. mode=geo: оборот по містах, скільки клієнтів у кожному й скільки з них купують. mode=cohorts: коли клієнти прийшли й скільки лишилось, хто відвалився та скільки обороту з ними пішло. Викликай на «знижки», «хто дає найбільше знижок», «де ми продаємо», «по містах», «хто відвалився», «утримання клієнтів».",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["discounts", "geo", "cohorts"],
        description: "Який саме розріз потрібен.",
      },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
    const mode = enumOf(args.mode, "mode", ["discounts", "geo", "cohorts"] as const);
    const period = periodFromArgs(ctx.today, args);

    if (mode === "cohorts") {
      // Когорти рахуються за всю історію: період тут не звужує, а лише збиває з пантелику.
      const report = await buildCohortReport(20);
      return {
        когорти: report.cohorts.slice(-8).map((c) => ({
          місяць: c.month,
          стартова_база: c.isBaseline,
          клієнтів: c.size,
          оборот_за_весь_час: uah(c.totalRevenue),
          лишилось_через_3_місяці_відсотків: pct(c.activity[3] ?? null),
          лишилось_через_6_місяців_відсотків: pct(c.activity[6] ?? null),
        })),
        втрачені: {
          клієнтів: report.churn.lost.clients,
          щомісячного_обороту_пішло: uah(report.churn.lost.monthlyRevenue),
          разових_серед_них: report.churn.lost.oneOffClients,
        },
        сплять: {
          клієнтів: report.churn.dormant.clients,
          щомісячного_обороту_під_загрозою: uah(report.churn.dormant.monthlyRevenue),
        },
        кого_повертати: report.churn.top.slice(0, 12).map((c) => ({
          клієнт_id: c.counterpartyId,
          клієнт: c.name,
          торговий: c.repName,
          стан: c.state === "LOST" ? "втрачений" : "спить",
          останній_документ: c.lastDocAt,
          днів_тому: c.daysSinceLast,
          був_оборот_на_місяць: uah(c.avgMonthly),
        })),
        примітка:
          "Когорти рахуються за всю історію, а не за обраний період: клієнт «прийшов» лише раз.",
      };
    }

    if (mode === "geo") {
      const report = await buildGeoRevenueReport(period.from, period.to);
      return {
        період: periodFacts(period),
        оборот_усього: uah(report.totalAmount),
        міста: report.cities.slice(0, 20).map((c) => ({
          місто: c.city,
          оборот: uah(c.amount),
          купували: c.buyers,
          клієнтів_усього: c.clients,
          на_покупця: uah(c.perBuyer),
          борг: uah(c.debt),
          з_координатами: c.withGeo,
          торгові: c.repNames.slice(0, 3),
        })),
        місто_невідоме: {
          клієнтів: report.unknown.clients,
          купували: report.unknown.buyers,
          оборот: uah(report.unknown.amount),
        },
        примітка:
          "Місто визначається з адреси або назви контрагента; де його немає — рядок «місто невідоме».",
      };
    }

    const report = await buildDiscountReport(period.from, period.to);
    return {
      період: periodFacts(period),
      разом: {
        оборот: uah(report.totals.revenue),
        явна_знижка: uah(report.totals.explicit),
        прихована_знижка: uah(report.totals.hidden),
        разом_віддали_відсотків: pct(report.totals.totalPct),
        вал: uah(report.totals.gross),
      },
      по_торгових: report.byRep.slice(0, 12).map((r) => ({
        торговий_id: r.repId,
        торговий: r.repName,
        оборот: uah(r.revenue),
        знижок_разом: uah(r.total),
        від_свого_обороту_відсотків: pct(r.pctOfRevenue),
        рентабельність_відсотків: pct(r.grossPct),
      })),
      найбільші_знижки_клієнтам: report.byClient.slice(0, 10).map((c) => ({
        клієнт_id: c.counterpartyId,
        клієнт: c.name,
        торговий: c.repName,
        оборот: uah(c.revenue),
        знижок: uah(c.total),
        відсотків: pct(c.pctOfRevenue),
      })),
      товари_нижче_медіани: report.byProduct.slice(0, 10).map((p) => ({
        товар_id: p.productId,
        назва: p.name,
        медіанна_ціна: uah(p.medianPrice),
        середня_фактична: uah(p.avgSoldPrice),
        рядків: p.lines,
      })),
      примітка:
        "«Прихована знижка» — продаж нижче медіанної ціни цього товару, а не оформлена знижка в документі.",
    };
  },
};

/* ── Сайт ─────────────────────────────────────────────────────────────── */

const siteTrafficTool: ToolDef = {
  name: "site_traffic",
  label: "Дивлюся відвідуваність сайту",
  kinds: ["ADMIN"],
  description:
    "Що відбувається на сайті за період: скільки відвідувачів і сесій, перегляди сторінок і товарів, пошукові запити покупців, кліки по телефону, додавання в кошик і замовлення, звідки приходять, які товари дивляться найбільше. Викликай на «скільки людей на сайті», «що шукають», «звідки приходять», «які товари дивляться», «конверсія сайту».",
  parameters: {
    type: "object",
    properties: { ...PERIOD_PARAMS },
  },
  async run(ctx, args) {
    const period = periodFromArgs(ctx.today, args);
    const facts = await siteTrafficFacts(period.from, period.to);
    return { період: periodFacts(period), ...facts };
  },
};

/**
 * Сайт — одна схема замість двох.
 *
 * Замовлення й відвідуваність — різні звіти, але для моделі це дві схеми
 * в КОЖНОМУ запиті ходу; режимом вони коштують одну. Тіла лишаються
 * окремими інструментами (site_orders в admin.ts і site_traffic тут) —
 * їх кличуть і кодові відповіді.
 */
export const siteReportTool: ToolDef = {
  name: "site_report",
  label: "Дивлюся сайт",
  kinds: ["ADMIN"],
  description:
    "Сайт (інтернет-магазин). mode=orders — замовлення з сайту: скільки й на яку суму по статусах за період, які найдовше чекають обробки, чернетки торгових; викликай на «замовлення з сайту», «нові замовлення», «необроблені». mode=traffic — відвідувачі й сесії, що дивляться і що шукають, звідки приходять, кліки по телефону, кошик і конверсія; викликай на «скільки людей на сайті», «що шукають», «звідки приходять».",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["orders", "traffic"],
        description: "orders — замовлення з сайту (за замовчуванням), traffic — відвідуваність.",
      },
      include_drafts: { type: "boolean", description: "Лише для orders: додати чернетки торгових. За замовчуванням так." },
      ...PERIOD_PARAMS,
    },
  },
  async run(ctx, args) {
    const mode = args.mode == null ? "orders" : enumOf(args.mode, "mode", ["orders", "traffic"] as const);
    return mode === "orders" ? siteOrdersTool.run(ctx, args) : siteTrafficTool.run(ctx, args);
  },
};

/* Реєстрація — у tools/index.ts: порядок там і є порядком у схемі для моделі. */
