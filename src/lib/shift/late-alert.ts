/**
 * «Робочий день скінчився, а зміна відкрита» — сигнал офісу о 20:00.
 *
 * У застосунку нагадування торговому вже є (локальні, о 19:30, 20:00 і
 * 21:00 — `mobile/src/track/reminder.ts`). Але вони мовчазні для офісу:
 * якщо людина їх не побачила чи відклала, ніхто про це не дізнається до
 * ранку, коли зміну вже закрив автомат і одометра в ній немає.
 *
 * Тому о 20:00 офіс отримує коротке «не закрив». Це не дублює
 * автозакриття, а передує йому: автомат вступає в дію не раніше, ніж
 * знайде в треку зупинку, а до 23:00 узагалі чекає, якщо планшет мовчить.
 * Проміжок між «час минув» і «система нарешті закрила» — саме той, коли
 * дзвінок людині ще рятує чесний одометр.
 *
 * Один сигнал на зміну, не більше. Повторювати щочверть години о 20:15,
 * 20:30, 20:45 означало б привчити читати канал по діагоналі — а там же
 * лежать аварії треку.
 */

import { prisma } from "@/lib/prisma";
import { kyivHour, kyivTime } from "@/lib/date/kyiv";
import { getSyncState, setSyncState } from "@/lib/sync-ingest/context";
import { sendTelegramMessage } from "@/lib/telegram/notify";
import { esc, shiftAlertChatId } from "@/lib/shift/telegram-report";

/**
 * З якої київської години сигналити. Та сама межа, що й у автозакриття
 * (`FROM_HOUR` в auto-close.ts): робочий день скінчився.
 */
const FROM_HOUR = 20;

/**
 * Скільки годин зміна має бути відкритою, щоб її вважати забутою.
 *
 * Дзеркалить MIN_HOURS_OPEN автозакриття й потрібне з тієї ж причини:
 * вечірній виїзд, відкритий о 19:40, о 20:00 ще не забутий — писати про
 * нього офісу означало б смикати людей через нормальну роботу.
 */
const MIN_HOURS_OPEN = 3;

/**
 * Ключ тротлу в спільному сховищі станів.
 *
 * Ключ по людині, а значення — id зміни: так рядків рівно стільки,
 * скільки торгових, і вони не ростуть із роками. Збіг значення означає
 * «про цю саму зміну вже писали».
 */
const alertKey = (userId: string) => `shift:lateAlert:${userId}`;

export type LateAlertDecision = {
  shiftId: string;
  name: string | null;
  startedAt: Date;
  /** Чи піде сигнал у цьому проході — і якщо ні, то чому. */
  send: boolean;
  reason: string;
};

/**
 * Один прохід по відкритих змінах.
 *
 * Повертає ухвалені рішення — і надіслані, і пропущені. Воркеру потрібне
 * лише число, а `--dry` у перевірочному скрипті показує всю картину, не
 * ставлячи міток: мітка «вже сповіщено» незворотна, і поставлена
 * дослідженням вона з'їла б справжній вечірній сигнал.
 */
export async function alertUnclosedShifts(
  now: Date = new Date(),
  opts: { dryRun?: boolean } = {}
): Promise<LateAlertDecision[]> {
  // Вікно те саме, що в автозакриття: вечір, а не ніч. Зміна, що
  // перевалила за північ, о 01:00 сюди не потрапить — її вже добиває
  // автозакриття правилом «понад 16 годин».
  if (kyivHour(now) < FROM_HOUR) return [];

  const chatId = shiftAlertChatId();
  // Немає каналу — не помилка: сповіщення просто не налаштовані.
  if (!chatId && !opts.dryRun) return [];

  const open = await prisma.shift.findMany({
    where: {
      status: "OPEN",
      startedAt: { lt: new Date(now.getTime() - MIN_HOURS_OPEN * 3_600_000) },
    },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      user: { select: { name: true } },
    },
  });

  const decisions: LateAlertDecision[] = [];

  for (const shift of open) {
    const minutesOpen = Math.floor((now.getTime() - shift.startedAt.getTime()) / 60_000);
    const hours = Math.floor(minutesOpen / 60);
    const minutes = minutesOpen % 60;

    const base = {
      shiftId: shift.id,
      name: shift.user.name,
      startedAt: shift.startedAt,
    };

    const already = await getSyncState(alertKey(shift.userId));
    if (already === shift.id) {
      decisions.push({ ...base, send: false, reason: "про цю зміну вже сповіщали" });
      continue;
    }

    decisions.push({
      ...base,
      send: true,
      reason: `відкрита ${hours} год ${minutes} хв`,
    });

    if (opts.dryRun) continue;

    await sendTelegramMessage(
      chatId!,
      `⚠️ <b>${esc(shift.user.name ?? "Без імені")} не закрив зміну</b>\n` +
        `Відкрита з ${kyivTime(shift.startedAt)} — уже ${hours} год ${minutes} хв.\n` +
        `У планшеті нагадування показано. Якщо не закриє сам — система закриє за зупинкою в треку, без фото одометра.`
    );

    await setSyncState(alertKey(shift.userId), shift.id);
  }

  return decisions;
}
