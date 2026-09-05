/**
 * Табло команди в пуші: «вас обігнали», «ви піднялися».
 *
 * Рейтинг у помічнику торговий бачить, лише коли сам його спитає, — тобто
 * майже ніколи. Змагання починається тоді, коли про зміну повідомляють у
 * той самий день, а не наприкінці місяця в зведенні керівника.
 *
 * ЩО ВВАЖАЄТЬСЯ ЗМІНОЮ. Тільки перехід через сходинку: сума росте щодня, і
 * сповіщати про кожну гривню означало б навчити людей гасити сповіщення.
 * Порівнюємо з попереднім знімком, а не з учорашньою датою: воркер міг
 * лежати добу, і мовчазний пропуск був би гіршим за пізню звістку.
 *
 * КОГО НЕ ЧІПАЄМО. Тих, чий оборот менший за десяту частину лідерового:
 * унизу таблиці сусіди міняються місцями від однієї накладної, і людина,
 * яка щойно вийшла на роботу, отримувала б пуш щодня ні про що.
 *
 * Джерело місць — той самий `teamBenchmark`, що малює табло в помічнику.
 * Друга реалізація рано чи пізно розійшлася б із першою, і пуш казав би
 * одне, а екран — інше.
 */

import { prisma } from "@/lib/prisma";
import { teamBenchmark } from "@/lib/analytics/benchmark";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { shiftDay } from "@/lib/analytics/period";
import { sendPushToUser } from "@/lib/push/send";

/** Вікно рейтингу — те саме, що в помічнику за замовчуванням. */
const WINDOW_DAYS = 30;

/** Нижче цієї частки від лідера рух у таблиці — шум, а не змагання. */
const RACE_MIN_SHARE = 0.1;

/** Ключ знімка місць у SyncState. */
const STATE_KEY = "leaderboard:places";

type Snapshot = { day: string; places: Array<{ repId: string; place: number; revenue: number }> };

export type StandingChange = {
  repId: string;
  name: string;
  place: number;
  prevPlace: number | null;
  revenue: number;
  /** Кого обійшли або хто обійшов нас — залежно від напрямку. */
  rival: string | null;
  /** Відрив від того, хто попереду; 0 — ви перший. */
  gapAhead: number;
  aheadName: string | null;
  send: boolean;
  why: string;
  title?: string;
  body?: string;
};

const money = (n: number) => `${Math.round(n).toLocaleString("uk-UA").replace(/ /g, " ")} ₴`;

/**
 * Порахувати місця, порівняти зі знімком і розіслати пуші.
 *
 * `dry` лишає знімок недоторканим і нічого не шле — саме в цьому режимі
 * рішення й перевіряють перед тим, як вмикати розсилку.
 */
export async function notifyStandingChanges(
  opts: { dry?: boolean; today?: string; oncePerDay?: boolean } = {}
): Promise<StandingChange[]> {
  const today = opts.today ?? kyivDate(new Date());

  /**
   * Денний запобіжник — у самому знімку, а не окремим ключем.
   *
   * Знімок і так підписаний днем, коли його зробили, тож другий ключ
   * «коли слали востаннє» був би другою правдою про те саме: розійшлися б
   * вони на першому ж падінні воркера посеред розсилки.
   */
  if (opts.oncePerDay) {
    const already = await loadSnapshot();
    if (already?.day === today) return [];
  }
  const fromDay = shiftDay(today, -(WINDOW_DAYS - 1));
  const period = {
    fromDay,
    toDay: today,
    from: kyivDayStart(fromDay),
    to: kyivDayEnd(today),
    days: WINDOW_DAYS,
    clamped: false,
  };

  const report = await teamBenchmark(period);
  const board = [...report.reps].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  if (board.length < 2) return [];

  const previous = await loadSnapshot();
  const prevPlace = new Map(previous?.places.map((p) => [p.repId, p.place]) ?? []);
  const leader = board[0]?.revenue ?? 0;

  const changes: StandingChange[] = [];

  for (const [index, rep] of board.entries()) {
    const place = index + 1;
    const revenue = rep.revenue ?? 0;
    const before = prevPlace.get(rep.repId) ?? null;
    const ahead = index > 0 ? board[index - 1] : null;
    const behind = board[index + 1] ?? null;

    const base: StandingChange = {
      repId: rep.repId,
      name: rep.name,
      place,
      prevPlace: before,
      revenue,
      rival: null,
      gapAhead: ahead ? (ahead.revenue ?? 0) - revenue : 0,
      aheadName: ahead?.name ?? null,
      send: false,
      why: "",
    };

    if (before == null) {
      changes.push({ ...base, why: "перший знімок — місце просто запам'ятали" });
      continue;
    }
    if (before === place) {
      changes.push({ ...base, why: "місце те саме" });
      continue;
    }
    if (leader > 0 && revenue < leader * RACE_MIN_SHARE) {
      changes.push({ ...base, why: "оборот нижче десятої частки лідера — не змагання" });
      continue;
    }

    const climbed = place < before;
    // Обійшли ми того, хто тепер за нами; нас обігнав той, хто тепер попереду.
    const rival = (climbed ? behind?.name : ahead?.name) ?? null;

    const perDay = daysLeftInMonth(today) > 0 ? base.gapAhead / daysLeftInMonth(today) : base.gapAhead;

    const title = place === 1
      ? "👑 Ви очолили табло команди!"
      : climbed
        ? `${place === 2 ? "🥈" : place === 3 ? "🥉" : "🎉"} Ви піднялися на ${place} місце`
        : `📉 Ви опустилися на ${place} місце`;

    const body = climbed
      ? [
          rival ? `Обійшли: ${rival}.` : null,
          `Ваш оборот ${money(revenue)} за ${WINDOW_DAYS} днів.`,
          ahead ? `До ${place - 1} місця (${ahead.name}) — ${money(base.gapAhead)}.` : "Попереду нікого — тримайте.",
        ]
          .filter(Boolean)
          .join(" ")
      : [
          rival ? `Вас обігнав ${rival}.` : null,
          `Різниця ${money(base.gapAhead)} — це ${money(perDay)} на день до кінця місяця.`,
        ]
          .filter(Boolean)
          .join(" ");

    changes.push({ ...base, rival, send: true, why: climbed ? "піднявся" : "опустився", title, body });
  }

  if (!opts.dry) {
    for (const change of changes.filter((c) => c.send)) {
      await sendPushToUser(change.repId, {
        title: change.title!,
        body: change.body!,
        // Тап веде в помічника: там повне табло, а не сам лише рядок.
        url: "/sales/assistant",
        data: { screen: "/cabinet", target: "/sales/assistant" },
      });
    }
    await saveSnapshot({
      day: today,
      places: board.map((r, i) => ({ repId: r.repId, place: i + 1, revenue: r.revenue ?? 0 })),
    });
  }

  return changes;
}

/** Скільки днів лишилось у місяці, включно з сьогоднішнім. */
function daysLeftInMonth(today: string): number {
  const [y, m, d] = today.split("-").map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(1, total - d + 1);
}

async function loadSnapshot(): Promise<Snapshot | null> {
  const row = await prisma.syncState.findUnique({ where: { key: STATE_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Snapshot;
  } catch {
    return null;
  }
}

async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const value = JSON.stringify(snapshot);
  await prisma.syncState.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value },
    update: { value },
  });
}
