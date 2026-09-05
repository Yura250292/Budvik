/**
 * Відповіді, які складає код.
 *
 * Тут немає моделі взагалі. Кожна функція бере ті самі факти, що пішли б
 * у модель, і одразу пише готовий текст: список боржників, план дня,
 * пропозицію входу. Виглядає це так само, як відповідь помічника, — бо
 * це вона і є, просто без посередника.
 *
 * Чому не залишити все моделі, раз вона вміє красивіше: типовий хід через
 * неї — 20-30 тисяч вхідних токенів і 12-30 секунд очікування, і майже
 * весь цей час вона витрачає на переказ уже готового списку. Ті самі
 * питання торговий ставить щодня по кілька разів.
 *
 * Правило розподілу просте: перелічити — код, зважити й пояснити —
 * модель. «Хто винен» і «сплануй день» — перелічити. «Чи давати цьому
 * відстрочку», «чому в мене впав оборот» — зважити.
 */

import { ACTION_LABELS, repActionCandidates } from "@/lib/analytics/company/rep-actions";
import { agingByCounterparty, receivableRowsByRep, sumAging, toDebtorList } from "@/lib/analytics/money-facts";
import { clientProductRhythm, recommendations } from "@/lib/analytics/clientOrder";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";
import { ANALYTICS_SINCE_DAY } from "@/lib/analytics/since";
import { dayRouteCandidates } from "@/lib/assistant/facts/day-candidates";
import { clientProfileFacts } from "@/lib/assistant/facts/client-profile";
import { findClients, type ClientHit } from "@/lib/assistant/facts/client-search";
import { deadStockItems, searchProducts, searchProductsTotals } from "@/lib/assistant/facts/product-facts";
import { entryOffer, isConsumable, priceFloor } from "@/lib/assistant/facts/entry-offer";
import { marginPct, priceMarginPct, productStats } from "@/lib/assistant/facts/product-stats";
import { payerVerdicts, verdictLabel } from "@/lib/assistant/facts/discipline-cache";
import {
  routeHabits,
  WEEKDAY_ACCUSATIVE,
  WEEKDAY_GENITIVE,
  WEEKDAY_NAMES,
} from "@/lib/assistant/facts/route-habits";
import { repSalesSummary } from "@/lib/assistant/facts/sales-summary";
import { returnsFacts, repeatedReturns } from "@/lib/assistant/facts/returns";
import { driverDayFacts } from "@/lib/assistant/facts/driver-day";
import { teamBenchmark, STRONG_PERCENTILE, WEAK_PERCENTILE } from "@/lib/analytics/benchmark";
import { METRICS, type MetricKey } from "@/lib/analytics/benchmarkMetrics";
import { buildAbcReport } from "@/lib/analytics/abc";
import { OVERDUE_HOOK_MIN } from "@/lib/assistant/config";
import {
  clientLink,
  clients as clientsWord,
  days,
  items,
  money,
  planDayLabel,
  percent,
  plural,
  points,
  productLink,
  times,
} from "@/lib/assistant/text";
import type { ToolContext } from "@/lib/assistant/types";

/** Скільки клієнтів у плані дня. Більше в голові за один виїзд не тримають. */
const PLAN_LIMIT = 10;
/** Для скількох перших клієнтів плану добираємо гачок. */
const PLAN_HOOKS = 6;

export type DirectAnswer = {
  markdown: string;
  /** Що саме подивилися — той самий слід, що й у ходу через модель. */
  tools: Array<{ name: string; label: string; ms: number }>;
};

type Timed = { label: string; name: string };

async function timed<T>(meta: Timed, job: () => Promise<T>, into: DirectAnswer["tools"]): Promise<T> {
  const started = Date.now();
  const value = await job();
  into.push({ ...meta, ms: Date.now() - started });
  return value;
}

/** Період у тому вигляді, який очікує аналітика. */
function periodOf(today: string, dayCount: number) {
  let fromDay = shiftDay(today, -(dayCount - 1));
  if (fromDay < ANALYTICS_SINCE_DAY) fromDay = ANALYTICS_SINCE_DAY;
  return {
    fromDay,
    toDay: today,
    from: kyivDayStart(fromDay),
    to: kyivDayEnd(today),
    days: dayCount,
    clamped: false,
  };
}

/* ── План дня ─────────────────────────────────────────────────────────── */

/**
 * План дня: кандидати з підставами плюс гачок для кожного з перших шести.
 *
 * Гачок беремо з ВЛАСНОГО ритму клієнта (один запит на клієнта), а не з
 * повного entry_offer: той рахує ще й причіп із аналізом кошика, і шість
 * таких на один план — це зайві секунди в дорозі.
 */
