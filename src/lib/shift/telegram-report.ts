/**
 * Зміна торгового в Telegram: відкрив, закрив, не закрив.
 *
 * Досі про зміни знала лише адмінка: щоб побачити, чи людина вийшла й що
 * з того вийшло, треба було відкрити браузер і згадати, куди дивитись. У
 * канал же падали тільки аварії — «трек не пишеться» й «зміну закрито
 * автоматично», — тому чат розповідав про роботу рівно тоді, коли вона
 * зламалася.
 *
 * Тут той самий канал отримує звичайний хід дня. Головне повідомлення —
 * закриття: у ньому поруч стоять обидва пробіги (одометр і трек), час на
 * зміні й результат — замовлення з сумою. Це та сама пара чисел, що й у
 * списку змін адмінки, і зведені вони мусять бути однаково, інакше в
 * розмові з торговим цифри розійдуться.
 *
 * Три речі, про які тут легко помилитися:
 *
 * 1. День замовлень — київська дата СТАРТУ зміни (`kyivDate`), а межі
 *    вибірки самих замовлень усередині `ordersSummaryForRep` — наївний
 *    UTC, бо 1С пише київський стінний час, підписаний як UTC. Дві різні
 *    системи координат, і змішувати їх не можна: буде зсув на три години.
 *
 * 2. Зміна без фінішного фото (пізнє й автоматичне закриття) не має
 *    кінцевого одометра взагалі — він доїде зранку зі старту наступної
 *    зміни. Ставити туди нуль чи трек означало б видати здогадку за вимір.
 *
 * 3. Замовлення допроводяться в 1С годинами пізніше. Звіт фіксує стан на
 *    момент закриття — тому чернетки показуються окремим хвостом, а не
 *    ховаються й не зливаються з виручкою.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate, kyivTime } from "@/lib/date/kyiv";
import { sendTelegramMessage } from "@/lib/telegram/notify";
import { ordersSummaryForRep } from "@/lib/track/orders-today";
import type { LateCloseSource } from "@/lib/shift/reconcile";

/**
 * Куди слати.
 *
 * SHIFT_ALERT_CHAT_ID — на випадок, коли зміни захочуть у власний чат:
 * їх помітно більше, ніж аварій, і вони можуть топити технічні алерти. Поки
 * змінної немає, усе йде в той самий канал, що й решта сповіщень про
 * роботу в полі.
 */
export function shiftAlertChatId(): string | null {
  return process.env.SHIFT_ALERT_CHAT_ID || process.env.SYNC_ALERT_CHAT_ID || null;
}

/** parse_mode HTML: ім'я з бази може містити «&» чи кутові дужки. */
export function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const numberFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** «145 230» — з нерозривними пробілами, як в адмінці. */
function num(value: number): string {
  return numberFmt.format(Math.round(value));
}

