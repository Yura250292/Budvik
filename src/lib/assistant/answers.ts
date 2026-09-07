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

import { prisma } from "@/lib/prisma";
import { ymd } from "@/lib/assistant/format";
import {
  MEDALS,
  PLAN_HOOKS,
  arrow,
  bar,
  followUps,
  light,
  md,
  payerIcon,
  short,
  table,
  timed,
  type DirectAnswer,
} from "@/lib/assistant/md";
import {
  capitalize,
  periodChips,
  periodOf,
} from "@/lib/assistant/period";
import { ACTION_LABELS, repActionCandidates } from "@/lib/analytics/company/rep-actions";
import { agingByCounterparty, receivableRowsByRep, sumAging, toDebtorList } from "@/lib/analytics/money-facts";
import { clientProductRhythm, lastOrders, ordersSince, recommendations } from "@/lib/analytics/clientOrder";
import { clientProductPurchases } from "@/lib/assistant/facts/client-purchases";
import { kyivOffsetMs } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";
import type { PeriodSpec } from "@/lib/assistant/router";
import { orderStops, planDay } from "@/lib/assistant/facts/day-plan";
import {
  MAX_POINTS_PER_LINK,
  batchNavigateUrl,
  googleMapsLinksFromHere,
} from "@/lib/maps/google-links";
import { clientProfileFacts } from "@/lib/assistant/facts/client-profile";
import { findClients, type ClientHit } from "@/lib/assistant/facts/client-search";
import {
  deadStockItems,
  searchProducts,
  searchProductsTotals,
  substitutesFor,
} from "@/lib/assistant/facts/product-facts";
import { basketPairs, entryOffer, isConsumable, priceFloor } from "@/lib/assistant/facts/entry-offer";
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
import { clientsInCity } from "@/lib/assistant/facts/city-clients";
import { nearbyClients, POSITION_FRESH_HOURS } from "@/lib/assistant/facts/nearby";
import { clientPayments, repPayments } from "@/lib/assistant/facts/payments";
import { createReminder, listReminders } from "@/lib/assistant/facts/reminders";
import { parseWhen, whenLabel } from "@/lib/assistant/facts/when";
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
  points as pointsWord,
  productLink,
  times,
} from "@/lib/assistant/text";
import type { ToolContext } from "@/lib/assistant/types";


/* ── План дня ─────────────────────────────────────────────────────────── */

/**
 * План дня: кандидати з підставами плюс гачок для кожного з перших шести.
 *
 * Гачок беремо з ВЛАСНОГО ритму клієнта (один запит на клієнта), а не з
 * повного entry_offer: той рахує ще й причіп із аналізом кошика, і шість
 * таких на один план — це зайві секунди в дорозі.
 */
/**
 * «На який день планувати?»
 *
 * Питання, а не здогад: «сплануй мій день» о шостій вечора майже завжди
 * означає завтра, а зранку — сьогодні, і вгадана неправильно дата коштує
 * цілого виїзду. Кнопки дають найближчі чотири дні — далі вже не
 * планування, а мрії.
 */
export async function answerDayChoice(ctx: ToolContext): Promise<DirectAnswer> {
  const names = [...WEEKDAY_ACCUSATIVE];
  const choices: string[] = ["Сплануй день на сьогодні", "Сплануй день на завтра"];
  for (let i = 2; i <= 3; i++) {
    const day = shiftDay(ctx.today, i);
    const idx = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
    choices.push(`Сплануй день на ${names[idx]}`);
  }

  return {
    markdown: md([
      "## 📅 На який день планувати?",
      "",
      `Зараз ${planDayLabel(ctx.today, WEEKDAY_ACCUSATIVE[weekdayIndexOfDay(ctx.today)])}.`,
      "",
      followUps(...choices),
    ]),
    tools: [],
  };
}