export async function answerDayPlan(ctx: ToolContext, day: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const plan = await timed(
    { name: "day_route_candidates", label: "Збираю кандидатів на день" },
    () => dayRouteCandidates(ctx.scope.repId, day, PLAN_LIMIT),
    tools
  );

  if (plan.кандидати.length === 0) {
    return {
      markdown: `## План на ${planDayLabel(day, WEEKDAY_ACCUSATIVE[weekdayIndex(plan.день_тижня)])}\n\nНа цей день немає ні звичних клієнтів, ні термінових справ. Схоже, історії ще замало — спитайте про борги або про клієнтів, які давно не брали.`,
      tools,
    };
  }

  const hooks = await timed(
    { name: "entry_hooks", label: "Підбираю, з чим заходити" },
    () => hooksFor(plan.кандидати.slice(0, PLAN_HOOKS).map((c) => c.клієнт_id)),
    tools
  );

  const lines = plan.кандидати.map((c, i) => {
    const parts: string[] = [];
    if (c.прострочено > 0) parts.push(`прострочено ${money(c.прострочено)}`);
    else if (c.борг > 0) parts.push(`борг ${money(c.борг)} (робочий)`);
    if (c.дія) parts.push(c.дія.toLowerCase());
    if (c.звичний_для_дня) parts.push(`звичний для ${WEEKDAY_GENITIVE[weekdayIndex(plan.день_тижня)]}`);
    if (c.днів_з_останньої != null) parts.push(`не брав ${days(c.днів_з_останньої)}`);

    const hook = hooks.get(c.клієнт_id);
    const withWhat = hook
      ? ` Заходити з: ${productLink(hook.name, hook.sku)} — ${money(hook.price)}${
          hook.floor ? `, не нижче ${money(hook.floor)}` : ""
        } (${hook.why}).`
      : "";

    return `${i + 1}. ${clientLink(c.клієнт_id, c.назва)} — ${parts.join("; ")}.${withWhat}`;
  });

  const head = plan.маршрут_за_розкладом
    ? `Маршрут за розкладом: **${plan.маршрут_за_розкладом.назва}** (${plan.маршрут_за_розкладом.пункти.slice(0, 6).join(", ")}).`
    : "Постійного маршруту на цей день не заведено — список зібрано зі звички й термінових справ.";

  return {
    markdown: [
      `## План на ${planDayLabel(day, WEEKDAY_ACCUSATIVE[weekdayIndex(plan.день_тижня)])}`,
      head,
      "",
      ...lines,
      "",
      `**Разом:** ${points(plan.разом.точок)}, забрати ≈ ${money(plan.разом.прострочено)} простроченої з ${money(plan.разом.борг)} боргу.`,
      "",
      "_Ціни — прайсові; нижче прайсу це пропозиція, знижку затверджує керівник._",
    ].join("\n"),
    tools,
  };
}

function weekdayIndex(name: string): number {
  const idx = WEEKDAY_NAMES.indexOf(name);
  return idx >= 0 ? idx : 0;
}

type Hook = { name: string; sku: string | null; price: number; floor: number | null; why: string };

/**
 * Найдоречніший розхідник для кожного клієнта: той, який він бере сам і
 * який саме зараз мав би закінчитись.
 */
async function hooksFor(counterpartyIds: string[]): Promise<Map<string, Hook>> {
  const stats = await productStats();
  const byId = new Map(stats.map((s) => [s.productId, s]));
  const out = new Map<string, Hook>();

  // Послідовно, а не залпом: шість запитів по 200 мс дешевші за шість
  // одночасних з'єднань, які конкурують із рештою кабінету за пул.
  for (const id of counterpartyIds) {
    const rhythm = await clientProductRhythm(id);
    let best: { row: (typeof rhythm)[number]; overdue: number } | null = null;

    for (const row of rhythm) {
      if (!row.cycleDays || row.freeStock <= 0 || row.price <= 0) continue;
      const stat = byId.get(row.productId);
      if (!stat || !isConsumable(stat)) continue;
      const overdue = row.daysSince / row.cycleDays;
      if (overdue < OVERDUE_HOOK_MIN) continue;
      if (!best || overdue * Math.log1p(row.amount) > best.overdue * Math.log1p(best.row.amount)) {
        best = { row, overdue };
      }
    }

    if (!best) continue;
    const stat = byId.get(best.row.productId);
    out.set(id, {
      name: best.row.name,
      sku: best.row.sku,
      price: best.row.price,
      floor: priceFloor(stat?.lastCost ?? null),
      why: `брав ${times(best.row.times)}, ~раз на ${days(best.row.cycleDays!)}, останній раз ${days(best.row.daysSince)} тому`,
    });
  }

  return out;
}

/* ── Дебіторка ────────────────────────────────────────────────────────── */