/** «9 год 27 хв», «47 хв». */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h} год ${m} хв`;
}

/** Ім'я для повідомлення — те саме, що бачить офіс у списку змін. */
function personName(name: string | null): string {
  return esc(name ?? "Без імені");
}

/**
 * Заголовок закриття залежить від того, ЯК зміну закрито.
 *
 * Це не косметика: закрита з фото зміна має чесний одометр, а закрита
 * пізно чи автоматично — лише час, і пробіг у ній з'явиться аж зранку.
 * Читач мусить бачити різницю з першого рядка, інакше «—» замість
 * кілометрів виглядатиме як поламаний звіт.
 */
const AUTO_LABEL: Record<string, string> = {
  AUTO_GPS: "за зупинкою в треку",
  AUTO_GAP: "час приблизний, трек із розривом",
  AUTO_DEAD: "трек мовчав",
  AUTO_FORCED: "за часом",
};

function closeHeadline(shift: {
  closedAutomatically: boolean;
  closedLate: boolean;
  lateCloseSource: string | null;
}): string {
  if (shift.closedAutomatically) {
    const label = AUTO_LABEL[shift.lateCloseSource ?? ""] ?? shift.lateCloseSource ?? "автоматично";
    return `🕗 <b>Зміну закрито автоматично</b> (${label})`;
  }
  if (shift.lateCloseSource === "OFFICE") return "🏢 <b>Зміну закрив офіс</b>";
  if (shift.closedLate) return "🌙 <b>Зміну закрито пізно, без фото</b>";
  return "🔴 <b>Зміну закрито</b>";
}

/** Рядок замовлень: кількість, сума і — окремо — чернетки. */
function ordersLine(s: { count: number; totalUah: number; draftCount: number; draftUah: number }): string {
  const main = s.count > 0 ? `${s.count} на ${num(s.totalUah)} грн` : "0";
  const draft = s.draftCount > 0 ? ` (+${s.draftCount} чернет${s.draftCount === 1 ? "ка" : "ки"} на ${num(s.draftUah)} грн)` : "";
  return `📦 Замовлень: ${main}${draft}`;
}

/** Що саме автозакриття долікувало вранці — рядок до повідомлення про відкриття. */
export type AutoClosedInfo = {
  distanceKm: number | null;
  afterWorkKm: number | null;
  /** Час закінчення забутої зміни, якщо він був відомий. */
  endedAt: Date | null;
};

/**
 * Текст про відкриття зміни.
 *
 * Окремо від надсилання — щоб перевірочний скрипт міг показати
 * повідомлення, нікого не турбуючи.
 */
export async function buildShiftOpenedMessage(
  shiftId: string,
  autoClosed?: AutoClosedInfo | null
): Promise<string | null> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      startedAt: true,
      startOdometer: true,
      personalKm: true,
      user: { select: { name: true } },
    },
  });
  if (!shift) return null;

  const lines = [
    "🟢 <b>Зміну відкрито</b>",
    `${personName(shift.user.name)} — ${kyivTime(shift.startedAt)}, одометр ${num(shift.startOdometer)} км`,
  ];

  /**
   * Особисті кілометри між змінами — не порушення саме собою (дорога
   * додому теж дорога), але число, за яким видно вечірні поїздки на
   * робочій машині.
   */
  if (shift.personalKm != null && shift.personalKm > 0) {
    lines.push(`↳ Від кінця минулої зміни: ${num(shift.personalKm)} км`);
  }

  /**
   * Забута зміна закривається саме в цей момент і більше ніде: це єдина
   * подія, у якій її пробіг стає відомим. Не сказати про неї тут —
   * значить не сказати ніколи.
   */
  if (autoClosed) {
    const km = autoClosed.distanceKm != null ? `${num(autoClosed.distanceKm)} км` : "пробіг не порахувався";
    const after =
      autoClosed.afterWorkKm != null && autoClosed.afterWorkKm > 0
        ? ` (вечірні ${num(autoClosed.afterWorkKm)} км відняті)`
        : autoClosed.endedAt
          ? ""
          : " — разом із вечором, часу закінчення не було";
    lines.push(`↳ Заразом закрито попередню незакриту зміну: ${km}${after}`);
  }

  return lines.join("\n");
}

/**
 * Текст звіту про закриту зміну.
 *
 * `reasonLine` передає автозакриття — пояснення, чому обрано саме цей час
 * («стоїть 47 хв з 18:12»). Для решти шляхів його немає: там час назвала
 * людина.
 */
export async function buildShiftClosedMessage(
  shiftId: string,
  opts: { reasonLine?: string } = {}
): Promise<string | null> {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      userId: true,
      startedAt: true,
      endedAt: true,
      startOdometer: true,
      endOdometer: true,
      distanceKm: true,
      durationMinutes: true,
      gpsDistanceKm: true,
      closedAutomatically: true,
      closedLate: true,
      lateCloseSource: true,
      user: { select: { name: true } },
    },
  });
  if (!shift) return null;

  const orders = await ordersSummaryForRep(shift.userId, kyivDate(shift.startedAt));

  const finished = shift.endedAt ? kyivTime(shift.endedAt) : "—";
  const spent = shift.durationMinutes != null ? ` · ${duration(shift.durationMinutes)}` : "";

  /**
   * Одометр показуємо лише коли він справді виміряний. У зміни без
   * фінішного фото його немає, і чесна відповідь тут — «доїде зранку»,
   * а не число, зібране з треку.
   */
  const odometerLine =
    shift.endOdometer != null && shift.distanceKm != null
      ? `🚗 По одометру: ${num(shift.distanceKm)} км (${num(shift.startOdometer)} → ${num(shift.endOdometer)})`
      : "🚗 По одометру: — (без фінішного фото, порахується зранку зі старту наступної зміни)";

  const lines = [
    `${closeHeadline(shift)} — ${personName(shift.user.name)}`,
    `🕗 ${kyivTime(shift.startedAt)}–${finished}${spent}`,
    odometerLine,
    `📡 По трекеру: ${shift.gpsDistanceKm != null ? `${num(shift.gpsDistanceKm)} км` : "—"}`,
    ordersLine(orders),
  ];

  if (opts.reasonLine) lines.push(`ℹ️ ${opts.reasonLine}`);

  return lines.join("\n");
}

/** Спільне надсилання: без каналу — тиша, помилка не виходить назовні. */
async function send(text: string | null, chatId?: string): Promise<void> {
  const to = chatId ?? shiftAlertChatId();
  // Немає каналу — не помилка: сповіщення просто не налаштовані.
  if (!to || !text) return;
  await sendTelegramMessage(to, text);
}

/**
 * Сповіщення про відкриття.
 *
 * Ніколи не кидає: зміна вже відкрита, і збій у Telegram не має
 * перетворюватись на помилку для людини, яка щойно сфотографувала
 * одометр.
 */
export async function notifyShiftOpened(
  shiftId: string,
  autoClosed?: AutoClosedInfo | null,
  opts: { chatId?: string } = {}
): Promise<void> {
  try {
    await send(await buildShiftOpenedMessage(shiftId, autoClosed), opts.chatId);
  } catch (e) {
    console.error("[shift-report] відкриття зміни не надіслано", e);
  }
}

/** Сповіщення про закриття. Так само тихе при збої. */
export async function notifyShiftClosed(
  shiftId: string,
  opts: { reasonLine?: string; chatId?: string } = {}
): Promise<void> {
  try {
    await send(await buildShiftClosedMessage(shiftId, opts), opts.chatId);
  } catch (e) {
    console.error("[shift-report] закриття зміни не надіслано", e);
  }
}

/** Тип джерела пізнього закриття — щоб автозакриття передавало його без приведення. */
export type { LateCloseSource };