/** Порядковий номер дня тижня для ISO-дати: понеділок — 0. */
function weekdayIndexOfDay(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * План дня — це маршрут в один бік, а не десятка боржників.
 *
 * Що змінилось проти першої версії й чому (вимога власника 05.09.2026):
 * список найтерміновіших точок по всій області виконати за день
 * неможливо, тож ним не користувалися. Тепер день — це НАПРЯМОК:
 * кандидати збиваються в купки, купка перевіряється на «чи є чим
 * торгувати», і лише потім вишиковується порядок обʼїзду.
 */
export async function answerDayPlan(ctx: ToolContext, day: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const plan = await timed(
    { name: "day_plan", label: "Складаю маршрут на день" },
    () => planDay(ctx.scope.repId, day),
    tools
  );

  const title = `## 📅 План на ${planDayLabel(day, WEEKDAY_ACCUSATIVE[weekdayIndex(plan.weekday)])}`;

  if (!plan.chosen) {
    return {
      markdown: md([
        title,
        "",
        "На цей день немає ні звичних клієнтів, ні термінових справ. Схоже, історії ще замало — спитайте про борги або про клієнтів, які давно не брали.",
      ]),
      tools,
    };
  }

  const chosen = plan.chosen;
  const order = plan.route?.order ?? chosen.stops;
  const hooks = await timed(
    { name: "entry_hooks", label: "Підбираю, з чим заходити" },
    () => hooksFor(order.slice(0, PLAN_HOOKS).map((c) => c.клієнт_id)),
    tools
  );

  /**
   * Підпис під точкою — це ПРИЧИНА ЇХАТИ, а не сума боргу.
   *
   * Борг звідси прибрано свідомо (вимога власника 05.09.2026): коли
   * кожен рядок починався з простроченої суми, план читався як обʼїзд
   * боржників. Гроші лишилися, але окремим блоком нижче — «по дорозі
   * можна забрати».
   */
  const noteFor = (c: {
    клієнт_id: string;
    борг: number;
    прострочено: number;
    дія: string | null;
    звичний_для_дня: boolean;
    днів_з_останньої: number | null;
  }) => {
    const parts: string[] = [];
    if (c.дія && !/борг|дебітор/i.test(c.дія)) parts.push(c.дія.toLowerCase());
    if (c.звичний_для_дня) parts.push("звичний для цього дня");
    if (c.днів_з_останньої != null) parts.push(`не брав ${days(c.днів_з_останньої)}`);

    const hook = hooks.get(c.клієнт_id);
    if (hook) parts.push(`🎁 ${short(hook.name, 34)} — ${money(hook.price)}`);
    if (parts.length === 0 && c.прострочено > 0) parts.push("заодно забрати гроші");

    return parts.join(" · ");
  };

  /** Гроші, які лежать по дорозі. Не привід їхати — привід не забути. */
  const onTheWay = [...(plan.route?.order ?? []), ...chosen.loose]
    .filter((c) => c.прострочено > 0)
    .sort((a, b) => b.прострочено - a.прострочено);

  const stopLine = (
    c: { клієнт_id: string; назва: string; борг: number; прострочено: number; дія: string | null; звичний_для_дня: boolean; днів_з_останньої: number | null },
    i: number
  ) => `${i + 1}. ${clientLink(c.клієнт_id, c.назва)} — ${noteFor(c)}`;

  const routeHead = plan.route?.km
    ? `🧭 **${chosen.name}** · ${plan.route.km} км, ~${hoursMinutes(plan.route.minutes ?? 0)} у дорозі`
    : `🧭 **${chosen.name}**`;

  const goodsRows = chosen.goods.map((g) => [
    productLink(short(g.name, 30), g.sku),
    `${g.clients} кл. · ${g.perOrder} шт`,
    g.short ? `🔴 ${g.free}` : `🟢 ${g.free}`,
  ]);

  const shortage = chosen.short.length
    ? [
        "",
        "### ⚠️ Чого бракує на цей напрямок",
        ...chosen.short.map((g) => `- 🔴 ${short(g.name, 40)} — ${arrivalHint(g)}`),
        /**
         * Коли замінити напрямок нічим, чесніше сказати про дірку, ніж
         * промовчати: торговий доїде й дізнається це від клієнта.
         */
        !plan.moved && chosen.short.length >= 2
          ? `Заміни такого ж розміру сьогодні немає, тож їхати варто — але саме ці позиції не обіцяйте. Коли підвезуть, поверніться сюди окремо.`
          : null,
      ]
    : [];

  const movedBlock = plan.moved
    ? [
        "",
        `### 🔁 ${plan.moved.direction.name} — краще пізніше`,
        `Там ${plan.moved.direction.stops.length + plan.moved.direction.loose.length} точок і ${money(plan.moved.direction.overdue)} простроченої, але ${plan.moved.reason}.`,
        ...plan.moved.direction.short.map((g) => `- ${short(g.name, 40)}: ${arrivalHint(g)}`),
      ]
    : [];

  const others = plan.directions.filter((d) => d.key !== chosen.key).slice(0, 4);

  return {
    markdown: md([
      title,
      routeHead,
      "",
      ...(plan.route?.order.length
        ? routePicker(
            `${chosen.name}${plan.route.km ? ` · ${plan.route.km} км` : ""}`,
            plan.route.order.map((c) => ({
              id: c.клієнт_id,
              name: c.назва,
              lat: c.lat,
              lng: c.lng,
              note: noteFor(c),
            })),
            plan.start
          )
        : chosen.loose.map(stopLine)),
      ...(plan.route?.order.length && chosen.loose.length
        ? [
            "",
            "_Ці клієнти теж на напрямку, але без точки на карті — у порядок не поставив:_",
            ...chosen.loose.map((c) => `- ${clientLink(c.клієнт_id, c.назва)}${c.прострочено > 0 ? ` — 🔴 ${money(c.прострочено)}` : ""}`),
          ]
        : []),
      "",
      ...(onTheWay.length
        ? [
            "",
            "### 💰 По дорозі можна забрати",
            "",
            ...table(
              ["Клієнт", "🔴 Прострочено", "Платник"],
              onTheWay
                .slice(0, 6)
                .map((c) => [
                  clientLink(c.клієнт_id, short(c.назва, 26)),
                  money(c.прострочено),
                  c.вердикт ? `${payerIcon(c.вердикт)} ${c.вердикт}` : "—",
                ])
            ),
            "",
            `_Разом на маршруті ${money(onTheWay.reduce((sum, c) => sum + c.прострочено, 0))}. Це не привід їхати саме туди — просто не забудьте, якщо будете поруч._`,
          ]
        : []),
      "",
      "### 📦 Чим торгувати на цьому напрямку",
      "",
      ...table(["Товар", "Беруть", "📦 Склад"], goodsRows),
      ...shortage,
      ...movedBlock,
      ...(others.length
        ? [
            "",
            "### 🧭 Інші напрямки",
            "",
            ...table(
              ["Напрямок", "📍 Точок", "🔴 Прострочено", "📦 Товар"],
              others.map((d) => [
                d.name,
                d.stops.length + d.loose.length,
                d.overdue > 0 ? money(d.overdue) : "—",
                d.short.length ? `🔴 бракує ${d.short.length}` : "🟢 є",
              ])
            ),
          ]
        : []),
      ...(plan.unplaced.length
        ? [
            "",
            "### 📍 Без адреси — тільки телефоном",
            "_Ці клієнти в маршрут не стають: у картці немає ні координат, ні міста в адресі._",
            ...plan.unplaced
              .slice(0, 6)
              .map(
                (c) =>
                  `- ${clientLink(c.клієнт_id, c.назва)}${
                    c.прострочено > 0 ? ` — 🔴 прострочено ${money(c.прострочено)}` : c.дія ? ` — ${c.дія.toLowerCase()}` : ""
                  }`
              ),
          ]
        : []),
      "",
      "_Ціни прайсові; нижче прайсу це пропозиція, знижку затверджує керівник. Порядок обʼїзду — OSRM, від вашої останньої точки треку._",
      "",
      followUps(
        "Кому з них дзвонити першому?",
        chosen.short.length ? "Коли буде дефіцитний товар?" : "З чим заходити до першого?",
        "Чи витягну план?"
      ),
    ]),
    tools,
  };
}

/**
 * Точки маршруту як блок, який кабінет малює списком із галочками.
 *
 * Помічник пропонує дев'ять точок, а торговий знає, що до двох сьогодні
 * не варто — і замість того, щоб переписувати питання, він вимикає рядок
 * дотиком, а посилання на навігацію перераховуються самі (RoutePicker).
 * У маркдауні це звичайний блок коду, тож історія й веб-версія від нього
 * не ламаються.
 */
function routePicker(
  title: string,
  stops: Array<{ id: string; name: string; lat: number; lng: number; note?: string }>,
  from?: { lat: number; lng: number } | null
): string[] {
  if (stops.length === 0) return [];
  // `from` — остання точка треку: без неї Google губить проміжні зупинки
  // (див. fromHereUrl у lib/maps/google-links.ts).
  return ["```budvik-route", JSON.stringify({ title, stops, from: from ?? null }), "```"];
}

/**
 * Кнопки навігації під маршрутом.
 *
 * Google приймає до десяти точок на посилання, тож довгий день ділиться
 * на частини — рівно так, як це вже зроблено у водіїв. Waze більше однієї
 * точки не приймає взагалі, тому веде до найближчої: далі торговий
 * відкриє наступну.
 *
 * Посилання зовнішні, і в застосунку вони працюють лише тому, що WebView
 * кабінету віддає адреси карт системі (див. cabinet.tsx). У браузері
 * відкриваються новою вкладкою.
 */
function navBlock(points: Array<{ lat: number; lng: number }>): string[] {
  if (points.length === 0) return [];

  const links = googleMapsLinksFromHere(points);
  const waze = batchNavigateUrl(points.slice(0, 1), "waze");

  const google =
    links.length <= 1
      ? [`- 🗺️ [Маршрут у Google Maps (${pointsWord(points.length)})](${links[0]?.url ?? ""})`]
      : links.map(
          (l, i) => `- 🗺️ [Google Maps, частина ${i + 1} (${pointsWord(l.points)})](${l.url})`
        );

  return [
    "",
    "### 🧭 Навігація",
    ...google,
    waze ? `- 🚗 [Перша точка у Waze](${waze})` : null,
    links.length > 1
      ? `_Google веде щонайбільше ${MAX_POINTS_PER_LINK} точок за раз — далі відкривайте наступну частину._`
      : null,
  ].filter((l): l is string => l !== null);
}

/** «1 год 6 хв» — години з хвилинами, а не «1.1 год». */
function hoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} год${m ? ` ${m} хв` : ""}` : `${m} хв`;
}

/** «останній прихід 01.09, зазвичай раз на 14 днів → орієнтовно 15.09». */
function arrivalHint(g: { free: number; lastArrival: Date | null; arrivalEveryDays: number | null }): string {
  if (!g.lastArrival) return `на складі ${g.free} — приходів за рік не було, поставку треба питати в закупівлі`;
  const last = ymd(g.lastArrival)!;
  if (!g.arrivalEveryDays) return `на складі ${g.free}, останній прихід ${last}`;
  const next = new Date(g.lastArrival.getTime() + g.arrivalEveryDays * 86_400_000);
  const wait = Math.round((next.getTime() - Date.now()) / 86_400_000);
  return `на складі ${g.free}, останній прихід ${last}, зазвичай раз на ${days(g.arrivalEveryDays)} → орієнтовно ${
    wait <= 0 ? "з дня на день" : `за ${days(wait)}`
  }`;
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
  const period = periodOf(ctx.today, { kind: "days", days: 30 });

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
        ? ctx.scope.company
          ? "_🟢 — цю позицію вже брали клієнти: з таких і починати._"
          : "_🟢 — цю позицію вже брали ваші клієнти: з таких і починати._"
        : ctx.scope.company
          ? "_Цього залишку ще ніхто не брав — починати варто з того, кому бренд знайомий._"
          : "_Цього залишку ваші клієнти ще не брали — починати варто з тих, кому бренд знайомий._",
      "",
      followUps("Кому з клієнтів це можна запропонувати?", "Яку ціну можна дати?"),
    ]),
    tools,
  };
}

/* ── Продажі за період ────────────────────────────────────────────────── */

export async function answerSales(ctx: ToolContext, spec: PeriodSpec): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  const s = await timed(
    { name: "sales_summary", label: "Рахую продажі за період" },
    () => repSalesSummary(ctx.scope.repId, period, { byBrand: true }),
    tools
  );

  const change = s.попередній_період?.зміна_суми_відсотків;
  const plan = s.план_місяця;

  return {
    markdown: md([
      `## 📈 Продажі ${period.label}`,
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
        : `_За попередній такий самий відрізок було ${money(s.попередній_період!.сума)}._`,
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
      periodChips("Скільки я продав"),
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