export async function answerDebts(ctx: ToolContext): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const [rows, discipline] = await Promise.all([
    timed({ name: "receivables", label: "Дивлюся борги" }, () => receivableRowsByRep(ctx.scope.repId), tools),
    payerVerdicts(),
  ]);

  const total = sumAging(rows);
  const debtors = toDebtorList(rows).filter((d) => d.debt > 0.01);

  if (debtors.length === 0) {
    return { markdown: "Боргів за вашими клієнтами немає — усе закрито.", tools };
  }

  const worst = debtors.slice(0, 10).map((d) => {
    const verdict = verdictLabel(discipline.verdicts.get(d.counterpartyId));
    const age = d.oldestDays != null ? `, найстарішому ${days(d.oldestDays)}` : "";
    return `- ${clientLink(d.counterpartyId, d.name)} — ${
      d.overdue > 0 ? `прострочено **${money(d.overdue)}**` : `борг ${money(d.debt)} робочий`
    } із ${money(d.debt)}${age}${verdict ? `, платник ${verdict}` : ""}`;
  });

  const overdueCount = debtors.filter((d) => d.overdue > 0).length;

  return {
    markdown: [
      `**Дебіторка: ${money(total.total)}**, з них прострочено **${money(total.overdue)}** (${percent(total.overdueRatio)}).`,
      `Боржників ${debtors.length}, із простроченою — ${overdueCount}.`,
      "",
      "Кому нагадати передусім:",
      ...worst,
      "",
      "_Вік боргу відновлено з дат наших відвантажень: 1С передає лише загальне сальдо._",
    ].join("\n"),
    tools,
  };
}

/* ── Хто згасає ───────────────────────────────────────────────────────── */

export async function answerChurn(ctx: ToolContext): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, 30);

  const all = await timed(
    { name: "action_candidates", label: "Дивлюся, хто згасає" },
    () => repActionCandidates(ctx.scope.repId, period),
    tools
  );

  const list = all.filter((a) => a.kind === "CHURN_RISK" || a.kind === "REACTIVATE").slice(0, 10);
  if (list.length === 0) {
    return {
      markdown: "Ніхто з ваших клієнтів не випадає з власного ритму — усі беруть як зазвичай.",
      tools,
    };
  }

  return {
    markdown: [
      `**${clientsWord(list.length)}, з якими варто звʼязатися:**`,
      "",
      ...list.map(
        (a) =>
          `- ${clientLink(a.counterpartyId, a.name)} — ${ACTION_LABELS[a.kind].toLowerCase()}: ${a.why}`
      ),
      "",
      "_Ритм рахується по днях із покупками за всю історію клієнта, а не по документах._",
    ].join("\n"),
    tools,
  };
}

/* ── Мертвий залишок ──────────────────────────────────────────────────── */

export async function answerDeadStock(ctx: ToolContext, brand: string | null): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const list = await timed(
    { name: "dead_stock", label: "Шукаю мертві залишки" },
    () =>
      deadStockItems({
        repId: ctx.scope.repId,
        brand,
        minDays: 90,
        limit: 12,
        boughtByMyClients: false,
      }),
    tools
  );

  if (list.length === 0) {
    return {
      markdown: brand
        ? `По бренду «${brand}» мертвих залишків немає.`
        : "Мертвих залишків із вільним залишком і ціною зараз немає.",
      tools,
    };
  }

  const sum = list.reduce((s, i) => s + i.free * (i.lastCost ?? i.price), 0);
  const known = list.filter((i) => i.myBuyers > 0);

  return {
    markdown: [
      `**${items(list.length)} лежить без продажу 90+ днів** на ${money(sum)} за собівартістю${brand ? ` (бренд «${brand}»)` : ""}.`,
      "",
      ...list.map((i) => {
        const idle = i.lastSale
          ? `${days((Date.now() - i.lastSale.getTime()) / 86_400_000)} без продажу`
          : "жодного продажу";
        const margin = priceMarginPct(i.price, i.lastCost);
        return `- ${productLink(i.name, i.sku)} — ${i.free} шт, ${idle}, ${money(i.price)}${
          margin != null ? `, маржа ${percent(margin)}` : ""
        }${i.myBuyers > 0 ? `, з ваших брали ${i.myBuyers}` : ""}`;
      }),
      "",
      known.length > 0
        ? `_Найлегше зрушити перші ${known.length}: ці позиції вже брали ваші клієнти._`
        : "_Це залишок, якого ваші клієнти ще не брали — починати варто з тих, кому цей бренд знайомий._",
    ].join("\n"),
    tools,
  };
}

/* ── Продажі за період ────────────────────────────────────────────────── */

export async function answerSales(ctx: ToolContext, dayCount: number): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, dayCount);

  const s = await timed(
    { name: "sales_summary", label: "Рахую продажі за період" },
    () => repSalesSummary(ctx.scope.repId, period, { byBrand: true }),
    tools
  );

  const change = s.попередній_період?.зміна_суми_відсотків;
  const trend =
    change == null
      ? ""
      : ` Це на ${percent(Math.abs(change))} ${change >= 0 ? "більше" : "менше"}, ніж за попередні ${days(dayCount)} (${money(s.попередній_період!.сума)}).`;

  const plan = s.план_місяця;
  const planLine =
    plan.план > 0
      ? `**План на ${plan.місяць}:** ${money(plan.факт)} із ${money(plan.план)} — ${percent(plan.виконання_відсотків ?? 0)}.${
          plan.лишилось_добрати ? ` Лишилось добрати ${money(plan.лишилось_добрати)}${plan.треба_на_день ? `, тобто ${money(plan.треба_на_день)} на день` : ""}.` : ""
        }`
      : "_План на цей місяць не заведено._";

  const brands = s.бренди.slice(0, 5).map((b) => `- ${b.бренд} — ${money(b.сума)}`);

  return {
    markdown: [
      `**За ${days(dayCount)}: ${money(s.підсумок.сума)}**, ${s.підсумок.реалізацій} реалізацій, ${clientsWord(s.підсумок.клієнтів)}, середній чек ${money(s.підсумок.середній_чек)}.${trend}`,
      s.підсумок.повернення > 0 ? `Повернень на ${money(s.підсумок.повернення)}.` : "",
      `Зібрано грошей: ${money(s.підсумок.зібрано_грошей)}.`,
      "",
      planLine,
      brands.length ? "\n**Топ брендів:**" : "",
      ...brands,
      "",
      "_Рахуються реалізації (відвантажене), суми нетто — повернення відняті._",
    ]
      .filter(Boolean)
      .join("\n"),
    tools,
  };
}

