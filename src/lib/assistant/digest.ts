/**
 * Ранкове зведення керівникові — те, чого помічник не чекає, щоб спитали.
 *
 * Досі він відповідав, але мовчав: щоб дізнатися, що вчора хтось не
 * закрив зміну, а на складі скінчилося те, що продається щодня, треба
 * було здогадатися поставити питання. Зведення перевертає це: раз на день
 * система сама каже, що змінилося і на що дивитися.
 *
 * ОДИН НАБІР ФАКТІВ, ДВА ВИГЛЯДИ. `buildDigest` рахує дані, а малюють їх
 * двоє: `renderTelegram` і `renderMarkdown`. Причина технічна й жорстка —
 * **Telegram не вміє таблиць маркдауна**. Там таблиця можлива лише
 * моноширинним блоком `<pre>`, де стовпці тримаються пробілами; у кабінеті
 * ж навпаки — потрібна справжня таблиця. Спроба обійтися одним текстом
 * дала б або кашу в телефоні, або зіпсовану розмітку в кабінеті.
 *
 * Через це саме всередині `<pre>` НЕМАЄ смайликів: емодзі в моноширинному
 * шрифті шириною у два символи, і будь-який усередині рядка зсуває всі
 * стовпці праворуч від себе. Знаки стоять у заголовках секцій і в кінці
 * рядка, де зсувати вже нічого.
 *
 * Три правила змісту.
 *
 * ПЕРШЕ: лише те, що змінилося або вимагає дії. Постійні числа без руху
 * щоранку перетворюють лист на шум, який перестають читати на третій день.
 *
 * ДРУГЕ: жодних власних запитів повз аналітику — усе з тих самих функцій,
 * що й відповіді помічника, інакше ранок і день казали б різне.
 *
 * ТРЕТЄ: мовчання — теж відповідь. Порожній день листа не творить:
 * щоденне «все гаразд» знецінює той день, коли не гаразд.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd, kyivDayStart, kyivHour } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";
import { revenueByRep } from "@/lib/analytics/facts";
import {
  collectedByRepBrand,
  collectedTotals,
  debtDeltaByRep,
  receivableRowsByRep,
  sumAging,
  toDebtorList,
} from "@/lib/analytics/money-facts";
import { orderCountsByRep } from "@/lib/track/orders-today";
import { buildLowStockReport, DEFAULT_PARAMS } from "@/lib/procurement/low-stock";
import { syncHealthFacts } from "@/lib/sync-ingest/health-facts";
import { listStaff } from "@/lib/assistant/facts/staff";
import { getSyncState, setSyncState } from "@/lib/sync-ingest/context";
import { sendTelegramMessage } from "@/lib/telegram/notify";
import { esc } from "@/lib/shift/telegram-report";

/** Ключ, що не дає надіслати зведення двічі за день. */
const SENT_KEY = "assistant:digest:sentDay";

/** З якої години дозволено слати. Раніше восьмої лист ніхто не читає. */
export const DIGEST_HOUR = 8;

/** Скільки прострочки вважати нормою: вище — рядок у зведенні. */
const OVERDUE_ALARM_PCT = 25;

/** Скільки рядків показувати в кожній таблиці, щоб лист лишався листом. */
const MAX_REPS = 9;
const MAX_SHIFTS = 10;
const MAX_DEBTORS = 3;

/* ── Факти ───────────────────────────────────────────────────────────── */

export type RepRow = {
  name: string;
  revenue: number;
  docs: number;
  clients: number;
  avgCheck: number;
  collected: number;
  /** Скільки клієнтів у нього замовили за день. */
  orders: number;
};

export type ShiftRow = {
  name: string;
  role: "торговий" | "водій" | "склад";
  /** Хвилин на зміні; null — зміна ще не закрита. */
  minutes: number | null;
  open: boolean;
  /** Кілометри з одометра (фото на початку й у кінці). */
  odometerKm: number | null;
  /** Кілометри за треком планшета. */
  gpsKm: number;
  suspicious: boolean;
  autoClosed: boolean;
};

