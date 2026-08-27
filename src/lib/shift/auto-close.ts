/**
 * Зміна, яку торговий забув закрити, закривається сама ввечері.
 *
 * Досі забута зміна висіла OPEN, поки людина не відкриє наступну: трек
 * усю ніч писався в робочому режимі, а коли зміну таки закривали руками
 * через день чи п'ять, у пробіг лягав вечір, ніч і вихідні. У базі це
 * видно на очі: зміна 08:54 → 18:12 «закрита» через п'ять діб, 75 км
 * одометра проти 6 км за треком.
 *
 * Чому не просто «закрити о 20:00». Люди закінчують по-різному: один
 * стабільно о 15:52, інший о 20:10. Фіксована година відрізала б
 * другому годину роботи й запізнилася б для першого на чотири. Тому
 * 20:00 — не час закриття, а час, з якого системі ДОЗВОЛЕНО закривати;
 * сам момент береться з треку — коли машина стала й більше не рушила.
 *
 * Одометр тут не вигадується. Він прийде зранку зі стартового фото
 * наступної зміни — той механізм уже є (гілка forgotten у
 * POST /api/shift/open) і працює однаково для ручного пізнього закриття
 * й для цього автоматичного.
 */

import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram/notify";
import { kyivHour, kyivTime } from "@/lib/date/kyiv";
import { guessWorkEnd, STOP_MINUTES } from "@/lib/shift/late-close";
import { autoCloseNote, closeWithoutPhoto, type LateCloseSource } from "@/lib/shift/reconcile";

/**
 * Скільки годин зміна має бути відкритою, щоб її взагалі розглядати.
 *
 * Захист від вечірніх виїздів: людина, яка відкрила зміну о 19:30,
 * не має закритися через півгодини лише тому, що на годиннику 20:00.
 */
const MIN_HOURS_OPEN = 3;

/** З якої київської години дозволено закривати. Робочий день скінчився. */
const FROM_HOUR = 20;

/**
 * Година, після якої закриваємо будь-що.
 *
 * Об 23:00 навіть найпізніший об'їзд скінчився, а зміна, що переживе
 * північ, стане «вчорашньою» в усіх звітах — цього треба уникнути.
 */
const FORCE_HOUR = 23;

/**
 * Стеля тривалості. 16 годин — це вже не зміна, а забута кнопка.
 *
 * Потрібна окремо від FORCE_HOUR: зміну, відкриту о 04:00, о 20:00
 * закривати рано за годинником, але вона триває шістнадцяту годину.
 */
const FORCE_AFTER_HOURS = 16;

/**
 * Наскільки свіжою має бути остання точка, щоб вірити «машина стоїть».
 *
 * Рекордер пише точку раз на хвилину навіть на місці (IDLE_WRITE_MS),
 * тож живий планшет мовчить не довше кількох хвилин. Двадцять — з
 * запасом на буфер, який ще не долетів.
 */
const ALIVE_MINUTES = 20;

/**
 * Після скількох хвилин тиші вважаємо трек мертвим.
 *
 * Різниця між «стоїть у дворі» і «планшет вимкнули» з сервера не
 * видна ніяк — в обох випадках точок немає. Тому мертвий трек не
 * закриваємо о 20:00 разом з усіма: чекаємо до FORCE_HOUR, раптом
 * зв'язок повернеться і привезе буфер.
 */
const DEAD_TRACK_MINUTES = 60;

/**
 * Скільки хвилин тиші ПЕРЕД знайденою зупинкою роблять час ненадійним.
 *
 * Мовчання посеред дня саме собою нічого не псує: якщо після нього трек
 * показав і рух, і зупинку, ми бачили, як машина ставала. Псує саме
 * діра впритул до зупинки — тоді планшет ожив уже на місці, і момент
 * «стала» ми не бачили.
 *
 * 45 хвилин: коротша тиша зсуває оцінку щонайбільше на три чверті
 * години, і це прийнятна похибка для «коли скінчилась робота». Довша
 * означає, що час — це верхня межа, а не вимір, і людині треба про це
 * сказати. Реальний випадок 27.08: тиша 412 хв подавалася як
 * «машина стоїть з 16:05».
 */