function askWhich(subject: string, hits: ClientHit[], company = false): string {
  return md([
    `## 🔎 Кілька збігів на «${subject}»`,
    "Про кого з них ідеться?",
    "",
    ...hits.map(
      (h) =>
        `- ${h.mine ? "⭐" : "🏪"} ${clientLink(h.id, h.name)}${h.address ? ` — ${h.address}` : ""}`
    ),
    "",
    // У розмові про фірму «ваш» немає: керівник ні за ким не закріплений.
    company ? "_⭐ — закріплений за торговим._" : "_⭐ — ваш клієнт._",
  ]);
}

const notFound = (subject: string) =>
  `Клієнта «${subject}» у базі не знайшли. Спробуйте коротший фрагмент назви, код ЄДРПОУ або прізвище контактної особи.`;

/** «З чим заходити до …» */
export async function answerEntryOffer(ctx: ToolContext, subject: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const found = await resolveClient(ctx, subject, tools);
  if ("none" in found) return { markdown: notFound(subject), tools };
  if ("ambiguous" in found) return { markdown: askWhich(subject, found.ambiguous, ctx.scope.company), tools };

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
  if ("ambiguous" in found) return { markdown: askWhich(subject, found.ambiguous, ctx.scope.company), tools };

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
  /**
   * Клієнта немає — можливо, питали про товар.
   *
   * «Що там з піною» шаблон читає як питання про клієнта, і чесна
   * відповідь «такого клієнта немає» тут — найгірша з можливих: людина
   * бачить, що її не зрозуміли, і більше так не питає.
   */
  if ("none" in found) {
    const asProduct = await searchProducts(subject, ctx.scope.repId, 1);
    if (asProduct.length > 0) return answerProduct(ctx, subject);
    return { markdown: notFound(subject), tools };
  }
  if ("ambiguous" in found) return { markdown: askWhich(subject, found.ambiguous, ctx.scope.company), tools };

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

/* ── Остання накладна й «чи брав він…» ────────────────────────────────── */

/**
 * «Покажи останню накладну Кунанця».
 *
 * Двічі за тестування це питання йшло в модель по 17 тисяч токенів — і
 * то заради переказу трьох рядків документа, які код віддає за секунду.
 */
export async function answerLastOrder(ctx: ToolContext, subject: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const found = await resolveClient(ctx, subject, tools);
  if ("none" in found) return { markdown: notFound(subject), tools };
  if ("ambiguous" in found) return { markdown: askWhich(subject, found.ambiguous, ctx.scope.company), tools };

  const client = found.hit;
  const orders = await timed(
    { name: "last_orders", label: "Дивлюся останні документи" },
    () => lastOrders(client.id, { since: ordersSince(12), limit: 3 }),
    tools
  );

  if (orders.length === 0) {
    return {
      markdown: md([
        `## 🧾 ${clientLink(client.id, client.name)}`,
        "",
        "За рік жодного документа — цей клієнт у нас ще нічого не брав.",
        "",
        followUps("Що йому запропонувати?", "З чим сюди заходити?"),
      ]),
      tools,
    };
  }

  const last = orders[0];
  const earlier = orders.slice(1);

  return {
    markdown: md([
      `## 🧾 ${last.docType === "RETURN" ? "Останнє повернення" : "Остання накладна"} · ${clientLink(client.id, client.name)}`,
      "",
      ...table(
        ["№", "📅 Дата", "💰 Сума"],
        [[last.number, `${last.createdAt.slice(0, 10)} (${days(last.daysAgo)} тому)`, money(last.totalAmount)]]
      ),
      "",
      ...table(
        ["Товар", "Кіл.", "💵 Ціна", "Сума"],
        last.items
          .slice(0, 12)
          .map((i) => [
            productLink(short(i.name, 30), i.sku),
            Math.round(i.quantity * 100) / 100,
            money(i.sellingPrice),
            money(i.amount),
          ])
      ),
      last.items.length > 12 ? `_…і ще ${items(last.items.length - 12)}._` : "",
      ...(earlier.length
        ? [
            "",
            "### 📚 Попередні",
            ...earlier.map(
              (o) =>
                `- ${o.docType === "RETURN" ? "↩️" : "🧾"} ${o.number} · ${o.createdAt.slice(0, 10)} · ${money(o.totalAmount)}`
            ),
          ]
        : []),
      "",
      followUps("Що йому запропонувати?", "Скільки він винен?", "З чим сюди заходити?"),
    ]),
    tools,
  };
}

/**
 * «Чи брав Налисник піну і коли».
 *
 * Питання про ПЕРЕТИН клієнта й товару, і саме воно найдорожче йшло в
 * модель: п'ять ходів по 12–24 тисячі токенів за одну відповідь. Дані
 * ті самі, що й у картці з фільтром товару, — просто тепер їх дістає код.
 */
export async function answerClientProduct(
  ctx: ToolContext,
  subject: string,
  product: string
): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const found = await resolveClient(ctx, subject, tools);
  if ("none" in found) return { markdown: notFound(subject), tools };
  if ("ambiguous" in found) return { markdown: askWhich(subject, found.ambiguous, ctx.scope.company), tools };

  const client = found.hit;
  const facts = await timed(
    { name: "client_purchases", label: "Дивлюся закупівлі клієнта" },
    () => clientProductPurchases(client.id, product),
    tools
  );

  if (!facts.брав) {
    return {
      markdown: md([
        `## 📦 ${clientLink(client.id, client.name)} · ${product}`,
        "",
        `Такого товару в накладних цього клієнта немає — жодного разу за всю історію.`,
        "",
        followUps(`Хто ще бере ${product}?`, "Що він бере зазвичай?"),
      ]),
      tools,
    };
  }

  return {
    markdown: md([
      `## 📦 ${clientLink(client.id, client.name)} · ${product}`,
      "",
      ...table(
        ["🧾 Разів", "📦 Кількість", "💰 Сума", "📅 Останній раз"],
        [[
          facts.разом!.документів,
          facts.разом!.кількість,
          money(facts.разом!.сума),
          facts.разом!.останній_раз ?? "—",
        ]]
      ),
      "",
      ...table(
        ["📅 Дата", "Товар", "Кіл.", "💵 Ціна"],
        (facts.рядки ?? [])
          .slice(0, 8)
          .map((r) => [
            r.дата ?? "—",
            productLink(short(r.назва, 28), r.артикул),
            `${r.кількість}${r.вид === "повернення" ? " ↩️" : ""}`,
            money(r.ціна),
          ])
      ),
      "",
      followUps("Пора повторити?", "Скільки цього на складі?", "З чим сюди заходити?"),
    ]),
    tools,
  };
}