/* ── Звичні маршрути ──────────────────────────────────────────────────── */

export async function answerRoute(ctx: ToolContext, weekday: number | null): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const habits = await timed(
    { name: "route_habits", label: "Дивлюся звичні маршрути" },
    () => routeHabits(ctx.scope.repId, 8),
    tools
  );

  const wanted = weekday ? habits.byWeekday.filter((d) => d.weekday === weekday) : habits.byWeekday;
  const filled = wanted.filter((d) => d.clients.length > 0 || d.template);

  if (filled.length === 0) {
    return {
      markdown: weekday
        ? `За останні ${habits.weeks} тижнів у ${WEEKDAY_GENITIVE[weekday - 1]} нічого сталого не видно — ні замовлень, ні відміток, ні зупинок.`
        : `За останні ${habits.weeks} тижнів сталого маршруту не видно.`,
      tools,
    };
  }

  const blocks = filled.map((d) => {
    const head = `**${WEEKDAY_NAMES[d.weekday - 1].toUpperCase()}**${d.template ? ` — шаблон «${d.template.name}»` : ""}`;
    const rows = d.clients.slice(0, weekday ? 10 : 5).map((c) => {
      const bits: string[] = [];
      if (c.orders) bits.push(`${c.orders} зам.`);
      if (c.visits) bits.push(`${c.visits} візит.`);
      if (c.stops) bits.push(`${c.stops} зупин.`);
      return `- ${clientLink(c.counterpartyId, c.name)} — ${bits.join(", ")}`;
    });
    return [head, ...rows].join("\n");
  });

  return {
    markdown: [
      `Куди ви звично їздите (за ${habits.weeks} тижнів):`,
      "",
      ...blocks,
      "",
      "_Замовлення важать більше за зупинки: зупинка каже лише, що ви стояли поруч._",
    ].join("\n"),
    tools,
  };
}

/* ── Клієнт: пошук і три відповіді по ньому ───────────────────────────── */

type Resolved = { hit: ClientHit } | { ambiguous: ClientHit[] } | { none: true };

async function resolveClient(
  ctx: ToolContext,
  subject: string,
  tools: DirectAnswer["tools"]
): Promise<Resolved> {
  const hits = await timed(
    { name: "search_clients", label: "Шукаю клієнта" },
    () => findClients(subject, ctx.scope.repId, { limit: 6 }),
    tools
  );

  if (hits.length === 0) return { none: true };
  if (hits.length === 1) return { hit: hits[0] };

  // Свій клієнт із документами перемагає однофамільця з чужого портфеля:
  // питання майже завжди про того, з ким торговий працює.
  const mine = hits.filter((h) => h.mine && h.lastDocAt);
  if (mine.length === 1) return { hit: mine[0] };

  // Дубль картки 1С: та сама точка заведена двічі («Налисник Юрій» і «ФОП
  // Налиснік Юрій Вячеславович», одна адреса й телефон), а покупки йдуть
  // лише на одній. Питати, котра з них, — питати про різницю, якої для
  // торгового не існує.
  const withDocs = hits.filter((h) => h.lastDocAt);
  if (withDocs.length === 1) return { hit: withDocs[0] };

  return { ambiguous: hits };
}

function askWhich(subject: string, hits: ClientHit[]): string {
  return [
    `За запитом «${subject}» знайшлося кілька клієнтів. Про кого йдеться?`,
    "",
    ...hits.map(
      (h) =>
        `- ${clientLink(h.id, h.name)}${h.address ? ` — ${h.address}` : ""}${h.mine ? " (ваш)" : ""}`
    ),
  ].join("\n");
}

const notFound = (subject: string) =>
  `Клієнта «${subject}» у базі не знайшли. Спробуйте коротший фрагмент назви, код ЄДРПОУ або прізвище контактної особи.`;