const GAP_BEFORE_STOP_MINUTES = 45;

export type AutoCloseDecision = {
  shiftId: string;
  userId: string;
  name: string | null;
  startedAt: Date;
  /** null — не закриваємо; далі поля пояснюють, чому саме так */
  close: { endedAt: Date; source: LateCloseSource } | null;
  reason: string;
  lastPointAt: Date | null;
};

/**
 * Рішення по одній зміні — окремо від запису в базу.
 *
 * Так його можна прогнати на живих даних (`--dry`) і побачити, що
 * система збиралася зробити, не роблячи цього.
 */
export async function decideForShift(
  shift: { id: string; userId: string; startedAt: Date; user: { name: string | null } },
  now: Date
): Promise<AutoCloseDecision> {
  const base = {
    shiftId: shift.id,
    userId: shift.userId,
    name: shift.user.name,
    startedAt: shift.startedAt,
    lastPointAt: null as Date | null,
  };

  const hoursOpen = (now.getTime() - shift.startedAt.getTime()) / 3_600_000;
  if (hoursOpen < MIN_HOURS_OPEN) {
    return { ...base, close: null, reason: `відкрита лише ${hoursOpen.toFixed(1)} год` };
  }

  const hour = kyivHour(now);
  const overdue = hoursOpen >= FORCE_AFTER_HOURS;

  /**
   * Вікно FROM_HOUR…24 — київський вечір. Година «менша за 20» уночі
   * (0–5) сюди теж не потрапляє свідомо: зміну, що вже перевалила за
   * північ, добиває правило overdue, а не годинник.
   */
  const evening = hour >= FROM_HOUR;
  if (!evening && !overdue) {
    return { ...base, close: null, reason: `ще ${hour}:00 за Києвом, робочий день` };
  }

  const forced = hour >= FORCE_HOUR || overdue;

  /** Остання точка людини, а не зміни: буфер міг ще не долетіти. */
  const lastPoint = await prisma.trackPoint.findFirst({
    where: { userId: shift.userId, recordedAt: { gte: shift.startedAt } },
    orderBy: { recordedAt: "desc" },
    select: { recordedAt: true },
  });
  const withPoint = { ...base, lastPointAt: lastPoint?.recordedAt ?? null };

  const silentMin = lastPoint
    ? (now.getTime() - lastPoint.recordedAt.getTime()) / 60_000
    : Infinity;

  // --- Б. Трек мертвий: точок немає взагалі або давно ---
  if (silentMin > DEAD_TRACK_MINUTES) {
    if (!forced) {
      return {
        ...withPoint,
        close: null,
        reason: `трек мовчить ${Math.round(silentMin)} хв — чекаємо до ${FORCE_HOUR}:00`,
      };
    }
    return {
      ...withPoint,
      close: {
        // Час останньої точки чесніший за «зараз»: після неї ми про
        // людину нічого не знаємо, і приписувати їй години роботи,
        // яких ніхто не бачив, підстав немає.
        endedAt: lastPoint?.recordedAt ?? now,
        source: "AUTO_DEAD",
      },
      reason: lastPoint
        ? `трек обірвався о ${kyivTime(lastPoint.recordedAt)}`
        : "жодної точки за зміну",
    };
  }

  // --- А. Планшет живий: питаємо трек, чи машина стоїть ЗАРАЗ ---
  const tail = await guessWorkEnd(shift.id, { tailOnly: true });
  if (tail && silentMin <= ALIVE_MINUTES) {
    /**
     * Свіжі точки ще не означають цілого треку.
     *
     * Планшет міг мовчати півдня й ожити вже на місці зупинки — тоді
     * `tail.at` це момент, коли він озвався, а не коли людина
     * закінчила. Числа однакові, а знання за ними різні, і видавати
     * друге за перше не можна: у картці таке закриття читається як
     * вимір, і людина підтвердить його не глядячи.
     */
    const gappy = tail.gapBeforeMin >= GAP_BEFORE_STOP_MINUTES;
    return {
      ...withPoint,
      close: { endedAt: tail.at, source: gappy ? "AUTO_GAP" : "AUTO_GPS" },
      reason: gappy
        ? `трек мовчав ${tail.gapBeforeMin} хв і ожив о ${kyivTime(tail.at)} — час приблизний`
        : `стоїть ${tail.minutes} хв з ${kyivTime(tail.at)}`,
    };
  }

  // --- В. Машина ще їде ---
  if (!forced) {
    return {
      ...withPoint,
      close: null,
      reason: tail ? "точки свіжі, але буфер відстає" : `їде, зупинки ≥${STOP_MINUTES} хв немає`,
    };
  }
  return {
    ...withPoint,
    close: { endedAt: now, source: "AUTO_FORCED" },
    reason: overdue
      ? `зміна триває ${Math.round(hoursOpen)} год`
      : `${FORCE_HOUR}:00, а машина ще в дорозі`,
  };
}