/** «Що ти вмієш» — коротка карта можливостей, без моделі. */
export async function answerHelp(ctx: ToolContext): Promise<DirectAnswer> {
  if (ctx.kind === "ADMIN") {
    return {
      markdown: md([
        "## 🤖 Що я вмію",
        "",
        "- 🧑‍💼 **Команда** — оборот, місця, динаміка, план і прогноз по кожному торговому",
        "- 💰 **Дебіторка фірми** — скільки винні, скільки прострочено, найбільші боржники",
        "- 📍 **Хто де зараз** — відкриті зміни, сигнал планшета, пробіг, замовлення за день",
        "- 🚗 **Зміни** — кілометри, пальне, підозрілі одометри, автозакриття",
        "- 🚚 **Водії** — маршрути на день, листи, зарплата, ефективність",
        "- 🛒 **Замовлення з сайту** — що чекає обробки й скільки вже висить",
        "- 📦 **Склад** — дефіцит, оборотність, мертвий запас",
        "- 🔄 **Обмін із 1С** — чи живий агент, свіжість каналів, розбіжності",
        "- 🏪 **Клієнт і товар** — картка, борг, історія, залишок по всій базі",
        "- ⏰ **Нагадування** — «нагадай завтра о 10 подивитись дебіторку»",
        "",
        "_План дня чи маршрут конкретного торгового — це розмова «як торговий»: створіть нову й оберіть людину._",
        "",
        followUps("Хто де зараз", "Продажі по торгових", "Дебіторка фірми"),
      ]),
      tools: [],
    };
  }

  if (ctx.kind === "WAREHOUSE") {
    return {
      markdown: md([
        "## 🤖 Що я вмію",
        "",
        "- 🚚 **Водії** — де зараз, що везе, за якими накладними, скільки відмічено",
        "- 📦 **Збірка** — які замовлення пакувати, кому й на скільки",
        "- 🧾 **Мої накладні** — що здав за день і що не прочиталося",
        "- 🔧 **Товар** — залишок і на якому складі лежить",
        "- 🏪 **Клієнт** — картка, адреса, телефон, борг",
        "- ⏰ **Нагадування** — «нагадай о 16 віддати накладні в офіс»",
        "",
        "_Продажів, планів і заробітку я не бачу: на склад їх не оформлюють._",
        "",
        followUps("Де зараз водії", "Що сьогодні пакувати", "Які накладні я здав"),
      ]),
      tools: [],
    };
  }

  const driver = ctx.kind === "DRIVER";
  return {
    markdown: md(
      driver
        ? [
            "## 🤖 Що я вмію",
            "",
            "- 🚚 **Маршрут на день** — точки, гроші до забору, примітки логіста",
            "- 💰 **Каса** — скільки зібрано, здано й лишилось на руках",
            "- 🏪 **Клієнт** — адреса, телефон, борг, що про нього знаємо",
            "- 📦 **Товар** — чи є на складі й почім",
            "- ⏰ **Нагадування** — «нагадай завтра о 9 заїхати на склад»",
            "",
            followUps("Що в мене сьогодні на маршруті", "Скільки в касі"),
          ]
        : [
            "## 🤖 Що я вмію",
            "",
            "- 📅 **План дня** — маршрут в один бік, з тим, чим торгувати",
            "- 🧭 **Маршрут за списком** — «побудуй маршрут: Кунанець, Левкович»",
            "- 📍 **Хто поруч** — кого захопити, поки ви в цьому районі",
            "- 💰 **Борги й оплати** — хто винен, хто заплатив, скільки зібрано",
            "- 🏆 **Табло команди** і 🔮 **прогноз місяця**",
            "- 🏪 **Клієнт** — картка, остання накладна, чи брав конкретний товар",
            "- 📦 **Товар** — залишок, ціна, чим замінити, що беруть разом",
            "- 🎁 **З чим заходити** — гачок і причіп під конкретного клієнта",
            "- ⏰ **Нагадування** — «нагадай у пʼятницю про борг Кунанця»",
            "",
            "_Складніше — «чи давати відстрочку», «чому впав оборот» — теж питайте: там я думаю, а не показую готове._",
            "",
            followUps("Сплануй мій день", "Хто мені винен", "Як я на фоні команди"),
          ]
    ),
    tools: [],
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
    /**
     * Не товар — може, клієнт.
     *
     * «Що там з піною» і «що там з Кунанцем» — та сама фраза, і розділити
     * їх наперед неможливо. Тому замість «не знайшли» пробуємо другий
     * довідник: людина питала про щось конкретне, а не про наш поділ на
     * товари й контрагентів.
     */
    const asClient = await findClients(query, ctx.scope.repId, { limit: 2 });
    if (asClient.length > 0) return answerClientCard(ctx, query);

    return {
      markdown: md([
        `## 📦 ${query}`,
        "",
        "Ні товару, ні клієнта з такою назвою не знайшли. Спробуйте артикул або одне точне слово з назви.",
      ]),
      tools,
    };
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

/* ── Що беруть разом і чим замінити ───────────────────────────────────── */

/** Спільний початок: знайти товар, про який питають. */
async function resolveProduct(ctx: ToolContext, query: string, tools: DirectAnswer["tools"]) {
  const hits = await timed(
    { name: "product_search", label: "Шукаю товар" },
    () => searchProducts(query, ctx.scope.repId, 3),
    tools
  );
  return hits[0] ?? null;
}

/**
 * «Що докласти до кругів».
 *
 * Пари беруться з накладних (той самий запит, що й для причепа в «з чим
 * заходити»), тож це не здогад про сумісність, а те, що люди справді
 * кладуть в один документ.
 */
export async function answerBasket(ctx: ToolContext, query: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const target = await resolveProduct(ctx, query, tools);
  if (!target) {
    return { markdown: `Товару «${query}» не знайшли. Спробуйте артикул або одне точне слово з назви.`, tools };
  }

  const pairs = await timed(
    { name: "basket_pairs", label: "Дивлюся, що беруть разом" },
    () => basketPairs([target.productId]),
    tools
  );

  if (pairs.length === 0) {
    return {
      markdown: md([
        `## 🧺 Що беруть разом із ${productLink(target.name, target.sku)}`,
        "",
        "Стійких пар у накладних немає: цей товар беруть поодинці або замало разів, щоб робити висновок.",
      ]),
      tools,
    };
  }

  const ids = pairs.map((p) => p.attach);
  const info = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, sku: true, price: true },
  });
  const byId = new Map(info.map((p) => [p.id, p]));

  const rows = pairs
    .map((p) => ({
      pair: p,
      product: byId.get(p.attach),
      // Частка накладних із гачком, у яких лежало й це.
      share: p.hookDocs > 0 ? (p.together / p.hookDocs) * 100 : 0,
    }))
    .filter((r) => r.product)
    .sort((a, b) => b.share - a.share)
    .slice(0, 8);

  return {
    markdown: md([
      `## 🧺 Що беруть разом із ${productLink(target.name, target.sku)}`,
      "",
      ...table(
        ["Товар", "🤝 Разом", "💵 Ціна"],
        rows.map((r) => [
          productLink(short(r.product!.name, 30), r.product!.sku),
          `${Math.round(r.share)} % (${r.pair.together})`,
          money(r.product!.price ?? 0),
        ])
      ),
      "",
      "_«Разом» — у якій частці накладних із цим товаром лежало й те. Рахується по всій компанії за пів року._",
      "",
      followUps(
        "Кому з моїх це можна допродати?",
        target.sku ? `Скільки ${target.sku} на складі?` : null
      ),
    ]),
    tools,
  };
}