/** «З чим заходити до …» */
export async function answerEntryOffer(ctx: ToolContext, subject: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const found = await resolveClient(ctx, subject, tools);
  if ("none" in found) return { markdown: notFound(subject), tools };
  if ("ambiguous" in found) return { markdown: askWhich(subject, found.ambiguous), tools };

  const client = found.hit;
  const offer = await timed(
    { name: "entry_offer", label: "Збираю, з чим заходити" },
    () => entryOffer(client.id, ctx.scope.repId, 4),
    tools
  );

  if (!offer || offer.гачки.length === 0) {
    return {
      markdown: `До ${clientLink(client.id, client.name)} зараз нема з чим зайти автоматично: історії закупівель розхідників замало. Спитайте «що запропонувати ${client.name}» — там працює інше правило.`,
      tools,
    };
  }

  const debt =
    offer.борг.прострочено > 0
      ? `**Спершу гроші:** прострочено ${money(offer.борг.прострочено)} із ${money(offer.борг.всього)}, платник ${offer.борг.вердикт}. Новий товар — після розмови про борг.`
      : offer.борг.всього > 0
        ? `Борг ${money(offer.борг.всього)} робочий, прострочки немає (платник ${offer.борг.вердикт}).`
        : `Боргу немає, платник ${offer.борг.вердикт}.`;

  const blocks = offer.гачки.map((h) => {
    const head = `**${productLink(h.назва, h.артикул)}** — ${money(h.ціна)}${
      h.ціна_підлога ? `, не нижче ${money(h.ціна_підлога)}` : ""
    }; маржа ${percent(h.маржа_прайсова_відсотків)} від прайсу${
      h.маржа_фактична_відсотків != null ? `, фактично продаємо під ${percent(h.маржа_фактична_відсотків)}` : ""
    }. ${h.підстава}. Залишок ${h.залишок} шт.`;

    const attach = h.причіп.length
      ? [
          "  До нього:",
          ...h.причіп.map(
            (a) =>
              `  - ${productLink(a.назва, a.артикул)} — ${money(a.ціна)}, маржа ${percent(a.маржа_фактична_відсотків ?? a.маржа_прайсова_відсотків)}, ${a.підстава}`
          ),
        ]
      : [];

    const dead = h.розпрацювати.length
      ? [
          "  Заодно розпрацювати:",
          ...h.розпрацювати.map(
            (d) => `  - ${productLink(d.назва, d.артикул)} — ${d.залишок} шт лежить, ${money(d.ціна)}`
          ),
        ]
      : [];

    return [`- ${head}`, ...attach, ...dead].join("\n");
  });

  return {
    markdown: [
      `## З чим заходити до ${clientLink(client.id, client.name)}`,
      debt,
      "",
      ...blocks,
      "",
      "_Ціна нижча за прайс — це пропозиція; остаточну знижку затверджує керівник. Собівартість оцінена за останньою реалізацією._",
    ].join("\n"),
    tools,
  };
}

/** «Що запропонувати …» */
export async function answerRecommend(ctx: ToolContext, subject: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const found = await resolveClient(ctx, subject, tools);
  if ("none" in found) return { markdown: notFound(subject), tools };
  if ("ambiguous" in found) return { markdown: askWhich(subject, found.ambiguous), tools };

  const client = found.hit;
  const list = await timed(
    { name: "client_recommendations", label: "Підбираю, що запропонувати" },
    () => recommendations(client.id),
    tools
  );

  if (list.length === 0) {
    return {
      markdown: `По ${clientLink(client.id, client.name)} порад поки немає: історії закупівель замало, щоб побачити ритм.`,
      tools,
    };
  }

  const label = { REPLENISH: "пора повторити", DROPPED: "перестав брати", SIMILAR_CLIENTS: "беруть схожі клієнти" };

  return {
    markdown: [
      `**Що запропонувати ${clientLink(client.id, client.name)}:**`,
      "",
      ...list.map(
        (r) =>
          `- ${productLink(r.name, r.sku)} — ${label[r.reason]}: ${r.why}. ${money(r.price ?? 0)}, на складі ${r.stock} шт`
      ),
    ].join("\n"),
    tools,
  };
}

/** «Скільки винен …», «Що з …» */
export async function answerClientCard(ctx: ToolContext, subject: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const found = await resolveClient(ctx, subject, tools);
  if ("none" in found) return { markdown: notFound(subject), tools };
  if ("ambiguous" in found) return { markdown: askWhich(subject, found.ambiguous), tools };

  const client = found.hit;
  const [profile, aging] = await Promise.all([
    timed(
      { name: "client_profile", label: "Читаю картку клієнта" },
      () => clientProfileFacts(client.id, 6),
      tools
    ),
    agingByCounterparty([client.id]),
  ]);
  if (!profile) return { markdown: notFound(subject), tools };

  const debt = aging.get(client.id);
  const debtLine =
    (debt?.debt ?? 0) > 0
      ? `**Борг ${money(debt!.debt)}**${debt!.overdue > 0 ? `, з них прострочено ${money(debt!.overdue)}` : " (робочий, прострочки немає)"}${
          debt!.oldestDays ? `, найстарішій частині ${days(debt!.oldestDays)}` : ""
        }. Платник ${profile.платник.вердикт}${
          profile.платник.рекомендований_ліміт
            ? `, рекомендований ліміт ${money(profile.платник.рекомендований_ліміт)}`
            : ""
        }.`
      : `Боргу немає. Платник ${profile.платник.вердикт}.`;

  const memory = profile.памʼять.length
    ? ["", "**Памʼять про клієнта:**", ...profile.памʼять.map((m) => `- ${m.вид}: ${m.текст} _(${m.хто}, ${m.дата})_`)]
    : [];

  const top = (profile.топ_товари ?? []).slice(0, 5).map((p) => `- ${p.назва} — ${times(p.разів)}, ${money(p.сума)}`);

  return {
    markdown: [
      `## ${clientLink(client.id, client.name)}`,
      `${profile.стан}, ритм ${days(profile.ритм_днів)}${
        profile.днів_з_останньої_покупки != null
          ? `, остання покупка ${days(profile.днів_з_останньої_покупки)} тому`
          : ""
      }.`,
      debtLine,
      `За півроку: ${money(profile.за_період.сума)} у ${profile.за_період.документів} документах${
        profile.за_період.повернення > 0 ? `, повернень на ${money(profile.за_період.повернення)}` : ""
      }.`,
      ...memory,
      top.length ? "\n**Найчастіше бере:**" : "",
      ...top,
      "",
      `_Спитайте «з чим заходити до ${client.name}» — підберу гачок і причіп._`,
    ]
      .filter(Boolean)
      .join("\n"),
    tools,
  };
}