/**
 * Один прохід по всіх відкритих змінах.
 *
 * Повертає ухвалені рішення — і закриті, і пропущені: воркеру потрібне
 * число для логу, а скрипту розбору — уся картина.
 */
export async function autoCloseStaleShifts(
  now: Date = new Date(),
  opts: { dryRun?: boolean } = {}
): Promise<AutoCloseDecision[]> {
  const open = await prisma.shift.findMany({
    where: { status: "OPEN" },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      startOdometer: true,
      user: { select: { name: true } },
    },
  });

  const decisions: AutoCloseDecision[] = [];

  for (const shift of open) {
    const decision = await decideForShift(shift, now);
    decisions.push(decision);
    if (!decision.close || opts.dryRun) continue;

    /**
     * Час зупинки може виявитися раніше за початок зміни (буфер привіз
     * точки минулого дня). Такий запис зробив би зміну від'ємної
     * тривалості — краще нічого не робити й лишити її людині.
     */
    if (decision.close.endedAt <= shift.startedAt) {
      decision.close = null;
      decision.reason = "час зупинки раніший за початок зміни — не чіпаємо";
      continue;
    }

    const closed = await prisma.$transaction((tx) =>
      closeWithoutPhoto(tx, shift, {
        endedAt: decision.close!.endedAt,
        source: decision.close!.source,
        notes: autoCloseNote(decision.close!.source, decision.close!.endedAt),
      })
    );

    await notify(decision, closed.gpsDistanceKm);
  }

  return decisions;
}

/**
 * Сповіщення в той самий канал, що й «трек не пишеться».
 *
 * Без тротла: автозакриття — подія разова, повторів у неї немає за
 * означенням (зміна після нього вже не OPEN).
 */
async function notify(decision: AutoCloseDecision, gpsKm: number | null): Promise<void> {
  const chatId = process.env.SYNC_ALERT_CHAT_ID;
  if (!chatId) return;

  const label: Record<string, string> = {
    AUTO_GPS: "за зупинкою в треку",
    AUTO_GAP: "час приблизний, трек із розривом",
    AUTO_DEAD: "трек мовчав",
    AUTO_FORCED: "за часом",
  };
  const source = decision.close!.source;

  await sendTelegramMessage(
    chatId,
    `🕗 <b>Зміну закрито автоматично</b> (${label[source] ?? source})\n` +
      `${decision.name ?? "Без імені"} — з ${kyivTime(decision.startedAt)} до ${kyivTime(decision.close!.endedAt)}\n` +
      `${decision.reason}\n` +
      (gpsKm != null ? `За треком ${gpsKm} км. ` : "") +
      `Одометр порахується зранку з фото наступної зміни.`
  ).catch(() => {});
}