/**
 * «Пін немає — чим замінити».
 *
 * Показуємо лише те, що є на складі: заміна, якої теж немає, — це не
 * відповідь, а друга відмова тому самому клієнтові.
 */
export async function answerSubstitute(ctx: ToolContext, query: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const target = await resolveProduct(ctx, query, tools);
  if (!target) {
    return { markdown: `Товару «${query}» не знайшли. Спробуйте артикул або одне точне слово з назви.`, tools };
  }

  const { options } = await timed(
    { name: "substitutes", label: "Підбираю заміну" },
    () => substitutesFor(target.productId, ctx.scope.repId),
    tools
  );

  if (options.length === 0) {
    return {
      markdown: md([
        `## 🔄 Чим замінити ${productLink(target.name, target.sku)}`,
        "",
        target.free > 0
          ? `Заміни в тому самому розділі з вільним залишком немає. Але сам товар є: **${target.free} шт**.`
          : "Заміни в тому самому розділі з вільним залишком немає.",
      ]),
      tools,
    };
  }

  return {
    markdown: md([
      `## 🔄 Чим замінити ${productLink(target.name, target.sku)}`,
      target.free > 0
        ? `_Сам товар ще є: **${target.free} шт** по ${money(target.price)}._`
        : "_Вільного залишку немає — ось що можна відвантажити натомість._",
      "",
      ...table(
        ["Заміна", "📦 Шт", "💵 Ціна", "👥 Мої"],
        options.map((o) => [
          productLink(short(o.name, 30), o.sku),
          o.free,
          money(o.price),
          o.myBuyers > 0 ? `${o.myBuyers} 🟢` : "—",
        ])
      ),
      "",
      "_Заміна шукається в тому самому розділі й типі каталогу. 🟢 — цю позицію вже беруть ваші клієнти._",
      "",
      followUps("Що беруть разом із цим?", "Кому це можна запропонувати?"),
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
export async function answerReturns(ctx: ToolContext, spec: PeriodSpec): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  const [facts, repeated] = await Promise.all([
    timed({ name: "returns", label: "Розбираю повернення" }, () => returnsFacts(ctx.scope.repId, period), tools),
    repeatedReturns(ctx.scope.repId, period, 5),
  ]);

  if (facts.docs === 0) {
    return {
      markdown: `${capitalize(period.label)} — жодного повернення. По команді середня частка ${percent(facts.teamShare)} від валу.`,
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
      `## ↩️ Повернення ${period.label}`,
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
      periodChips("Скільки в мене повернень"),
      "",
      followUps("Чому вони повертають?", "Як це б'є по моїй маржі?"),
    ]),
    tools,
  };
}

/* ── Маршрут за списком клієнтів ──────────────────────────────────────── */

/** Один клієнт зі списку збігів: свій із документами має перевагу. */
function pickOne(hits: ClientHit[]): ClientHit | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  const mine = hits.filter((h) => h.mine && h.lastDocAt);
  if (mine.length >= 1) return mine[0];
  const withDocs = hits.filter((h) => h.lastDocAt);
  return withDocs.length >= 1 ? withDocs[0] : null;
}

/**
 * «Побудуй маршрут: Кунанець, Левкович, Склад».
 *
 * Торговий часто вже знає, куди їде, — план дня йому потрібен не завжди.
 * Тоді від помічника треба одне: поставити названих у логічний порядок і
 * дати посилання, з якого починається навігація.
 *
 * Кожне ім'я шукається окремо, і неоднозначні НЕ зупиняють роботу:
 * маршрут будується з тих, кого впізнали, а решта перелічується внизу.
 * Зупиняти людину списком однофамільців посеред збору маршруту — це
 * змусити її повторювати весь перелік заново.
 */
export async function answerRouteTo(ctx: ToolContext, names: string[]): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const found = await timed(
    { name: "search_clients", label: "Шукаю клієнтів маршруту" },
    async () =>
      Promise.all(
        names.map(async (name) => ({
          name,
          /**
           * Беремо ОДНОГО, а не питаємо.
           *
           * Правила ті самі, що й у решті пошуку: свій клієнт із
           * документами перемагає однофамільця з чужого портфеля. Інакше
           * «побудуй маршрут: Левкович, Скуратов, Склад» зупинялося б на
           * другому імені, і торговому довелося б диктувати список знову.
           */
          hit: pickOne(await findClients(name, ctx.scope.repId, { limit: 4 })),
        }))
      ),
    tools
  );

  const picked: Array<{ id: string; name: string; lat: number; lng: number }> = [];
  const unclear: string[] = [];
  const noPin: string[] = [];

  const ids = found.filter((f) => f.hit).map((f) => f.hit!.id);
  const geo = ids.length
    ? await prisma.counterparty.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, deliveryLat: true, deliveryLng: true },
      })
    : [];
  const geoById = new Map(geo.map((g) => [g.id, g]));

  for (const f of found) {
    if (!f.hit) {
      unclear.push(f.name);
      continue;
    }
    const g = geoById.get(f.hit.id);
    if (g?.deliveryLat == null || g.deliveryLng == null) {
      noPin.push(f.hit.name);
      continue;
    }
    picked.push({ id: g.id, name: g.name, lat: g.deliveryLat, lng: g.deliveryLng });
  }

  if (picked.length === 0) {
    return {
      markdown: md([
        "## 🧭 Маршрут",
        "",
        "Жодного з названих клієнтів не вдалося поставити на карту: або не знайшли, або в картці немає координат.",
        unclear.length ? `_Не впізнав: ${unclear.join(", ")}._` : null,
        noPin.length ? `_Без точки на карті: ${noPin.join(", ")}._` : null,
      ]),
      tools,
    };
  }

  const start = await prisma.trackPoint.findFirst({
    where: { userId: ctx.scope.repId },
    orderBy: { recordedAt: "desc" },
    select: { lat: true, lng: true },
  });

  const route = await timed(
    { name: "route_order", label: "Шикую порядок обʼїзду" },
    () => orderStops(picked, start),
    tools
  );
  const order = route?.order ?? picked;

  return {
    markdown: md([
      "## 🧭 Маршрут",
      route?.km
        ? `${pointsWord(order.length)} · ${route.km} км · ~${hoursMinutes(route.minutes ?? 0)} у дорозі`
        : pointsWord(order.length),
      "",
      ...routePicker(
        "Маршрут",
        order.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng })),
        start
      ),
      noPin.length ? `\n_Без точки на карті, у порядок не стали: ${noPin.join(", ")}._` : null,
      unclear.length ? `_Не впізнав: ${unclear.join(", ")} — скажіть точніше._` : null,
      "",
      route?.source === "osrm"
        ? "_Порядок — OSRM, від вашої останньої точки треку._"
        : "_Порядок за відстанню: дорогу порахувати не вдалося._",
      "",
      followUps("З чим заходити до першого?", "Хто з них винен?"),
    ]),
    tools,
  };
}