/* ── Товар ────────────────────────────────────────────────────────────── */

export async function answerProduct(ctx: ToolContext, query: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const [hits, totals, stats] = await Promise.all([
    timed(
      { name: "product_search", label: "Дивлюся залишок на складі" },
      () => searchProducts(query, ctx.scope.repId, 8),
      tools
    ),
    searchProductsTotals(query),
    productStats(),
  ]);

  if (hits.length === 0) {
    return { markdown: `Товару «${query}» не знайшли. Спробуйте артикул або одне точне слово з назви.`, tools };
  }

  const statById = new Map(stats.map((s) => [s.productId, s]));

  // Підсумок по групі — перше, що треба почути на «скільки ще піни».
  const head =
    totals.positions > 0
      ? `**За запитом «${query}» на складі ${totals.free} шт**, позицій ${totals.positions}.` +
        (totals.positions > hits.length ? ` Показую ${hits.length} найбільших.` : "")
      : `**За запитом «${query}» вільного залишку немає.** Ось що знайшлося:`;

  const rows = hits.map((h) => {
    const s = statById.get(h.productId);
    const price = h.price > 0 ? money(h.price) : "ціни в 1С немає";
    const stock = h.free > 0 ? `**${h.free} шт**` : "немає на складі";
    const margin = priceMarginPct(h.price, h.lastCost);
    const sold = s ? `, за 180 днів взяли ${clientsWord(s.clients)}` : "";
    const fact = s && marginPct(s) != null ? `, фактична маржа ${percent(marginPct(s)!)}` : "";
    return `- ${productLink(h.name, h.sku)} — ${stock}, ${price}${
      margin != null ? `, маржа від прайсу ${percent(margin)}` : ""
    }${fact}${sold}${h.myBuyers > 0 ? `, з ваших брали ${h.myBuyers}` : ""}`;
  });

  const notes = ["_Залишок вільний, з несервісних складів: це те, що реально можна відвантажити._"];
  if (totals.noPrice > 0) {
    notes.push(`_${items(totals.noPrice)} без ціни в 1С — продати їх не вийде, поки ціну не заведуть._`);
  }

  return { markdown: [head, "", ...rows, "", ...notes].join("\n"), tools };
}

/* ── Повернення ───────────────────────────────────────────────────────── */

/**
 * Розбір повернень: скільки, від кого, чого — і чи це багато.
 *
 * Порівняння з командою тут не з ввічливості: сама сума нічого не важить,
 * поки не видно, що у сусіда вона вп'ятеро менша при більшому обороті.
 * Причин повернень 1С не передає, тож пояснювати «чому» ми не беремося —
 * показуємо повторюваність, і це вже привід для розмови.
 */
