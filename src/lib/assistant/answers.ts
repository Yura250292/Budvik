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
import { monthForecast, type MonthForecast } from "@/lib/assistant/facts/forecast";
import { OVERDUE_HOOK_MIN } from "@/lib/assistant/config";
import {
  clientLink,
  clients as clientsWord,
  days,
  items,
  money,
  monthLabel,
  planDayLabel,
  percent,
  plural,
  points,
  productLink,
  times,
} from "@/lib/assistant/text";
import type { ToolContext } from "@/lib/assistant/types";

/* ── Оформлення відповіді ─────────────────────────────────────────────────
 *
 * Одне оформлення на всі відповіді: заголовок зі знаком, таблиця там, де
 * числа порівнюються, світлофор замість слів «добре / погано» і рядок
 * підказок унизу. Це не прикраса: відповідь читають із телефона однією
 * рукою, і однакова форма означає, що потрібне число завжди в тому самому
 * місці.
 *
 * ЧОГО НЕ РОБИМО ТАБЛИЦЕЮ — списків клієнтів. Пункт, який починається з
 * посилання на картку, кабінет малює як тапабельний рядок із шевроном
 * (див. AssistantMarkdown). Усередині таблиці цей рядок зникає, і замість
 * «натиснув і поїхав» виходить «прочитав і шукай руками».
 */

/**
 * Збірка відповіді з рядків.
 *
 * Порожній рядок у маркдауні — це роздільник абзаців, тож викидати його
 * не можна (інакше таблиця злипнеться із заголовком). А два поспіль уже
 * зайві, і саме вони з'являються там, де секція не заповнилася.
 */
function md(lines: Array<string | null | undefined>): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line == null) continue;
    if (line === "" && out[out.length - 1] === "") continue;
    out.push(line);
  }
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** Клітинка таблиці: вертикальна риска в назві зламала б розмітку. */
const cell = (value: string | number) => String(value).replace(/\|/g, "/");

/** Таблиця GFM. Заголовки короткі: ширина екрана — 360 точок. */
function table(headers: string[], rows: Array<Array<string | number>>): string[] {
  if (rows.length === 0) return [];
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ];
}

/** Довгу назву в таблиці ріжемо: інакше рядок їде за край екрана. */
const short = (name: string, max = 38) =>
  name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;

/** Світлофор: зелений — добре, жовтий — середньо, червоний — погано. */
const light = (state: "good" | "mid" | "bad") =>
  state === "good" ? "🟢" : state === "mid" ? "🟡" : "🔴";

/** Знак платника — той самий скрізь, де показуємо вердикт. */
const payerIcon = (verdict: string | null | undefined) =>
  !verdict
    ? "⚪"
    : /надійн/i.test(verdict)
      ? "🟢"
      : /помірн/i.test(verdict)
        ? "🟡"
        : /ризиков/i.test(verdict)
          ? "🟠"
          : "🔴";

/** Стрілка динаміки. */
const arrow = (value: number | null): string =>
  value == null ? "" : value > 0 ? "📈" : value < 0 ? "📉" : "➖";

/** Рядок підказок під відповіддю: у кабінеті це тапабельні кнопки. */
function followUps(...questions: Array<string | null>): string {
  const list = questions.filter((q): q is string => Boolean(q));
  return list.length ? `> 💬 ${list.join(" · ")}` : "";
}

/**
 * Смужка виконання з десяти квадратів.
 *
 * Кольором тут працює сам символ: у маркдауні кольору немає, а квадрат є
 * скрізь — і в застосунку, і в браузері. Порогів три, щоб «майже план» і
 * «провал» не виглядали однаково.
 */
function bar(percentValue: number | null): string {
  if (percentValue == null) return "";
  const filled = Math.max(0, Math.min(10, Math.round(percentValue / 10)));
  const block = percentValue >= 100 ? "🟩" : percentValue >= 90 ? "🟨" : "🟥";
  return block.repeat(filled) + "⬜".repeat(10 - filled);
}