/* ── Нагадування ──────────────────────────────────────────────────────── */

/** Слова, з яких починається прохання; у самому нагадуванні вони зайві. */
const REMIND_TRIGGER = /^(нагадай|нагадати|нагадуй|постав(ити)?\s+нагадування|не\s+дай\s+забути)\s*(мені\s*)?/i;

/**
 * Прибирає з тексту сам час.
 *
 * «Нагадай завтра о 9 подзвонити Левковичу» — у пуш має піти «подзвонити
 * Левковичу», бо час у сповіщенні вже видно з того, що воно прийшло. Двома
 * проходами, бо дата й година стоять поруч: «завтра о 9».
 */
function stripWhenWords(raw: string): string {
  let text = raw;
  for (let i = 0; i < 2; i++) {
    text = text
      .replace(/^(сьогодні|завтра|післязавтра)\s+/i, "")
      .replace(/^(у|в)\s+(понеділок|вівторок|середу|четвер|п.?ятницю|суботу|неділю)\s+/i, "")
      .replace(/^через\s+(\d{1,2}\s*)?(дн[а-яіїєґ]*|день|тиждень|тижні|місяць)\s*/i, "")
      .replace(/^\d{1,2}[.\/]\d{1,2}(?:[.\/]\d{4})?\s*/, "")
      .replace(/^(о|об)\s*\d{1,2}([:.]\d{2})?\s*(вечора|ранку|дня)?\s*/i, "")
      .trim();
  }
  return text;
}

/**
 * «Нагадай у пʼятницю про борг Кунанця».
 *
 * Єдина, крім пам'яті клієнта, відповідь, яка ЩОСЬ ЗАПИСУЄ — і записує
 * вона рядок у власну таблицю, не чіпаючи ні цін, ні залишків, ні
 * документів. Дату розбирає код (facts/when.ts); коли не розбирає —
 * чесно перепитує, бо нагадування без часу не нагадає ніколи.
 */
