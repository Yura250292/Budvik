/**
 * Ранкове зведення керівникові — те, чого помічник не чекає, щоб спитали.
 *
 * Досі він відповідав, але мовчав: щоб дізнатися, що вчора хтось не
 * закрив зміну, а на складі скінчилося те, що продається щодня, треба
 * було здогадатися поставити питання. Зведення перевертає це: раз на день
 * система сама каже, що змінилося і на що дивитися.
 *
 * Три правила, за якими воно складене.
 *
 * ПЕРШЕ: лише те, що змінилося або вимагає дії. Постійні числа (борг,
 * запас) без руху нікому не потрібні щоранку — вони перетворюють лист на
 * шум, який перестають читати на третій день.
 *
 * ДРУГЕ: жодних нових запитів. Усе береться з тих самих фактів, що й
 * відповіді помічника, тому зведення не може розійтися з тим, що він
 * скаже на питання.
 *
 * ТРЕТЄ: мовчання — теж відповідь. Якщо нічого не сталося, лист не
 * йде взагалі: щоденне «все гаразд» знецінює той день, коли не гаразд.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd, kyivDayStart, kyivHour } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";
import { livePositions } from "@/lib/track/live-positions";
import { revenueByRep } from "@/lib/analytics/facts";
import { receivableRowsByRep, sumAging, toDebtorList } from "@/lib/analytics/money-facts";
import { buildLowStockReport, DEFAULT_PARAMS } from "@/lib/procurement/low-stock";
import { syncHealthFacts } from "@/lib/sync-ingest/health-facts";
import { listStaff } from "@/lib/assistant/facts/staff";
import { getSyncState, setSyncState } from "@/lib/sync-ingest/context";
import { sendTelegramMessage } from "@/lib/telegram/notify";
import { esc } from "@/lib/shift/telegram-report";

/** Ключ, що не дає надіслати зведення двічі за день. */
const SENT_KEY = "assistant:digest:sentDay";

/** З якої години дозволено слати. Раніше сьомої в полі ще ніхто не читає. */
export const DIGEST_HOUR = 8;

/** Скільки прострочки вважати нормою: вище — рядок у зведенні. */
const OVERDUE_ALARM_PCT = 25;

const numberFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const money = (v: number) => `${numberFmt.format(Math.round(v))} ₴`;

export type DigestLine = { icon: string; text: string };