export async function answerReturns(ctx: ToolContext, dayCount: number): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, dayCount);

  const [facts, repeated] = await Promise.all([
    timed({ name: "returns", label: "Розбираю повернення" }, () => returnsFacts(ctx.scope.repId, period), tools),
    repeatedReturns(ctx.scope.repId, period, 5),
  ]);

  if (facts.docs === 0) {
    return {
      markdown: `За ${days(dayCount)} у вас жодного повернення. По команді середня частка ${percent(facts.teamShare)} від валу.`,
      tools,
    };
  }

  const verdict =
    facts.share > facts.teamShare * 2 && facts.share > 2
      ? `Це помітно більше за команду: медіана ${percent(facts.teamShare)}, гірше за вас лише ${facts.worseThanMe} із ${facts.teamSize}.`
      : facts.share > facts.teamShare
        ? `Трохи вище за команду: медіана ${percent(facts.teamShare)}.`
        : `Це в межах команди або краще: медіана ${percent(facts.teamShare)}.`;

  const clients = facts.byClient
    .slice(0, 5)
    .map((c) =>
      c.clientId
        ? `- ${clientLink(c.clientId, c.name)} — ${money(c.amount)} у ${c.docs} ${plural(c.docs, "документі", "документах", "документах")}`
        : `- ${c.name} — ${money(c.amount)}`
    );

  const products = facts.byProduct
    .slice(0, 5)
    .map((p) => `- ${productLink(p.name, null)} — ${money(p.amount)}, ${Math.round(p.qty)} шт`);

  const repeatedBlock = repeated.length
    ? [
        "",
        "**Повторюється** (той самий клієнт повертає той самий товар не вперше):",
        ...repeated.map(
          (r) =>
            `- ${clientLink(r.clientId, r.clientName)} — ${r.productName}, ${times(r.times)} на ${money(r.amount)}`
        ),
      ]
    : [];

  return {
    markdown: [
      `**Повернень за ${days(dayCount)}: ${money(facts.amount)}** у ${facts.docs} ${plural(facts.docs, "документі", "документах", "документах")}, це ${percent(facts.share)} від валу.`,
      verdict,
      "",
      "**Хто повертає:**",
      ...clients,
      "",
      "**Що повертають:**",
      ...products,
      ...repeatedBlock,
      "",
      "_Причину повернення 1С не передає — її видно лише з розмови з клієнтом._",
    ].join("\n"),
    tools,
  };
}

/* ── Порівняння з командою ────────────────────────────────────────────── */

/** Метрики, які показуємо торговому. Решта з бенчмарку — для керівника. */
const MY_METRICS: MetricKey[] = [
  "revenue",
  "avgCheck",
  "collected",
  "skuPerClient",
  "newClients",
  "overdueRatio",
  "returnRatio",
  "momentumPct",
];

/**
 * Де я сильний, а де провисаю — у перцентилях по команді.
 *
 * Чужі суми не показуємо: торговому потрібне СВОЄ місце, а не чужий
 * оборот. Медіана команди лишається, бо без неї перцентиль — порожнє
 * число.
 */
export async function answerBenchmark(ctx: ToolContext, dayCount: number): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, dayCount);

  const report = await timed(
    { name: "team_benchmark", label: "Порівнюю з командою" },
    () => teamBenchmark(period),
    tools
  );

  const me = report.reps.find((r) => r.repId === ctx.scope.repId);
  if (!me) {
    return {
      markdown: `За ${days(dayCount)} у вас немає реалізацій, тож порівнювати нема з чим.`,
      tools,
    };
  }
  if (!report.comparable) {
    return {
      markdown: "Команда замала для порівняння: перцентилі рахуються від трьох торгових із продажами.",
      tools,
    };
  }

  const fmt = (key: MetricKey, value: number | null) => {
    if (value == null) return "немає даних";
    const unit = METRICS[key].unit;
    if (unit === "uah") return money(value);
    if (unit === "pct") return percent(value);
    return String(Math.round(value * 10) / 10);
  };

  const rows = MY_METRICS.filter((key) => me.ranks[key] != null).map((key) => {
    const rank = me.ranks[key]!;
    const mark = rank >= STRONG_PERCENTILE ? "сильно" : rank <= WEAK_PERCENTILE ? "слабко" : "середньо";
    return `- ${METRICS[key].label}: **${fmt(key, me[key])}**, ${mark} (${Math.round(rank)} перцентиль; медіана команди ${fmt(key, report.medians[key])})`;
  });

  const strengths = me.strengths.filter((k) => MY_METRICS.includes(k)).map((k) => METRICS[k].label);
  const weaknesses = me.weaknesses.filter((k) => MY_METRICS.includes(k)).map((k) => METRICS[k].label);

  return {
    markdown: [
      `**Ваше місце за оборотом: ${me.place} з ${report.reps.length}** за ${days(dayCount)}.`,
      strengths.length ? `Сильні сторони: ${strengths.join(", ")}.` : "",
      weaknesses.length ? `Провисає: ${weaknesses.join(", ")}.` : "",
      "",
      ...rows,
      "",
      "_Перцентиль — частка колег, яких ви обійшли за цим показником. Чужі суми не показуємо._",
    ]
      .filter(Boolean)
      .join("\n"),
    tools,
  };
}

/* ── ABC по клієнтах ──────────────────────────────────────────────────── */

/**
 * Хто справді тримає оборот, а хто лише здається важливим.
 *
 * Класи рахуємо за оборотом, але маржу показуємо поруч: клієнт класу A з
 * маржею нижче середньої — це не «найкращий клієнт», а найбільший
 * споживач знижки, і поводитися з ним треба інакше.
 */