export type DigestFacts = {
  /** День, ПРО який зведення (вчора). */
  day: string;
  sales: {
    revenue: number;
    docs: number;
    clients: number;
    collected: number;
    /** Той самий день тижня тиждень тому — база для порівняння. */
    prevRevenue: number;
    deltaPct: number | null;
    reps: RepRow[];
  };
  shifts: {
    rows: ShiftRow[];
    odometerKm: number;
    gpsKm: number;
    /** Хто був на зміні, але точок не дав жодної. */
    noTrack: string[];
    /** Хто не закрив зміну за вчора. */
    unclosed: string[];
  };
  debts: {
    total: number;
    overdue: number;
    overduePct: number;
    /** Приріст боргу за день; null — знімка на початок дня немає. */
    delta: number | null;
    top: Array<{ name: string; overdue: number; days: number | null }>;
  };
  stock: { urgent: number; toOrder: number; orderCost: number } | null;
  sync: { alive: boolean; minutesAgo: number | null; stale: string[] };
  siteOrders: { pending: number; oldestHours: number };
};

/**
 * Куди слати зведення.
 *
 * Окрема змінна від решти сповіщень: це лист КЕРІВНИКОВІ, а не в робочий
 * канал, де сидять торгові й склад. Немає змінної — немає розсилки.
 */
export function digestChatId(): string | null {
  return process.env.DIGEST_CHAT_ID || null;
}

const ROLE_WORD: Record<string, ShiftRow["role"]> = {
  SALES: "торговий",
  DRIVER: "водій",
  WAREHOUSE: "склад",
};

/**
 * Зібрати зведення за вчорашній день і поточний стан.
 *
 * Вчорашній, а не сьогоднішній: о восьмій ранку сьогодні ще нічого не
 * сталося, а вчора вже все відомо й накладні з 1С доїхали за ніч.
 */