export type Digest = {
  day: string;
  lines: DigestLine[];
  /** Порожній список означає «нема про що казати» — лист не йде. */
  empty: boolean;
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

/**
 * Зібрати зведення за вчорашній день і поточний стан.
 *
 * Вчорашній, а не сьогоднішній: о восьмій ранку сьогодні ще нічого не
 * сталося, а вчора вже все відомо й накладні з 1С доїхали за ніч.
 */
export async function buildDigest(today: string = kyivDate(new Date())): Promise<Digest> {
  const yesterday = shiftDay(today, -1);
  const lines: DigestLine[] = [];

  const [live, dayRevenue, prevRevenue, receivables, lowStock, sync, staff] = await Promise.all([
    livePositions(yesterday),
    revenueByRep(...dayBounds(yesterday)),
    revenueByRep(...dayBounds(shiftDay(yesterday, -7))),
    receivableRowsByRep(),
    buildLowStockReport({ brandId: null, ...DEFAULT_PARAMS }),
    syncHealthFacts(),
    listStaff(["SALES"]),
  ]);

  /* ── Скільки вчора продали ──────────────────────────────────────────── */

  const sum = dayRevenue.reduce((s, r) => s + r.amount, 0);
  const prevSum = prevRevenue.reduce((s, r) => s + r.amount, 0);
  const docs = dayRevenue.reduce((s, r) => s + r.docs, 0);
  if (docs > 0) {
    const delta = prevSum > 0 ? Math.round(((sum - prevSum) / prevSum) * 100) : null;
    const nameOf = new Map(staff.map((s2) => [s2.id, s2.name]));
    const best = [...dayRevenue].sort((a, b) => b.amount - a.amount)[0];
    lines.push({
      icon: "📈",
      text:
        `Учора продали <b>${money(sum)}</b> за ${docs} реалізацій` +
        (delta == null ? "" : `, це ${delta >= 0 ? "+" : ""}${delta}% до того самого дня тижня`) +
        (best ? `. Найбільше — ${esc(nameOf.get(best.repId) ?? "—")}, ${money(best.amount)}` : ""),
    });
  } else {
    lines.push({ icon: "📉", text: "Учора реалізацій не було взагалі." });
  }

  /* ── Хто не закрив зміну ────────────────────────────────────────────── */

  const unclosed = live.people.filter((p) => p.shift?.status === "OPEN");
  if (unclosed.length > 0) {
    lines.push({
      icon: "🚗",
      text:
        `Зміну за вчора не закрили: ${unclosed.map((p) => esc(p.name ?? "—")).join(", ")}. ` +
        "Одометр за той день не доїде, поки зміну не закриють.",
    });
  }

  /*
   * «Трек не писався» міряємо ТОЧКАМИ, а не діагнозом.
   *
   * Діагноз пишеться для живої карти й наступного ранку однаково каже
   * «точок немає 400 хв» про кожного, хто нормально відпрацював і
   * закрився. Об'єктивна ознака одна: зміна була, а точок нуль.
   */
  const silent = live.people.filter((p) => p.shift && p.pointsCount === 0);
  if (silent.length > 0) {
    lines.push({
      icon: "📍",
      text:
        `Трек учора не писався взагалі в ${silent.length}: ` +
        `${silent.map((p) => esc(p.name ?? "—")).join(", ")}. Пробіг за той день порахувати нічим.`,
    });
  }

  /* ── Гроші ──────────────────────────────────────────────────────────── */

  const aging = sumAging(receivables);
  if (aging.overdueRatio >= OVERDUE_ALARM_PCT) {
    const worst = toDebtorList(receivables)
      .filter((d) => d.overdue > 0)
      .slice(0, 3);
    lines.push({
      icon: "🔴",
      text:
        `Прострочено <b>${money(aging.overdue)}</b> із ${money(aging.total)} боргу ` +
        `(${Math.round(aging.overdueRatio)}%). Найбільші: ` +
        worst.map((d) => `${esc(d.name)} ${money(d.overdue)}`).join(", "),
    });
  }

  /* ── Склад ──────────────────────────────────────────────────────────── */

  if (lowStock && lowStock.urgent > 0) {
    lines.push({
      icon: "📦",
      text:
        `Скінчилося ${lowStock.urgent} позицій, які продаються; ` +
        `усього до замовлення ${lowStock.toOrder} на ${money(lowStock.orderCost)}.`,
    });
  }

  /* ── Обмін ──────────────────────────────────────────────────────────── */

  if (sync.agent.silent) {
    lines.push({
      icon: "🔄",
      text:
        "Обмін із 1С мовчить" +
        (sync.agent.minutesAgo == null
          ? " — агент не озивався взагалі."
          : ` ${Math.round(sync.agent.minutesAgo / 60)} год. Ціни, залишки й борги на сайті застигли.`),
    });
  } else {
    const stale = sync.channels.filter((c) => c.stale);
    if (stale.length > 0) {
      lines.push({
        icon: "🔄",
        text: `Канали обміну не оновлювались добу: ${stale.map((c) => c.entityType).join(", ")}.`,
      });
    }
  }

  /* ── Замовлення з сайту, які висять ─────────────────────────────────── */

  const pending = await prisma.order.count({ where: { status: "PENDING" } });
  if (pending > 0) {
    const oldest = await prisma.order.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const hours = oldest ? Math.round((Date.now() - oldest.createdAt.getTime()) / 3_600_000) : 0;
    lines.push({
      icon: "🛒",
      text: `Замовлень із сайту чекають обробки: ${pending}, найстаріше висить ${hours} год.`,
    });
  }

  /*
   * «Порожнє» означає «сталося тільки звичайне»: перший рядок про продажі
   * є завжди, і сам по собі він приводом для листа не є.
   */
  return { day: yesterday, lines, empty: lines.length <= 1 };
}

/**
 * Межі доби — київські, як у решті аналітики.
 *
 * Наївний UTC зсунув би добу на три години, і «вчора» включало б вечір
 * позавчора: усі інші відповіді рахують інакше, і числа розійшлися б.
 */
function dayBounds(day: string): [Date, Date] {
  return [kyivDayStart(day), kyivDayEnd(day)];
}

export function renderDigest(digest: Digest): string {
  const head = `<b>☀️ Ранкове зведення</b> · за ${digest.day}`;
  const body = digest.lines.map((l) => `${l.icon} ${l.text}`).join("\n\n");
  return `${head}\n\n${body}`;
}

/**
 * Надіслати зведення, якщо час настав і сьогодні ще не слали.
 *
 * Викликається воркером щочверть години; уся логіка «чи вже пора» — тут,
 * щоб перезапуск воркера посеред дня не надіслав другого листа.
 */
export async function sendDailyDigest(opts: { dry?: boolean; force?: boolean } = {}): Promise<Digest | null> {
  const today = kyivDate(new Date());

  if (!opts.force) {
    if (kyivHour(new Date()) < DIGEST_HOUR) return null;
    if ((await getSyncState(SENT_KEY)) === today) return null;
  }

  const digest = await buildDigest(today);
  if (digest.empty && !opts.force) {
    // Нічого не сталося — лист не йде, але день позначаємо: інакше
    // перевірка проганяла б збір щочверть години до самої ночі.
    if (!opts.dry) await setSyncState(SENT_KEY, today);
    return null;
  }

  if (opts.dry) return digest;

  const chatId = digestChatId();
  if (!chatId) {
    console.warn("digest: DIGEST_CHAT_ID не налаштовано — зведення нікуди слати");
    return null;
  }

  await sendTelegramMessage(chatId, renderDigest(digest));
  await setSyncState(SENT_KEY, today);
  return digest;
}

/** Той самий зміст, але як відповідь помічника на питання «що нового». */
export async function digestMarkdown(today: string): Promise<string> {
  const digest = await buildDigest(today);
  const body = digest.lines
    .map((l) => `- ${l.icon} ${l.text.replace(/<\/?b>/g, "**")}`)
    .join("\n");
  return `## ☀️ Що змінилося · за ${digest.day}\n\n${body || "Нічого, про що варто сказати."}`;
}