export async function answerAbcClients(ctx: ToolContext, dayCount: number): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, dayCount);

  const report = await timed(
    { name: "abc_clients", label: "Рахую ABC по клієнтах" },
    () => buildAbcReport(period.from, period.to, "client", ctx.scope.repId, 300, "amount"),
    tools
  );

  if (report.rows.length === 0) {
    return { markdown: `За ${days(dayCount)} продажів немає, ABC рахувати нема на чому.`, tools };
  }

  const a = report.rows.filter((r) => r.abc === "A");
  const c = report.rows.filter((r) => r.abc === "C");
  const known = a.filter((r) => r.marginPct != null);
  const avgMargin = known.length
    ? known.reduce((sum, r) => sum + (r.marginPct ?? 0), 0) / known.length
    : null;

  const top = a.slice(0, 8).map((r) => {
    const margin = r.marginPct != null ? `, маржа ${percent(r.marginPct)}` : "";
    const flag =
      avgMargin != null && r.marginPct != null && r.marginPct < avgMargin * 0.7 ? " ⚠ низька маржа" : "";
    return `- ${clientLink(r.id, r.name)} — ${money(r.amount)} (${percent(r.share)} обороту)${margin}${flag}`;
  });

  const shaky = report.rows
    .filter((r) => r.abc === "A" && r.xyz === "Z")
    .slice(0, 5)
    .map((r) => `- ${clientLink(r.id, r.name)} — брав лише в ${r.activeMonths} з ${report.months} місяців`);

  return {
    markdown: [
      `**За ${days(dayCount)}: ${money(report.total)}, клієнтів ${report.rows.length}.**`,
      `Клас A: ${clientsWord(a.length)} дають 80 % обороту. Клас C: ${clientsWord(c.length)} разом дають 5 %.`,
      avgMargin != null ? `Середня маржа по клієнтах класу A: ${percent(avgMargin)}.` : "",
      "",
      "**Хто тримає оборот:**",
      ...top,
      shaky.length ? "\n**Великі, але нерівні** (оборот є, ритму немає):" : "",
      ...shaky,
      "",
      report.coverage < 90
        ? `_Маржа порахована для ${percent(report.coverage)} обороту: у решти рядків 1С не передала собівартість._`
        : "",
      report.xyzAvailable ? "" : `_Рівність закупівель не рахувалась: у періоді лише ${report.months} міс._`,
    ]
      .filter(Boolean)
      .join("\n"),
    tools,
  };
}

/* ── День водія ───────────────────────────────────────────────────────── */

const STOP_KIND_LABEL: Record<string, string> = {
  DELIVERY: "доставка",
  PICKUP: "забрати",
  ERRAND: "доручення",
};

/**
 * Що в водія на сьогодні: точки, гроші, каса.
 *
 * Джерело те саме, що в планшеті, і порядок точок теж: якщо помічник
 * почне рахувати по-своєму, водій повірить списку перед очима, а не йому.
 *
 * Телефон і примітку логіста тримаємо в рядку навмисно — це дві речі, по
 * які водій найчастіше телефонує диспетчеру.
 */
export async function answerDriverDay(ctx: ToolContext, day: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const facts = await timed(
    { name: "driver_day", label: "Дивлюся маршрут на день" },
    () => driverDayFacts(ctx.scope.repId, day),
    tools
  );

  if (facts.totals.stops === 0) {
    return {
      markdown: `На ${planDayLabel(day, WEEKDAY_ACCUSATIVE[weekdayOf(day)])} маршруту немає: ні листа з 1С, ні призначеного маршруту на сайті.`,
      tools,
    };
  }

  const left = facts.totals.stops - facts.totals.done;
  const head = [
    `## Маршрут на ${planDayLabel(facts.day, WEEKDAY_ACCUSATIVE[weekdayOf(facts.day)])}`,
    `${points(facts.totals.stops)}${facts.route.number ? `, лист ${facts.route.number}` : ""}${
      facts.route.vehicle ? `, ${facts.route.vehicle}` : ""
    }. Відмічено ${facts.totals.done}, лишилось ${left}.`,
    facts.totals.debt > 0
      ? `Забрати грошей: **${money(facts.totals.debt)}**. Товару на точках: ${money(facts.totals.amount)}.`
      : `Товару на точках: ${money(facts.totals.amount)}.`,
  ];

  const rows = facts.stops.map((s) => {
    const bits: string[] = [];
    if (s.debt > 0) bits.push(`забрати ${money(s.debt)}`);
    if (s.amount > 0) bits.push(`товару на ${money(s.amount)}`);
    if (s.kind !== "DELIVERY") bits.push(STOP_KIND_LABEL[s.kind] ?? s.kind);
    if (!s.hasPin) bits.push("точки на карті немає");
    if (s.done) bits.push("вже відмічено");

    const title = s.counterpartyId ? clientLink(s.counterpartyId, s.name) : `**${s.name}**`;
    const address = s.address ? ` — ${s.address}` : "";
    const phone = s.phone ? ` · ${s.phone}` : "";
    const note = s.notes ? `\n  Примітка логіста: ${s.notes}` : "";

    return `${s.seq}. ${title}${address}${phone}${bits.length ? `. ${bits.join("; ")}` : ""}${note}`;
  });

  const cash =
    facts.cash.collected > 0 || facts.cash.handed > 0
      ? [
          "",
          `**Каса:** зібрано ${money(facts.cash.collected)}, здано ${money(facts.cash.handed)}, на руках ${money(facts.cash.onHands)}.`,
        ]
      : [];

  return {
    markdown: [...head, "", ...rows, ...cash].join("\n"),
    tools,
  };
}

function weekdayOf(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}