export async function answerRemind(ctx: ToolContext, raw: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const body = raw.replace(REMIND_TRIGGER, "").trim();

  const when = parseWhen(raw, ctx.today);
  if (!when) {
    return {
      markdown: md([
        "## ⏰ Коли нагадати?",
        "",
        "Скажіть час — «завтра», «у пʼятницю», «через тиждень», «12.09 о 14:00» — і я поставлю.",
        "",
        followUps("Нагадай завтра о 9", "Нагадай у понеділок"),
      ]),
      tools,
    };
  }

  /**
   * Клієнт у тексті — необовʼязковий, і питати про нього ми не будемо.
   *
   * «Нагадай у пʼятницю про борг Кунанця» краще поставити без привʼязки,
   * ніж зупинити людину списком однофамільців: нагадування має спрацювати,
   * а картку вона відкриє сама.
   */
  /**
   * Клієнт у тексті — необовʼязковий, і питати про нього ми не будемо.
   *
   * «Нагадай у пʼятницю про борг Кунанця» краще поставити без привʼязки,
   * ніж зупинити людину списком однофамільців: нагадування має спрацювати,
   * а картку вона відкриє сама. Тому пробуємо два шляхи й беремо лише
   * однозначне влучання.
   */
  const guesses: string[] = [];
  const afterPro = /(?:про|щодо)\s+(.{3,40})$/i.exec(body)?.[1]?.trim();
  if (afterPro) guesses.push(afterPro);
  // Прізвище в тексті пишуть з великої: «подзвонити Левковичу».
  for (const w of body.match(/[А-ЯІЇЄҐ][а-яіїєґ'ʼ-]{3,}/g) ?? []) guesses.push(w);

  let counterpartyId: string | null = null;
  let clientName: string | null = null;
  for (const guess of guesses.slice(0, 4)) {
    const hits = await findClients(guess, ctx.scope.repId, { limit: 2 });
    if (hits.length === 1) {
      counterpartyId = hits[0].id;
      clientName = hits[0].name;
      break;
    }
  }

  const text = stripWhenWords(body) || body;

  const saved = await timed(
    { name: "remind_me", label: "Ставлю нагадування" },
    () => createReminder({ userId: ctx.scope.repId, text, dueAt: when.at, counterpartyId }),
    tools
  );

  return {
    markdown: md([
      "## ⏰ Нагадаю",
      "",
      ...table(
        ["🕒 Коли", "📝 Про що", "🏪 Клієнт"],
        [[whenLabel(when, ctx.today), short(saved.text, 40), clientName ? short(clientName, 24) : "—"]]
      ),
      "",
      "_Пуш прийде на телефон. Список — питанням «мої нагадування»._",
      "",
      followUps("Мої нагадування", clientName ? `Скільки винен ${clientName}?` : null),
    ]),
    tools,
  };
}

/** «Мої нагадування», «що я маю зробити». */
export async function answerReminders(ctx: ToolContext): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const list = await timed(
    { name: "reminders", label: "Дивлюся нагадування" },
    () => listReminders(ctx.scope.repId),
    tools
  );

  if (list.length === 0) {
    return {
      markdown: md([
        "## ⏰ Нагадування",
        "",
        "Порожньо. Скажіть «нагадай завтра зателефонувати Кунанцю» — і поставлю.",
      ]),
      tools,
    };
  }

  const now = Date.now();
  return {
    markdown: md([
      "## ⏰ Мої нагадування",
      "",
      ...table(
        ["🕒 Коли", "📝 Про що", "🏪 Клієнт"],
        list.map((r) => [
          `${r.dueAt.getTime() < now ? "🔴" : "🟢"} ${ymdHm(r.dueAt)}`,
          short(r.text, 34),
          r.counterpartyId && r.clientName
            ? clientLink(r.counterpartyId, short(r.clientName, 20))
            : "—",
        ])
      ),
      "",
      "_🔴 — час уже минув. Пуш приходить у вказану годину._",
      "",
      followUps("Нагадай завтра о 9", "Хто мені винен?"),
    ]),
    tools,
  };
}

/** «05.09 о 9:00» київським часом. */
function ymdHm(at: Date): string {
  const local = new Date(at.getTime() + kyivOffsetMs(at));
  const d = String(local.getUTCDate()).padStart(2, "0");
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const h = local.getUTCHours();
  const min = String(local.getUTCMinutes()).padStart(2, "0");
  return `${d}.${m} ${h}:${min}`;
}

/* ── Клієнти в місті ──────────────────────────────────────────────────── */

/**
 * «Кого можна розпрацювати в Сокільниках».
 *
 * Показуємо ВСЮ базу міста, а не портфель (вимога власника 07.09.2026).
 * Питання про можливості, а не про свій список: половина потенціалу —
 * саме в магазинах, які веде хтось інший або не веде ніхто, і відповідь
 * «ось ваші троє» не додає до знань торгового нічого.
 *
 * Групи важливіші за сортування: «беруть», «сплять» і «ніколи не брали» —
 * це три різні розмови біля дверей, і змішувати їх в один список
 * означає змусити людину сортувати самотужки.
 */
export async function answerCityClients(ctx: ToolContext, city: string): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const facts = await timed(
    { name: "city_clients", label: "Шукаю клієнтів у місті" },
    () => clientsInCity(city, ctx.scope.repId),
    tools
  );

  if (facts.counts.total === 0) {
    return {
      markdown: md([
        `## 🏘️ ${city}`,
        "",
        "Жодного клієнта з такою адресою чи назвою в базі немає. Спробуйте коротшу назву — «Сокільник», «Стрий».",
      ]),
      tools,
    };
  }

  const line = (c: (typeof facts.clients)[number]) => {
    const bits: string[] = [];
    if (c.revenue > 0) bits.push(`${money(c.revenue)} за пів року`);
    if (c.daysSinceLast != null) bits.push(`не брав ${days(c.daysSinceLast)}`);
    if (c.overdue > 0) bits.push(`🔴 прострочено ${money(c.overdue)}`);
    else if (c.debt > 0) bits.push(`🟡 борг ${money(c.debt)}`);
    if (!c.hasPin) bits.push("📍 немає на карті");
    return `- ${c.mine ? "⭐" : "🏪"} ${clientLink(c.id, c.name)}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
  };

  const group = (kind: "active" | "asleep" | "never") =>
    facts.clients.filter((c) => c.group === kind);

  const active = group("active");
  const asleep = group("asleep");
  const never = group("never");

  return {
    markdown: md([
      `## 🏘️ Клієнти в «${city}»`,
      "",
      ...table(
        ["👥 Усього", "🟢 Беруть", "😴 Сплять", "🆕 Не брали", "⭐ Ваші"],
        [[facts.counts.total, facts.counts.active, facts.counts.asleep, facts.counts.never, facts.counts.mine]]
      ),
      ...(active.length ? ["", "### 🟢 Беруть зараз", ...active.slice(0, 10).map(line)] : []),
      ...(asleep.length
        ? [
            "",
            "### 😴 Сплять — сюди й заходити",
            "_Брали раніше, зупинилися. Найтепліший привід для розмови._",
            ...asleep.slice(0, 10).map(line),
          ]
        : []),
      ...(never.length
        ? [
            "",
            "### 🆕 Ще нічого не брали",
            ...never.slice(0, 8).map(line),
          ]
        : []),
      "",
      ctx.scope.company
        ? "_Показую всіх клієнтів бази в цьому місті. ⭐ — закріплений за торговим, 🏪 — не веде ніхто._"
        : "_Показую ВСІХ клієнтів бази в цьому місті, не лише ваших: ⭐ — ваш, 🏪 — веде хтось інший або ніхто._",
      "",
      followUps(
        asleep.length ? `З чим заходити до ${keyWord(asleep[0].name)}?` : null,
        "Хто поруч?",
        `Побудуй маршрут по ${city}`
      ),
    ]),
    tools,
  };
}

/**
 * Слово, за яким клієнта знайдуть удруге.
 *
 * У кнопку не можна класти обрізане «ФОП Мірошкіна Евеліна…»: натиснувши
 * її, людина надішле питання з трьома крапками, і пошук нічого не
 * знайде. Беремо перше значуще слово — саме воно й прізвище.
 */
function keyWord(name: string): string {
  const words = name.split(/[\s(,]+/).filter((w) => w.length >= 4 && !/^(ФОП|ТОВ|ПП|ТзОВ|магазин)$/i.test(w));
  return words[0] ?? name.slice(0, 20);
}

/* ── Хто поруч ────────────────────────────────────────────────────────── */

/**
 * «Я вже тут — до кого заскочити».
 *
 * Позиція береться з треку (див. facts/nearby.ts), і її вік показуємо
 * завжди: «поруч» від точки годинної давності — це вже не поруч, і
 * торговий має бачити, від чого рахували.
 */
export async function answerNearby(ctx: ToolContext, radiusKm: number | null): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];

  const found = await timed(
    { name: "nearby_clients", label: "Дивлюся, хто поруч" },
    () => nearbyClients(ctx.scope.repId, radiusKm ? { radiusKm } : {}),
    tools
  );

  if (!found.position) {
    return {
      markdown: md([
        "## 📍 Хто поруч",
        "",
        "Не знаю, де ви: трек не пише жодної точки. Увімкніть застосунок і зміну — і питання запрацює.",
      ]),
      tools,
    };
  }

  const age =
    found.position.ageMinutes < 60
      ? `${found.position.ageMinutes} хв тому`
      : `${Math.round(found.position.ageMinutes / 60)} год тому`;

  if (found.clients.length === 0) {
    return {
      markdown: md([
        "## 📍 Хто поруч",
        "",
        `У радіусі ${found.radiusKm} км від вашої останньої точки (${age}) клієнтів із координатами немає.`,
        "",
        "_Точка на карті є не в кожного клієнта — у картці її ставить менеджер або торговий._",
      ]),
      tools,
    };
  }

  const rows = found.clients.map((c) => {
    const bits: string[] = [];
    if (c.overdue > 0) bits.push(`🔴 прострочено ${money(c.overdue)}`);
    else if (c.debt > 0) bits.push(`🟡 борг ${money(c.debt)}`);
    if (c.daysSinceLast != null) bits.push(`не брав ${days(c.daysSinceLast)}`);
    else bits.push("покупок не було");
    return `- **${c.km} км** ${c.mine ? "⭐" : "🏪"} ${clientLink(c.id, c.name)} — ${bits.join(" · ")}`;
  });

  return {
    markdown: md([
      "## 📍 Хто поруч",
      "",
      ...table(
        ["🛰️ Позиція", "📏 Радіус", "👥 Знайдено"],
        [[`${found.position.fresh ? "🟢" : "🟡"} ${age}`, `${found.radiusKm} км`, found.clients.length]]
      ),
      found.position.fresh
        ? ""
        : `_Точка старша за ${POSITION_FRESH_HOURS} год — ви могли вже поїхати далі._`,
      "",
      ...rows,
      "",
      "_⭐ ваш клієнт · відстань по прямій, дорогою вийде більше._",
      "",
      followUps("З чим до найближчого заходити?", "Хто з них винен найбільше?"),
    ]),
    tools,
  };
}