/** Медаль за місце. Далі третього — просто число, інакше медалі знецінюються. */
const MEDALS = ["🥇", "🥈", "🥉"];

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
      markdown: `## 📅 План на ${planDayLabel(day, WEEKDAY_ACCUSATIVE[weekdayIndex(plan.день_тижня)])}\n\nНа цей день немає ні звичних клієнтів, ні термінових справ. Схоже, історії ще замало — спитайте про борги або про клієнтів, які давно не брали.`,
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
    if (c.прострочено > 0) parts.push(`🔴 прострочено ${money(c.прострочено)}`);
    else if (c.борг > 0) parts.push(`🟡 борг ${money(c.борг)}`);
    if (c.дія) parts.push(c.дія.toLowerCase());
    if (c.звичний_для_дня) parts.push(`звичний для ${WEEKDAY_GENITIVE[weekdayIndex(plan.день_тижня)]}`);
    if (c.днів_з_останньої != null) parts.push(`не брав ${days(c.днів_з_останньої)}`);

    const hook = hooks.get(c.клієнт_id);
    const withWhat = hook
      ? ` 🎁 ${productLink(hook.name, hook.sku)} — ${money(hook.price)}${
          hook.floor ? `, не нижче ${money(hook.floor)}` : ""
        }`
      : "";

    return `${i + 1}. ${clientLink(c.клієнт_id, c.назва)} — ${parts.join(" · ")}.${withWhat}`;
  });

  const head = plan.маршрут_за_розкладом
    ? `Маршрут за розкладом: **${plan.маршрут_за_розкладом.назва}** (${plan.маршрут_за_розкладом.пункти.slice(0, 6).join(", ")}).`
    : "Постійного маршруту на цей день не заведено — список зібрано зі звички й термінових справ.";

  return {
    markdown: md([
      `## 📅 План на ${planDayLabel(day, WEEKDAY_ACCUSATIVE[weekdayIndex(plan.день_тижня)])}`,
      "",
      ...table(
        ["📍 Точок", "🔴 Забрати", "💰 Борг усього"],
        [[plan.разом.точок, money(plan.разом.прострочено), money(plan.разом.борг)]]
      ),
      "",
      head,
      "",
      ...lines,
      "",
      "_🎁 — з чим заходити. Ціни прайсові; нижче прайсу це пропозиція, знижку затверджує керівник._",
      "",
      followUps("Кому з них дзвонити першому?", "Що казати про борг?", "Чи витягну план?"),
    ]),
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
    const age = d.oldestDays != null ? ` · ${days(d.oldestDays)}` : "";
    return `- ${d.overdue > 0 ? "🔴" : "🟡"} ${clientLink(d.counterpartyId, d.name)} — ${
      d.overdue > 0 ? `прострочено **${money(d.overdue)}** із ${money(d.debt)}` : `борг ${money(d.debt)} робочий`
    }${age}${verdict ? ` · ${payerIcon(verdict)} ${verdict}` : ""}`;
  });

  const overdueCount = debtors.filter((d) => d.overdue > 0).length;

  return {
    markdown: md([
      "## 💰 Дебіторка",
      "",
      ...table(
        ["💼 Усього", "🔴 Прострочено", "👥 Боржників"],
        [[
          money(total.total),
          `${money(total.overdue)} (${percent(total.overdueRatio)})`,
          `${debtors.length}, з простроченою ${overdueCount}`,
        ]]
      ),
      "",
      "**Кому нагадати передусім:**",
      ...worst,
      "",
      "_Вік боргу відновлено з дат наших відвантажень: 1С передає лише загальне сальдо. Платник: 🟢 надійний · 🟡 помірний · 🟠 ризиковий · 🔴 лише передоплата._",
      "",
      followUps(
        "Кому дзвонити першому і що казати?",
        "Кому з них не можна відвантажувати?",
        "Як це впливає на мій бонус?"
      ),
    ]),
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

  const risk = list.filter((a) => a.kind === "CHURN_RISK").length;

  return {
    markdown: md([
      "## 😴 Хто згасає",
      "",
      ...table(
        ["⏳ Відстають від ритму", "💤 Сплять", "💰 Дали за 30 днів"],
        [[risk, list.length - risk, money(list.reduce((sum, a) => sum + a.amountPeriod, 0))]]
      ),
      "",
      ...list.map(
        (a) =>
          `- ${a.kind === "CHURN_RISK" ? "⏳" : "💤"} ${clientLink(a.counterpartyId, a.name)} — ${a.why}`
      ),
      "",
      "_Ритм рахується по днях із покупками за всю історію клієнта, а не по документах._",
      "",
      followUps("З чим до них заходити?", "Хто з них ще й винен?", "Кого рятувати першим?"),
    ]),
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
    markdown: md([
      `## 🧊 Мертвий залишок${brand ? ` · ${brand}` : ""}`,
      `**${items(list.length)} без продажу 90+ днів** на ${money(sum)} за собівартістю.`,
      "",
      ...table(
        ["Товар", "📦 Шт", "💵 Ціна", "📊 Маржа", "👥 Мої"],
        list.map((i) => {
          const margin = priceMarginPct(i.price, i.lastCost);
          return [
            productLink(short(i.name, 34), i.sku),
            i.free,
            money(i.price),
            margin == null ? "—" : percent(margin),
            i.myBuyers > 0 ? `${i.myBuyers} 🟢` : "—",
          ];
        })
      ),
      "",
      known.length > 0
        ? `_🟢 — цю позицію вже брали ваші клієнти: з таких і починати._`
        : "_Цього залишку ваші клієнти ще не брали — починати варто з тих, кому бренд знайомий._",
      "",
      followUps("Кому з клієнтів це можна запропонувати?", "Яку ціну можна дати?"),
    ]),
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
  const plan = s.план_місяця;

  return {
    markdown: md([
      `## 📈 Продажі за ${days(dayCount)}`,
      "",
      ...table(
        ["Показник", "Значення"],
        [
          [
            "💰 Оборот",
            `**${money(s.підсумок.сума)}**${
              change == null ? "" : ` ${arrow(change)} ${percent(change)}`
            }`,
          ],
          ["🧾 Середній чек", money(s.підсумок.середній_чек)],
          ["👥 Клієнтів", `${s.підсумок.клієнтів} · ${s.підсумок.реалізацій} реалізацій`],
          ["📦 Позицій", s.підсумок.позицій],
          ["💵 Зібрано грошей", money(s.підсумок.зібрано_грошей)],
          ["↩️ Повернення", s.підсумок.повернення > 0 ? `🔴 ${money(s.підсумок.повернення)}` : "🟢 немає"],
        ]
      ),
      "",
      change == null
        ? ""
        : `_За попередні ${days(dayCount)} було ${money(s.попередній_період!.сума)}._`,
      "",
      plan.план > 0
        ? md([
            `### 🎯 План на ${monthLabel(plan.місяць, ctx.today)}`,
            `${bar(plan.виконання_відсотків ?? 0)} **${percent(plan.виконання_відсотків ?? 0)}** — ${money(plan.факт)} із ${money(plan.план)}`,
            plan.лишилось_добрати
              ? `Добрати ${money(plan.лишилось_добрати)}${plan.треба_на_день ? `, тобто ${money(plan.треба_на_день)} на день` : ""}.`
              : "План уже закритий.",
          ])
        : "_🎯 Плану на цей місяць не заведено._",
      "",
      s.бренди.length > 0 ? "### 🏷️ Топ брендів" : "",
      "",
      ...table(
        ["Бренд", "💰 Сума", "📊 Вал"],
        s.бренди.slice(0, 5).map((b) => [short(b.бренд, 24), money(b.сума), money(b.вал)])
      ),
      "",
      "_Рахуються реалізації (відвантажене), суми нетто — повернення відняті._",
      "",
      followUps("Чи витягну план?", "Як я на фоні команди?", "Чому змінився оборот?"),
    ]),
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

  const DAY_ICONS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣"];

  const blocks = filled.flatMap((d) => {
    const head = `### ${DAY_ICONS[d.weekday - 1]} ${WEEKDAY_NAMES[d.weekday - 1]}${
      d.template ? ` · шаблон «${d.template.name}»` : ""
    }`;
    const rows = d.clients.slice(0, weekday ? 10 : 5).map((c) => {
      const bits: string[] = [];
      if (c.orders) bits.push(`🧾 ${c.orders}`);
      if (c.visits) bits.push(`✅ ${c.visits}`);
      if (c.stops) bits.push(`📍 ${c.stops}`);
      return `- ${clientLink(c.counterpartyId, c.name)} — ${bits.join(" · ")}`;
    });
    return [head, "", ...rows, ""];
  });

  return {
    markdown: md([
      `## 🗺️ Звичний маршрут`,
      "",
      ...table(
        ["День", "👥 Точок", "🧾 Замовлень"],
        filled.map((d) => [
          `${DAY_ICONS[d.weekday - 1]} ${WEEKDAY_NAMES[d.weekday - 1]}`,
          d.clients.length,
          d.clients.reduce((sum, c) => sum + c.orders, 0),
        ])
      ),
      "",
      ...blocks,
      "_🧾 замовлення · ✅ візит · 📍 зупинка. Замовлення важать більше: зупинка каже лише, що ви стояли поруч._",
      "",
      followUps("Сплануй мій день", "Кого з них давно не було?"),
    ]),
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
  return md([
    `## 🔎 Кілька збігів на «${subject}»`,
    "Про кого з них ідеться?",
    "",
    ...hits.map(
      (h) =>
        `- ${h.mine ? "⭐" : "🏪"} ${clientLink(h.id, h.name)}${h.address ? ` — ${h.address}` : ""}`
    ),
    "",
    "_⭐ — ваш клієнт._",
  ]);
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
      ? `🔴 **Спершу гроші:** прострочено ${money(offer.борг.прострочено)} із ${money(offer.борг.всього)}, платник ${payerIcon(offer.борг.вердикт)} ${offer.борг.вердикт}. Новий товар — після розмови про борг.`
      : offer.борг.всього > 0
        ? `🟡 Борг ${money(offer.борг.всього)} робочий, прострочки немає · платник ${payerIcon(offer.борг.вердикт)} ${offer.борг.вердикт}.`
        : `🟢 Боргу немає · платник ${payerIcon(offer.борг.вердикт)} ${offer.борг.вердикт}.`;

  const blocks = offer.гачки.flatMap((h) => [
    `### 🎣 ${productLink(h.назва, h.артикул)}`,
    "",
    ...table(
      ["💵 Ціна", "🛑 Не нижче", "📊 Маржа", "📦 Залишок"],
      [[
        money(h.ціна),
        h.ціна_підлога ? money(h.ціна_підлога) : "—",
        `${percent(h.маржа_прайсова_відсотків)}${
          h.маржа_фактична_відсотків != null ? ` (факт ${percent(h.маржа_фактична_відсотків)})` : ""
        }`,
        `${h.залишок} шт`,
      ]]
    ),
    `_${h.підстава}._`,
    ...(h.причіп.length
      ? [
          "",
          "🔗 **Причіп:**",
          ...h.причіп.map(
            (a) =>
              `- ${productLink(a.назва, a.артикул)} — ${money(a.ціна)} · маржа ${percent(a.маржа_фактична_відсотків ?? a.маржа_прайсова_відсотків)} · ${a.підстава}`
          ),
        ]
      : []),
    ...(h.розпрацювати.length
      ? [
          "",
          "🧊 **Заодно зрушити:**",
          ...h.розпрацювати.map(
            (d) => `- ${productLink(d.назва, d.артикул)} — ${d.залишок} шт лежить, ${money(d.ціна)}`
          ),
        ]
      : []),
    "",
  ]);

  return {
    markdown: md([
      `## 🎁 З чим заходити до ${clientLink(client.id, client.name)}`,
      debt,
      "",
      ...blocks,
      "_Ціна нижча за прайс — це пропозиція; остаточну знижку затверджує керівник. Собівартість оцінена за останньою реалізацією._",
      "",
      followUps("Що ще йому запропонувати?", "Скільки він винен?", "Що ми про нього памʼятаємо?"),
    ]),
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

  const label = {
    REPLENISH: "🔁 пора повторити",
    DROPPED: "⚠️ перестав брати",
    SIMILAR_CLIENTS: "👥 беруть схожі",
  };

  return {
    markdown: md([
      `## 🛒 Що запропонувати ${clientLink(client.id, client.name)}`,
      "",
      ...table(
        ["Товар", "Чому", "💵 Ціна", "📦 Склад"],
        list.map((r) => [
          productLink(short(r.name, 30), r.sku),
          label[r.reason],
          money(r.price ?? 0),
          r.stock > 0 ? `${r.stock} шт` : "🔴 немає",
        ])
      ),
      "",
      ...list.slice(0, 3).map((r) => `- ${short(r.name, 30)}: ${r.why}`),
      "",
      followUps("З чим сюди заходити?", "Скільки він винен?"),
    ]),
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
  const overdue = debt?.overdue ?? 0;

  const state = /спить|втрачен/i.test(profile.стан) ? "🔴" : /відстає/i.test(profile.стан) ? "🟡" : "🟢";

  const memory = profile.памʼять.length
    ? [
        "",
        "### 🧠 Памʼять про клієнта",
        ...profile.памʼять.map((m) => `- **${m.вид}:** ${m.текст} _(${m.хто}, ${m.дата})_`),
      ]
    : [];

  const top = (profile.топ_товари ?? []).slice(0, 5);

  return {
    markdown: md([
      `## 🏪 ${clientLink(client.id, client.name)}`,
      "",
      ...table(
        ["Показник", "Значення"],
        [
          [
            "💰 Борг",
            (debt?.debt ?? 0) > 0
              ? `${money(debt!.debt)}${overdue > 0 ? ` · 🔴 прострочено ${money(overdue)}` : " · 🟢 робочий"}${
                  debt!.oldestDays ? ` · ${days(debt!.oldestDays)}` : ""
                }`
              : "🟢 немає",
          ],
          [
            "🤝 Платник",
            `${payerIcon(profile.платник.вердикт)} ${profile.платник.вердикт}${
              profile.платник.рекомендований_ліміт
                ? ` · ліміт ${money(profile.платник.рекомендований_ліміт)}`
                : ""
            }`,
          ],
          [
            "📊 Стан",
            `${state} ${profile.стан} · ритм ${days(profile.ритм_днів)}${
              profile.днів_з_останньої_покупки != null
                ? ` · не брав ${days(profile.днів_з_останньої_покупки)}`
                : ""
            }`,
          ],
          [
            "🧾 За півроку",
            `${money(profile.за_період.сума)} у ${profile.за_період.документів} документах${
              profile.за_період.повернення > 0
                ? ` · ↩️ ${money(profile.за_період.повернення)}`
                : ""
            }`,
          ],
        ]
      ),
      ...memory,
      "",
      top.length ? "### 📦 Найчастіше бере" : "",
      "",
      ...table(
        ["Товар", "Разів", "💰 Сума"],
        top.map((p) => [short(p.назва, 32), times(p.разів), money(p.сума)])
      ),
      "",
      followUps(
        "З чим сюди заходити?",
        "Що він брав минулого разу?",
        overdue > 0 ? "Як говорити про борг?" : "Що йому ще запропонувати?"
      ),
    ]),
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
  const notes = ["_📦 залишок вільний, з несервісних складів: це те, що реально можна відвантажити._"];
  if (totals.noPrice > 0) {
    notes.push(`_🚫 ${items(totals.noPrice)} без ціни в 1С — продати їх не вийде, поки ціну не заведуть._`);
  }

  return {
    markdown: md([
      `## 📦 ${query}`,
      "",
      ...table(
        ["📦 На складі", "🏷️ Позицій", "👀 Показано"],
        [[
          totals.free > 0 ? `**${totals.free} шт**` : "🔴 немає",
          totals.positions,
          Math.min(hits.length, totals.positions || hits.length),
        ]]
      ),
      "",
      ...table(
        ["Товар", "📦 Шт", "💵 Ціна", "📊 Маржа", "👥 Мої"],
        hits.map((h) => {
          const stat = statById.get(h.productId);
          const margin = priceMarginPct(h.price, h.lastCost);
          const fact = stat && marginPct(stat) != null ? marginPct(stat)! : null;
          return [
            productLink(short(h.name, 32), h.sku),
            h.free > 0 ? `**${h.free}**` : "🔴 0",
            h.price > 0 ? money(h.price) : "🚫 —",
            margin == null
              ? "—"
              : `${percent(margin)}${fact != null ? ` (факт ${percent(fact)})` : ""}`,
            h.myBuyers > 0 ? `${h.myBuyers} 🟢` : "—",
          ];
        })
      ),
      "",
      ...notes,
      "",
      followUps("Кому з клієнтів це зайде?", "Яку ціну можна дати?"),
    ]),
    tools,
  };
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
        ? `- ↩️ ${clientLink(c.clientId, c.name)} — **${money(c.amount)}** у ${c.docs} ${plural(c.docs, "документі", "документах", "документах")}`
        : `- ↩️ ${c.name} — **${money(c.amount)}**`
    );

  const repeatedBlock = repeated.length
    ? [
        "",
        "### 🔁 Повторюється",
        "_Той самий клієнт повертає той самий товар не вперше._",
        ...repeated.map(
          (r) =>
            `- ${clientLink(r.clientId, r.clientName)} — ${short(r.productName, 34)}, ${times(r.times)} на ${money(r.amount)}`
        ),
      ]
    : [];

  const state: "good" | "mid" | "bad" =
    facts.share > facts.teamShare * 2 && facts.share > 2
      ? "bad"
      : facts.share > facts.teamShare
        ? "mid"
        : "good";

  return {
    markdown: md([
      `## ↩️ Повернення за ${days(dayCount)}`,
      "",
      ...table(
        ["💸 Сума", "🧾 Документів", "📊 Частка від валу", "👥 Медіана команди"],
        [[
          money(facts.amount),
          facts.docs,
          `${light(state)} ${percent(facts.share)}`,
          percent(facts.teamShare),
        ]]
      ),
      `_${verdict}_`,
      "",
      "### 👤 Хто повертає",
      ...clients,
      "",
      "### 📦 Що повертають",
      "",
      ...table(
        ["Товар", "💸 Сума", "Шт"],
        facts.byProduct.slice(0, 5).map((p) => [short(p.name, 32), money(p.amount), Math.round(p.qty)])
      ),
      ...repeatedBlock,
      "",
      "_Причину повернення 1С не передає — її видно лише з розмови з клієнтом._",
      "",
      followUps("Чому вони повертають?", "Як це б'є по моїй маржі?"),
    ]),
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



/** Іконка метрики: у таблиці з телефона вона читається швидше за слово. */
const METRIC_ICONS: Partial<Record<MetricKey, string>> = {
  revenue: "💰",
  avgCheck: "🧾",
  collected: "💵",
  skuPerClient: "📦",
  newClients: "🌱",
  overdueRatio: "⏰",
  returnRatio: "↩️",
  momentumPct: "📊",
};


/**
 * Де я в команді — з рейтингом, показниками й прогнозом на місяць.
 *
 * Рейтинг із іменами й сумами колег показуємо навмисно (рішення власника
 * 05.09.2026: «торгові — одна команда, секретів немає»). До того тут були
 * самі перцентилі, і торговий бачив «6 з 9», не розуміючи, скільки саме
 * не вистачає до п'ятого місця — тобто змагання без табло.
 */
export async function answerBenchmark(ctx: ToolContext, dayCount: number): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, dayCount);

  const [report, forecast] = await Promise.all([
    timed({ name: "team_benchmark", label: "Порівнюю з командою" }, () => teamBenchmark(period), tools),
    timed({ name: "month_forecast", label: "Рахую темп місяця" }, () => monthForecast(ctx.scope.repId, ctx.today), tools),
  ]);

  const me = report.reps.find((r) => r.repId === ctx.scope.repId);
  if (!me) {
    return {
      markdown: `За ${days(dayCount)} у вас немає реалізацій, тож порівнювати нема з чим.`,
      tools,
    };
  }
  if (!report.comparable) {
    return {
      markdown: "Команда замала для порівняння: рахуємо, лише коли продажі є щонайменше в трьох торгових.",
      tools,
    };
  }

  const fmt = (key: MetricKey, value: number | null) => {
    if (value == null) return "—";
    const unit = METRICS[key].unit;
    if (unit === "uah") return money(value);
    if (unit === "pct") return percent(value);
    return String(Math.round(value * 10) / 10);
  };

  /* ── Табло ──────────────────────────────────────────────────────────── */

  const board = [...report.reps].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const leader = board[0]?.revenue ?? 0;
  const boardRows = board.map((r, i) => {
    const isMe = r.repId === me.repId;
    const place = MEDALS[i] ?? `${i + 1}`;
    const name = isMe ? `**👉 ${r.name} (ви)**` : r.name;
    const sum = isMe ? `**${money(r.revenue ?? 0)}**` : money(r.revenue ?? 0);
    const share = leader > 0 ? Math.round(((r.revenue ?? 0) / leader) * 100) : 0;
    const momentum = r.momentumPct == null ? "—" : `${arrow(r.momentumPct)} ${percent(r.momentumPct)}`;
    return `| ${place} | ${name} | ${sum} | ${share} % | ${momentum} |`;
  });

  // Скільки бракує, щоб піднятися на сходинку. Це і є мета на завтра.
  const ahead = board[board.indexOf(me) - 1];
  const gap = ahead ? (ahead.revenue ?? 0) - (me.revenue ?? 0) : 0;
  const chase = ahead
    ? `🎯 До ${board.indexOf(ahead) + 1} місця (${ahead.name}) бракує **${money(gap)}** — це ${money(gap / Math.max(1, forecast.днів_лишилось || 1))} на день до кінця місяця.`
    : "👑 Ви перший у команді за оборотом — тримайте.";

  /* ── Мої показники ──────────────────────────────────────────────────── */

  const metricRows = MY_METRICS.filter((key) => me.ranks[key] != null).map((key) => {
    const rank = Math.round(me.ranks[key]!);
    const lightMark = rank >= STRONG_PERCENTILE ? "🟢" : rank <= WEAK_PERCENTILE ? "🔴" : "🟡";
    return `| ${METRIC_ICONS[key] ?? ""} ${METRICS[key].label} | **${fmt(key, me[key])}** | ${fmt(key, report.medians[key])} | ${lightMark} ${rank} % |`;
  });

  const strengths = me.strengths.filter((k) => MY_METRICS.includes(k)).map((k) => `${METRIC_ICONS[k] ?? ""} ${METRICS[k].label}`);
  const weaknesses = me.weaknesses.filter((k) => MY_METRICS.includes(k)).map((k) => `${METRIC_ICONS[k] ?? ""} ${METRICS[k].label}`);

  const weakest = me.weaknesses.find((k) => MY_METRICS.includes(k));

  return {
    markdown: md([
      `## 🏆 Табло команди · ${days(dayCount)}`,
      `Ваше місце за оборотом: **${me.place} з ${report.reps.length}**.`,
      "",
      "| # | Торговий | Оборот | Від лідера | Динаміка |",
      "| --- | --- | --- | --- | --- |",
      ...boardRows,
      "",
      chase,
      "",
      "### 📊 Ваші показники проти команди",
      "",
      "| Показник | Ви | Медіана команди | 🏅 Позаду вас |",
      "| --- | --- | --- | --- |",
      ...metricRows,
      "",
      strengths.length ? `✅ **Сильне:** ${strengths.join(", ")}.` : "",
      weaknesses.length ? `⚠️ **Провисає:** ${weaknesses.join(", ")}.` : "",
      "",
      ...forecastBlock(forecast),
      "",
      "_🟢 сильно · 🟡 середньо · 🔴 слабко. «Позаду вас» — яка частка команди слабша за вас у цьому рядку: 72 % означає, що краще за вас лише кожен четвертий._",
      "",
      followUps(
        weakest ? `Чому провисає ${METRICS[weakest].label.toLowerCase()}?` : null,
        "Як мені догнати сусіда в таблиці?",
        "Кому нагадати про борг, щоб підняти зібране?"
      ),
    ]),
    tools,
  };
}

/**
 * «Якщо так і піде далі» — спільний блок для табла й окремого питання.
 *
 * Прогноз лінійний і про це сказано прямо: місяць добігає рівно так, як
 * ішов дотепер, лише коли нічого не змінюється. Обіцяти точність, якої
 * немає, — швидший спосіб втратити довіру, ніж помилитися на 10%.
 */
export function forecastBlock(f: MonthForecast, level: "##" | "###" = "###"): string[] {
  const lines: string[] = [
    `${level} 🔮 Прогноз на ${monthLabel(f.місяць, f.місяць)}`,
    `Минуло ${days(f.днів_минуло)} із ${f.днів_усього}, лишилось ${days(f.днів_лишилось)}.`,
    "",
  ];

  for (const m of f.показники) {
    const icon = m.ключ === "revenue" ? "💰" : "💵";
    lines.push(
      `**${icon} ${m.назва}:** ${money(m.факт)} → темп ${money(m.темп_на_день)}/день → **${money(m.прогноз)}** до кінця місяця`
    );

    if (m.план > 0) {
      const done = m.прогнозоване_виконання_відсотків ?? 0;
      const verdict = done >= 110 ? "🚀 з перевиконанням" : done >= 100 ? "✅ план закриється" : done >= 90 ? "⚠️ трохи не дотягує" : "🔴 план під загрозою";
      lines.push(`${bar(done)} **${percent(done)}** плану (${money(m.план)}) — ${verdict}`);
      if (m.треба_на_день != null && m.лишилось_добрати) {
        lines.push(`Добрати ${money(m.лишилось_добрати)}, тобто ${money(m.треба_на_день)} на день.`);
      }
    } else if (m.минулий_місяць > 0) {
      const diff = m.зміна_до_минулого_відсотків;
      lines.push(
        `${arrow(diff)} ${diff == null ? "" : `${percent(Math.abs(diff))} ${diff >= 0 ? "більше" : "менше"} за ${monthLabel(f.минулий_місяць, f.місяць)} `}(${money(m.минулий_місяць)}).`
      );
    }
    lines.push("");
  }

  for (const b of f.бонуси) {
    lines.push(
      b.спрацює === null
        ? `🎁 ${b.правило}: поріг ${percent(b.поріг_відсотків)} — плану немає, рахувати нема від чого.`
        : b.спрацює
          ? `🎁 ${b.правило}: за темпом ${percent(b.прогноз_відсотків ?? 0)} — **бонус спрацьовує**.`
          : `🎁 ${b.правило}: поріг ${percent(b.поріг_відсотків)}, за темпом виходить ${percent(b.прогноз_відсотків ?? 0)} — поки не вистачає.`
    );
  }

  if (f.примітка) lines.push(`_${f.примітка[0].toUpperCase()}${f.примітка.slice(1)}._`);
  return lines;
}

/** Окреме питання «чи витягну план», без табла команди. */
export async function answerForecast(ctx: ToolContext): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const forecast = await timed(
    { name: "month_forecast", label: "Рахую темп місяця" },
    () => monthForecast(ctx.scope.repId, ctx.today),
    tools
  );

  return {
    markdown: md([
      ...forecastBlock(forecast, "##"),
      "",
      followUps(
        forecast.показники.some((m) => m.план > 0)
          ? "Що зробити, щоб дотягнути до плану?"
          : "Як мені підняти оборот до кінця місяця?",
        "Кому нагадати про борг, щоб підняти зібране?",
        "Як я на фоні команди?"
      ),
    ]),
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
    const low = avgMargin != null && r.marginPct != null && r.marginPct < avgMargin * 0.7;
    const margin = r.marginPct != null ? ` · маржа ${low ? "🔴" : "🟢"} ${percent(r.marginPct)}` : "";
    return `- 🅰️ ${clientLink(r.id, r.name)} — **${money(r.amount)}** (${percent(r.share)} обороту)${margin}`;
  });

  const shaky = report.rows
    .filter((r) => r.abc === "A" && r.xyz === "Z")
    .slice(0, 5)
    .map((r) => `- ⚠️ ${clientLink(r.id, r.name)} — брав лише в ${r.activeMonths} з ${report.months} місяців`);

  const b = report.rows.filter((r) => r.abc === "B");

  return {
    markdown: md([
      `## 🅰️ Хто тримає ваш оборот · ${days(dayCount)}`,
      "",
      ...table(
        ["Клас", "👥 Клієнтів", "💰 Оборот", "Що це"],
        [
          ["🅰️ A", a.length, money(a.reduce((sum, r) => sum + r.amount, 0)), "80 % обороту"],
          ["🅱️ B", b.length, money(b.reduce((sum, r) => sum + r.amount, 0)), "наступні 15 %"],
          ["🅲 C", c.length, money(c.reduce((sum, r) => sum + r.amount, 0)), "останні 5 %"],
        ]
      ),
      avgMargin != null ? `_Середня маржа по класу A: ${percent(avgMargin)}._` : "",
      "",
      "### 👑 Хто тримає оборот",
      ...top,
      ...(shaky.length ? ["", "### ⚠️ Великі, але нерівні", "_Оборот є, ритму немає._", ...shaky] : []),
      "",
      report.coverage < 90
        ? `_Маржа порахована для ${percent(report.coverage)} обороту: у решти рядків 1С не передала собівартість._`
        : "",
      report.xyzAvailable ? "" : `_Рівність закупівель не рахувалась: у періоді лише ${report.months} міс._`,
      "",
      followUps("Кого з класу A давно не було?", "У кого з них низька маржа?", "З чим до них заходити?"),
    ]),
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

  const rows = facts.stops.map((s) => {
    const bits: string[] = [];
    if (s.debt > 0) bits.push(`💵 забрати ${money(s.debt)}`);
    if (s.amount > 0) bits.push(`📦 ${money(s.amount)}`);
    if (s.kind !== "DELIVERY") bits.push(STOP_KIND_LABEL[s.kind] ?? s.kind);
    if (!s.hasPin) bits.push("📍 немає на карті");

    const mark = s.done ? "✅" : "⬜";
    const title = s.counterpartyId ? clientLink(s.counterpartyId, s.name) : `**${s.name}**`;
    const address = s.address ? ` — ${s.address}` : "";
    const phone = s.phone ? ` · 📞 ${s.phone}` : "";
    const note = s.notes ? `\n  📝 ${s.notes}` : "";

    return `${s.seq}. ${mark} ${title}${address}${phone}${bits.length ? ` · ${bits.join(" · ")}` : ""}${note}`;
  });

  const cash =
    facts.cash.collected > 0 || facts.cash.handed > 0
      ? [
          "",
          "### 💰 Каса",
          "",
          ...table(
            ["Зібрано", "Здано", "На руках"],
            [[money(facts.cash.collected), money(facts.cash.handed), `**${money(facts.cash.onHands)}**`]]
          ),
        ]
      : [];

  return {
    markdown: md([
      `## 🚚 Маршрут на ${planDayLabel(facts.day, WEEKDAY_ACCUSATIVE[weekdayOf(facts.day)])}`,
      facts.route.number || facts.route.vehicle
        ? `_${[facts.route.number ? `лист ${facts.route.number}` : null, facts.route.vehicle]
            .filter(Boolean)
            .join(" · ")}_`
        : "",
      "",
      ...table(
        ["📍 Точок", "✅ Готово", "⬜ Лишилось", "💵 Забрати", "📦 Товару"],
        [[
          facts.totals.stops,
          facts.totals.done,
          left,
          facts.totals.debt > 0 ? `**${money(facts.totals.debt)}**` : "—",
          money(facts.totals.amount),
        ]]
      ),
      "",
      ...rows,
      ...cash,
      "",
      followUps("Скільки в касі?", "Що це за клієнт?"),
    ]),
    tools,
  };
}

function weekdayOf(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}