export async function buildDigest(today: string = kyivDate(new Date())): Promise<DigestFacts> {
  const day = shiftDay(today, -1);
  const from = kyivDayStart(day);
  const to = kyivDayEnd(day);
  const prevDay = shiftDay(day, -7);

  const [revenue, prevRevenue, collected, shiftRows, orderCounts, receivables, delta, lowStock, sync, staff, pending] =
    await Promise.all([
      revenueByRep(from, to),
      revenueByRep(kyivDayStart(prevDay), kyivDayEnd(prevDay)),
      collectedByRepBrand(from, to),
      prisma.shift.findMany({
        where: { startedAt: { gte: from, lte: to } },
        select: {
          userId: true,
          status: true,
          startedAt: true,
          endedAt: true,
          distanceKm: true,
          gpsDistanceKm: true,
          odometerSuspicious: true,
          lateCloseSource: true,
          user: { select: { name: true, role: true } },
        },
        orderBy: { startedAt: "asc" },
      }),
      orderCountsByRep(day),
      receivableRowsByRep(),
      debtDeltaByRep(from, to),
      buildLowStockReport({ brandId: null, ...DEFAULT_PARAMS }),
      syncHealthFacts(),
      listStaff(["SALES"]),
      prisma.order.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

  /* ── Продажі ────────────────────────────────────────────────────────── */

  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const collectedMap = collectedTotals(collected);

  const reps: RepRow[] = revenue
    .filter((r) => r.amount !== 0 || r.docs > 0)
    .map((r) => ({
      name: nameOf.get(r.repId) ?? "—",
      revenue: r.amount,
      docs: r.docs,
      clients: r.clients,
      avgCheck: r.docs > 0 ? r.amount / r.docs : 0,
      collected: collectedMap.get(r.repId)?.amount ?? 0,
      orders: orderCounts.get(r.repId) ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, MAX_REPS);

  const revenueTotal = revenue.reduce((s, r) => s + r.amount, 0);
  const prevTotal = prevRevenue.reduce((s, r) => s + r.amount, 0);

  /* ── Зміни ──────────────────────────────────────────────────────────── */

  const rows: ShiftRow[] = shiftRows.map((s) => ({
    name: s.user?.name ?? "—",
    role: ROLE_WORD[s.user?.role ?? ""] ?? "торговий",
    minutes:
      s.endedAt != null ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000) : null,
    open: s.status === "OPEN",
    odometerKm: s.distanceKm,
    gpsKm: Math.round(s.gpsDistanceKm ?? 0),
    suspicious: s.odometerSuspicious,
    autoClosed: (s.lateCloseSource ?? "").startsWith("AUTO"),
  }));

  const shifts = {
    rows: rows.slice(0, MAX_SHIFTS),
    odometerKm: rows.reduce((s, r) => s + (r.odometerKm ?? 0), 0),
    gpsKm: rows.reduce((s, r) => s + r.gpsKm, 0),
    /**
     * «Трек не писався» міряємо ТОЧКАМИ (тут — кілометрами треку), а не
     * діагнозом: діагноз пишеться для живої карти й наступного ранку
     * однаково лається на кожного, хто нормально відпрацював.
     */
    noTrack: rows.filter((r) => r.gpsKm === 0).map((r) => r.name),
    unclosed: rows.filter((r) => r.open).map((r) => r.name),
  };

  /* ── Гроші ──────────────────────────────────────────────────────────── */

  const aging = sumAging(receivables);
  const debtors = toDebtorList(receivables)
    .filter((d) => d.overdue > 0)
    .slice(0, MAX_DEBTORS)
    .map((d) => ({ name: d.name, overdue: d.overdue, days: d.oldestDays }));

  // Приріст рахується різницею двох знімків сальдо; без знімка на початок
  // дня це не нуль, а брак історії.
  const deltaRows = [...delta.values()].filter((d) => d.hasOpening);
  const debtDelta = deltaRows.length > 0 ? deltaRows.reduce((s, d) => s + d.delta, 0) : null;

  /* ── Решта ──────────────────────────────────────────────────────────── */

  const oldest = pending[0];
  const oldestHours = oldest ? Math.round((Date.now() - oldest.createdAt.getTime()) / 3_600_000) : 0;

  return {
    day,
    sales: {
      revenue: revenueTotal,
      docs: revenue.reduce((s, r) => s + r.docs, 0),
      clients: revenue.reduce((s, r) => s + r.clients, 0),
      collected: [...collectedMap.values()].reduce((s, c) => s + c.amount, 0),
      prevRevenue: prevTotal,
      deltaPct: prevTotal > 0 ? Math.round(((revenueTotal - prevTotal) / prevTotal) * 100) : null,
      reps,
    },
    shifts,
    debts: {
      total: aging.total,
      overdue: aging.overdue,
      overduePct: aging.overdueRatio,
      delta: debtDelta,
      top: debtors,
    },
    stock: lowStock
      ? { urgent: lowStock.urgent, toOrder: lowStock.toOrder, orderCost: lowStock.orderCost }
      : null,
    sync: {
      alive: !sync.agent.silent,
      minutesAgo: sync.agent.minutesAgo,
      stale: sync.channels.filter((c) => c.stale).map((c) => c.entityType),
    },
    siteOrders: { pending: pending.length, oldestHours },
  };
}

/**
 * Чи є про що писати.
 *
 * Продажі є щодня, тож самі по собі вони приводом для листа не є: лист
 * творить те, що вимагає уваги.
 */
export function digestHasNews(f: DigestFacts): boolean {
  return (
    f.sales.docs === 0 ||
    f.shifts.unclosed.length > 0 ||
    f.shifts.noTrack.length > 0 ||
    f.debts.overduePct >= OVERDUE_ALARM_PCT ||
    (f.stock?.urgent ?? 0) > 0 ||
    !f.sync.alive ||
    f.sync.stale.length > 0 ||
    f.siteOrders.pending > 0
  );
}

/* ── Спільне форматування ────────────────────────────────────────────── */

const nf = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const num = (v: number) => nf.format(Math.round(v));
const money = (v: number) => `${num(v)} ₴`;

/** «8:12» — години й хвилини на зміні. */
function hhmm(minutes: number | null): string {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

const MONTHS = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
];
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** Стан прострочки одним знаком — той самий поріг, що в помічнику. */
const overdueIcon = (pct: number) => (pct < 10 ? "🟢" : pct <= OVERDUE_ALARM_PCT ? "🟡" : "🔴");

/* ── Вигляд для Telegram ─────────────────────────────────────────────── */

/**
 * Моноширинна таблиця для `<pre>`.
 *
 * Ширину кожного стовпця рахуємо з даних, а не задаємо наперед: імена в
 * 1С різної довжини, і фіксована ширина або ріже потрібне, або лишає
 * дірку на пів екрана. Числа праворуч, текст ліворуч.
 */
function preTable(headers: string[], rows: string[][], alignRight: boolean[]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) =>
    r
      .map((cell, i) => (alignRight[i] ? (cell ?? "").padStart(widths[i]) : (cell ?? "").padEnd(widths[i])))
      .join(" ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

/**
 * Довге ім'я в таблиці ріжемо: рядок мусить влазити в екран телефона.
 *
 * trimEnd перед трикрапкою — інакше виходить «Кавецький …» із діркою.
 */
const shortName = (name: string, max = 11) => {
  const v = name.trim();
  return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;
};

export function renderTelegram(f: DigestFacts): string {
  const out: string[] = [`<b>☀️ Зведення за ${dayLabel(f.day)}</b>`];

  /* Продажі */
  const s = f.sales;
  out.push(
    "",
    `<b>💰 Продажі</b>`,
    `${money(s.revenue)} · ${s.docs} реаліз. · ${s.clients} кл.`,
    s.deltaPct == null
      ? `Тиждень тому цього дня продажів не було`
      : `${s.deltaPct >= 0 ? "📈" : "📉"} ${s.deltaPct >= 0 ? "+" : ""}${s.deltaPct}% до цього дня тиждень тому (${money(s.prevRevenue)})`,
    `💵 Зібрано грошей: ${money(s.collected)}`
  );

  if (s.reps.length > 0) {
    out.push(
      "<pre>" +
        esc(
          /*
           * Стовпців чотири, а не пʼять: у моноширинному блоці Telegram
           * рядок довший за ~30 символів переноситься, і таблиця
           * розсипається. Середній чек виводимо лише в кабінеті, де
           * ширина не тисне.
           */
          preTable(
            ["Торговий", "Оборот", "Док", "Зібрав"],
            s.reps.map((r) => [
              shortName(r.name, 9),
              num(r.revenue),
              String(r.docs),
              num(r.collected),
            ]),
            [false, true, true, true]
          )
        ) +
        "</pre>"
    );
  }

  /* Зміни */
  if (f.shifts.rows.length > 0) {
    out.push(
      "",
      `<b>🚗 Зміни</b>`,
      `Одометр ${num(f.shifts.odometerKm)} км · GPS ${num(f.shifts.gpsKm)} км`,
      "<pre>" +
        esc(
          preTable(
            ["Хто", "Час", "Одо", "GPS", ""],
            f.shifts.rows.map((r) => [
              shortName(r.name),
              hhmm(r.minutes),
              r.odometerKm == null ? "—" : num(r.odometerKm),
              num(r.gpsKm),
              r.open ? "!відкр" : r.suspicious ? "!одо" : r.gpsKm === 0 ? "!трек" : r.autoClosed ? "авто" : "",
            ]),
            [false, true, true, true, false]
          )
        ) +
        "</pre>"
    );
    if (f.shifts.unclosed.length > 0) {
      out.push(`🔴 Не закрили зміну: ${esc(f.shifts.unclosed.join(", "))}`);
    }
    if (f.shifts.noTrack.length > 0) {
      out.push(`📍 Трек не писався: ${esc(f.shifts.noTrack.join(", "))}`);
    }
  }

  /* Дебіторка */
  const d = f.debts;
  out.push(
    "",
    `<b>💼 Дебіторка</b>`,
    `${money(d.total)} · ${overdueIcon(d.overduePct)} прострочено ${money(d.overdue)} (${Math.round(d.overduePct)}%)` +
      (d.delta == null ? "" : ` · за день ${d.delta >= 0 ? "+" : ""}${money(d.delta)}`)
  );
  if (d.top.length > 0) {
    out.push(
      "<pre>" +
        esc(
          preTable(
            ["Боржник", "Простр.", "Днів"],
            d.top.map((x) => [shortName(x.name, 14), num(x.overdue), x.days == null ? "—" : String(x.days)]),
            [false, true, true]
          )
        ) +
        "</pre>"
    );
  }

  /* Склад, сайт, обмін */
  const tail: string[] = [];
  if (f.stock && f.stock.urgent > 0) {
    tail.push(
      `📦 Склад: скінчилось ${f.stock.urgent} ходових, до замовлення ${f.stock.toOrder} на ${money(f.stock.orderCost)}`
    );
  }
  if (f.siteOrders.pending > 0) {
    tail.push(`🛒 Сайт: ${f.siteOrders.pending} замовл. чекають, найстаріше ${f.siteOrders.oldestHours} год`);
  }
  if (!f.sync.alive) {
    tail.push(
      `🔄 Обмін 1С мовчить${f.sync.minutesAgo == null ? "" : ` ${Math.round(f.sync.minutesAgo / 60)} год`} — ціни й залишки застигли`
    );
  } else if (f.sync.stale.length > 0) {
    tail.push(`🔄 Канали обміну не оновлювались добу: ${esc(f.sync.stale.join(", "))}`);
  } else {
    tail.push(`🔄 Обмін з 1С у нормі`);
  }
  if (tail.length > 0) out.push("", ...tail);

  return out.filter((l) => l !== undefined).join("\n");
}

/* ── Вигляд для кабінету ─────────────────────────────────────────────── */

/** Рядок таблиці GFM. */
const row = (cells: Array<string | number>) => `| ${cells.join(" | ")} |`;

export function renderMarkdown(f: DigestFacts): string {
  const s = f.sales;
  const out: string[] = [`## ☀️ Зведення за ${dayLabel(f.day)}`, ""];

  out.push(
    `### 💰 Продажі`,
    "",
    `**${money(s.revenue)}** за ${s.docs} реалізацій, ${s.clients} клієнтів. Зібрано ${money(s.collected)}.`,
    s.deltaPct == null
      ? ""
      : `${s.deltaPct >= 0 ? "📈" : "📉"} ${s.deltaPct >= 0 ? "+" : ""}${s.deltaPct} % до цього дня тиждень тому (${money(s.prevRevenue)}).`,
    ""
  );

  if (s.reps.length > 0) {
    out.push(
      row(["Торговий", "Оборот", "Реал.", "Сер. чек", "Зібрав"]),
      row(["---", "---", "---", "---", "---"]),
      ...s.reps.map((r) =>
        row([r.name, money(r.revenue), r.docs, money(r.avgCheck), money(r.collected)])
      ),
      ""
    );
  }

  if (f.shifts.rows.length > 0) {
    out.push(
      `### 🚗 Зміни`,
      "",
      `Одометр ${num(f.shifts.odometerKm)} км, трек ${num(f.shifts.gpsKm)} км.`,
      "",
      row(["Хто", "Роль", "Час", "Одометр", "GPS", ""]),
      row(["---", "---", "---", "---", "---", "---"]),
      ...f.shifts.rows.map((r) =>
        row([
          r.name,
          r.role,
          hhmm(r.minutes),
          r.odometerKm == null ? "—" : `${r.odometerKm} км`,
          `${r.gpsKm} км`,
          r.open ? "🔴 відкрита" : r.suspicious ? "⚠️ одометр" : r.gpsKm === 0 ? "📍 без треку" : r.autoClosed ? "🕗 авто" : "✅",
        ])
      ),
      ""
    );
  }

  const d = f.debts;
  out.push(
    `### 💼 Дебіторка`,
    "",
    `${money(d.total)}, ${overdueIcon(d.overduePct)} прострочено **${money(d.overdue)}** (${Math.round(d.overduePct)} %)` +
      (d.delta == null ? "." : `, за день ${d.delta >= 0 ? "+" : ""}${money(d.delta)}.`),
    ""
  );
  if (d.top.length > 0) {
    out.push(
      ...d.top.map(
        (x) => `- 🔴 **${x.name}** — ${money(x.overdue)}${x.days == null ? "" : `, ${x.days} дн.`}`
      ),
      ""
    );
  }

  const tail: string[] = [];
  if (f.stock && f.stock.urgent > 0) {
    tail.push(
      `- 📦 Скінчилось ${f.stock.urgent} ходових позицій, до замовлення ${f.stock.toOrder} на ${money(f.stock.orderCost)}`
    );
  }
  if (f.siteOrders.pending > 0) {
    tail.push(
      `- 🛒 Замовлень із сайту чекають: ${f.siteOrders.pending}, найстаріше ${f.siteOrders.oldestHours} год`
    );
  }
  tail.push(
    f.sync.alive
      ? f.sync.stale.length > 0
        ? `- 🔄 Канали обміну не оновлювались добу: ${f.sync.stale.join(", ")}`
        : `- 🔄 Обмін з 1С у нормі`
      : `- 🔄 Обмін з 1С мовчить — ціни, залишки й борги застигли`
  );
  if (tail.length > 0) out.push(`### 📋 Решта`, "", ...tail);

  return out.filter((l) => l !== null).join("\n");
}

/**
 * Надіслати зведення, якщо час настав і сьогодні ще не слали.
 *
 * Викликається воркером щочверть години; уся логіка «чи вже пора» — тут,
 * щоб перезапуск воркера посеред дня не надіслав другого листа.
 */
export async function sendDailyDigest(
  opts: { dry?: boolean; force?: boolean } = {}
): Promise<DigestFacts | null> {
  const today = kyivDate(new Date());

  if (!opts.force) {
    if (kyivHour(new Date()) < DIGEST_HOUR) return null;
    if ((await getSyncState(SENT_KEY)) === today) return null;
  }

  /**
   * Куди слати — питаємо ДО збору, а не після.
   *
   * Збір зведення — це десяток паралельних запитів плюс повне сканування
   * асортименту (звіт про дефіцит). Коли перевірка стояла нижче, відсутність
   * `DIGEST_CHAT_ID` означала не «мовчимо», а «збираємо все це щочверть
   * години з восьмої ранку до півночі» — шість десятків прогонів на день у
   * порожнечу, бо мітка дня в цій гілці не ставилась.
   */
  const chatId = digestChatId();
  if (!chatId && !opts.dry) {
    console.warn("digest: DIGEST_CHAT_ID не налаштовано — зведення нікуди слати");
    if (!opts.force) await setSyncState(SENT_KEY, today);
    return null;
  }

  const facts = await buildDigest(today);
  if (!digestHasNews(facts) && !opts.force) {
    // Нічого не сталося — лист не йде, але день позначаємо: інакше
    // перевірка проганяла б збір щочверть години до самої ночі.
    if (!opts.dry) await setSyncState(SENT_KEY, today);
    return null;
  }

  // Друга умова недосяжна — вище вже вийшли; вона лише знімає з типу null.
  if (opts.dry || !chatId) return facts;

  await sendTelegramMessage(chatId, renderTelegram(facts));
  await setSyncState(SENT_KEY, today);
  return facts;
}