/* ── Оплати ───────────────────────────────────────────────────────────── */

/**
 * «Хто заплатив» і «чи заплатив такий-то».
 *
 * Борг у нас падає через регістр 1С, а не через оплату, тож по сальдо цю
 * відповідь не скласти: воно просто стане меншим невідомо коли. Тут же
 * рядки рознесених оплат — з датою й сумою.
 */
export async function answerPayments(
  ctx: ToolContext,
  spec: PeriodSpec,
  subject: string | null
): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  if (subject) {
    const found = await resolveClient(ctx, subject, tools);
    if ("none" in found) return { markdown: notFound(subject), tools };
    if ("ambiguous" in found) return { markdown: askWhich(subject, found.ambiguous, ctx.scope.company), tools };

    const client = found.hit;
    // Питання «чи заплатив» майже завжди про «останнім часом», а не про
    // вибраний період: беремо ширше вікно, щоб не відповідати «немає» на
    // оплату двотижневої давнини.
    const wide = periodOf(ctx.today, { kind: "days", days: 60 });
    const list = await timed(
      { name: "client_payments", label: "Дивлюся оплати клієнта" },
      () => clientPayments(client.id, wide),
      tools
    );

    if (list.length === 0) {
      return {
        markdown: md([
          `## 💵 Оплати · ${clientLink(client.id, client.name)}`,
          "",
          `За останні 60 днів жодної оплати від цього клієнта не бачимо.`,
          "",
          followUps("Скільки він винен?", "Як говорити про борг?"),
        ]),
        tools,
      };
    }

    return {
      markdown: md([
        `## 💵 Оплати · ${clientLink(client.id, client.name)}`,
        "",
        ...table(
          ["📅 Дата", "💰 Сума", "Спосіб"],
          list.map((p) => [p.дата, money(p.сума), p.спосіб ?? "—"])
        ),
        "",
        `_Разом за останні 60 днів: **${money(list.reduce((sum, p) => sum + p.сума, 0))}**._`,
        "",
        followUps("Скільки він ще винен?", "З чим до нього заходити?"),
      ]),
      tools,
    };
  }

  const facts = await timed(
    { name: "payments", label: "Дивлюся оплати" },
    () => repPayments(ctx.scope.repId, period),
    tools
  );

  if (facts.оплат === 0) {
    return {
      markdown: md([
        `## 💵 Оплати ${period.label}`,
        "",
        "Жодної оплати за цей період на вас не рознесено.",
        "",
        followUps("Хто мені винен?", "Кому дзвонити першому?"),
      ]),
      tools,
    };
  }

  return {
    markdown: md([
      `## 💵 Оплати ${period.label}`,
      "",
      ...table(
        ["💰 Разом", "🧾 Оплат", "👥 Клієнтів"],
        [[`**${money(facts.сума)}**`, facts.оплат, facts.клієнтів]]
      ),
      "",
      "### 👤 Від кого",
      ...facts.по_клієнтах
        .slice(0, 10)
        .map((c) =>
          c.клієнт_id
            ? `- 💵 ${clientLink(c.клієнт_id, c.назва)} — **${money(c.сума)}** (${c.оплат})`
            : `- 💵 ${c.назва} — **${money(c.сума)}** (${c.оплат})`
        ),
      "",
      "### 📅 Останні",
      "",
      ...table(
        ["Дата", "Клієнт", "💰 Сума"],
        facts.останні.slice(0, 8).map((p) => [p.дата, short(p.назва, 26), money(p.сума)])
      ),
      "",
      "_Оплата рознесена на торгового за накладною; борг у 1С падає окремо, регістром._",
      "",
      followUps("Хто ще винен?", "Чи витягну план?", "Як я на фоні команди?"),
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
export async function answerBenchmark(ctx: ToolContext, spec: PeriodSpec): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  const [report, forecast] = await Promise.all([
    timed({ name: "team_benchmark", label: "Порівнюю з командою" }, () => teamBenchmark(period), tools),
    timed({ name: "month_forecast", label: "Рахую темп місяця" }, () => monthForecast(ctx.scope.repId, ctx.today), tools),
  ]);

  const me = report.reps.find((r) => r.repId === ctx.scope.repId);
  if (!me) {
    return {
      markdown: `${capitalize(period.label)} у вас немає реалізацій, тож порівнювати нема з чим.`,
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
  /**
   * На початку місяця табло майже порожнє.
   *
   * Третього числа різниця між людьми — це різниця в тому, хто встиг
   * виписати накладну вранці, а не в роботі. Мовчати про це не можна:
   * саме за таким рейтингом ухвалюють «він провалює місяць».
   */
  const early = period.label.includes("(1–") && Number(ctx.today.slice(8, 10)) <= 7;

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
      `## 🏆 Табло команди · ${period.label}`,
      `Ваше місце за оборотом: **${me.place} з ${report.reps.length}**.`,
      "",
      "| # | Торговий | Оборот | Від лідера | Динаміка |",
      "| --- | --- | --- | --- | --- |",
      ...boardRows,
      "",
      chase,
      early
        ? "_⏳ Місяць щойно почався — числа ще випадкові. Для порівняння людей надійніші 30 днів._"
        : "",
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
      periodChips("Як я на фоні команди"),
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
export async function answerAbcClients(ctx: ToolContext, spec: PeriodSpec): Promise<DirectAnswer> {
  const tools: DirectAnswer["tools"] = [];
  const period = periodOf(ctx.today, spec);

  const report = await timed(
    { name: "abc_clients", label: "Рахую ABC по клієнтах" },
    // У розмові про фірму рахуємо по всій базі: repId керівника дав би нуль.
    () => buildAbcReport(period.from, period.to, "client", ctx.scope.company ? null : ctx.scope.repId, 300, "amount"),
    tools
  );

  if (report.rows.length === 0) {
    return { markdown: `${capitalize(period.label)} продажів немає, ABC рахувати нема на чому.`, tools };
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
      `## 🅰️ Хто тримає ваш оборот · ${period.label}`,
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

/** Тип відповіді живе в md.ts; реекспорт — щоб імпорти решти коду не мінялися. */
export type { DirectAnswer };
