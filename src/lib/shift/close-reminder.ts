/**
 * Нагадування торговому закрити зміну — вдень, із сервера.
 *
 * Досі про відкриту зміну людині казав лише сам планшет, і лише ввечері:
 * локальні сповіщення о 19:30, 20:00 і 21:00 (`mobile/src/track/reminder.ts`).
 * О 20:00 про це дізнається офіс (`late-alert.ts`), а далі зміну добиває
 * автозакриття (`auto-close.ts`) — без фото одометра, і наступного дня її
 * доводиться звіряти. Але робочий день у багатьох закінчується о 15–16:
 * машина вже кілька годин у дворі, а зміна висить, і всі вечірні нагадування
 * приходять тоді, коли одометр уже не той.
 *
 * Тому два денні пуші: перший з 15:00, другий з 18:00 — і лише якщо є
 * підстава думати, що робота скінчилася: машина стоїть довше години або
 * трек не пишеться. Той, хто ще їде, не отримує нічого. Повідомлення —
 * питання («Ви вже завершили роботу?»), а не наказ: удень воно може влучити
 * в довгий обід, і людина просто змахне його.
 *
 * Місце в ланцюзі: 15:00 і 18:00 звідси → 19:30 / 20:00 / 21:00 локально в
 * планшеті → 20:00 офіс → з 20:00 автозакриття. Після 20:00 цей модуль
 * мовчить свідомо: вечірні нагадування вже є, і другий голос поверх них
 * привчив би вимкнути канал.
 *
 * Пуш іде з високим пріоритетом (`urgent`): без нього Android притримує
 * сповіщення до наступного пробудження планшета, який лежить у машині, — і
 * «о 15:00» прийшло б о 16:00 без звуку. Шум цим не росте: щонайбільше два
 * пуші на зміну.
 *
 * Компроміс, про який треба знати: «стоїть годину» о 15:05 може бути обідом,
 * що почався о 14:05. Це хибне спрацювання зʼїдає перший етап, але другий
 * лишається; поріг годину обрав власник — 40 хвилин автозакриття зачепили б
 * кожне довге розвантаження в клієнта.
 */

import { prisma } from "@/lib/prisma";
import { kyivHour, kyivTime } from "@/lib/date/kyiv";
import { getSyncState, setSyncState } from "@/lib/sync-ingest/context";
import { sendPushToUser } from "@/lib/push/send";
import { guessWorkEnd } from "@/lib/shift/late-close";

/** З якої київської години дозволено перше нагадування. */
export const FIRST_HOUR = 15;

/** З якої — друге: «заміряти ще раз о 18». */
export const SECOND_HOUR = 18;

/**
 * До якої години цей модуль узагалі говорить.
 *
 * З 20:00 вступають локальні нагадування планшета, сигнал офісу й
 * автозакриття (їхній спільний FROM_HOUR). Пуш звідси о 19:35 і локальне
 * сповіщення о 19:30 — це вже дубль, а не нагадування.
 */
export const UNTIL_HOUR = 20;

/**
 * Скільки годин зміна має бути відкритою, щоб її розглядати.
 *
 * Дзеркалить auto-close і late-alert: вечірній виїзд, відкритий о 14:50,
 * о 15:00 ще не забутий — ні стоянки, ні тиші в ньому просто не могло
 * назбиратися, а от «жодної точки» вже було б, і пуш пішов би одразу.
 */
const MIN_HOURS_OPEN = 3;

/**
 * Скільки хвилин без руху означає «нема руху».
 *
 * Година, а не 40 хвилин автозакриття: те працює ввечері, коли довга
 * зупинка майже напевно дім; удень 40 хвилин — це обід або розвантаження
 * в клієнта. Година теж не ідеал, але пуш — питання, і його можна змахнути.
 */
export const STANDING_MINUTES = 60;

/**
 * Наскільки свіжою має бути остання точка, щоб вірити «машина стоїть».
 * Той самий сенс і число, що в auto-close: живий планшет пише точку раз на
 * хвилину навіть на місці, двадцять — із запасом на буфер.
 */
const ALIVE_MINUTES = 20;

/**
 * Після скількох хвилин тиші вважаємо, що трек не пишеться.
 *
 * Те саме число, що в auto-close. Коротша тиша — найімовірніше буфер, що
 * ще не долетів (доведено 05.09: 352 точки за 2,5 год приїхали однією
 * пачкою). До того ж о 25 хв тиші `track/silence.ts` уже шле тихий пуш, що
 * піднімає службу: якщо він спрацював, трек оживе й нагадування не треба;
 * якщо ні — тиша дійде до години, і нагадування піде звідси.
 */
const DEAD_TRACK_MINUTES = 60;

/**
 * Найменший проміжок між першим і другим пушем.
 *
 * Без нього зміна, відкрита о 14:50, ставала б придатною о 17:50 (перший
 * етап) і о 18:05 отримувала б другий — два однакові пуші за чверть
 * години. Дві години — це «заміряти ще раз», а не «повторити».
 */
export const MIN_STAGE_GAP_MINUTES = 120;

export type ReminderStage = 1 | 2;

/**
 * Ключ у спільному сховищі станів — по людині, як у late-alert.
 *
 * Відкрита зміна на людину рівно одна (частковий унікальний індекс
 * `Shift_one_open_per_user`), тож рядків стільки, скільки торгових.
 * Значення — `<shiftId>|<етап>|<коли надіслано>`: інша зміна в значенні
 * означає «ще не нагадували», а час потрібен для проміжку між етапами.
 */
const reminderKey = (userId: string) => `shift:closeReminder:${userId}`;

type Mark = { shiftId: string; stage: ReminderStage; sentAt: Date };

function parseMark(value: string | null): Mark | null {
  if (!value) return null;
  const [shiftId, stageRaw, iso] = value.split("|");
  const stage = Number(stageRaw);
  const sentAt = new Date(iso ?? "");
  if (!shiftId || (stage !== 1 && stage !== 2) || Number.isNaN(sentAt.getTime())) return null;
  return { shiftId, stage, sentAt };
}

function stageForHour(hour: number): 0 | ReminderStage {
  if (hour >= UNTIL_HOUR) return 0;
  if (hour >= SECOND_HOUR) return 2;
  if (hour >= FIRST_HOUR) return 1;
  return 0;
}

export type ReminderInput = {
  /** Київська година. */
  hour: number;
  hoursOpen: number;
  /** Хвилин від останньої точки; Infinity — точок за зміну не було. */
  silentMin: number;
  /** Скільки хвилин машина стоїть на місці; null — їде або зупинки немає. */
  standingMin: number | null;
  /** Час початку стоянки для тексту — лише щоб причина читалася. */
  standingSince?: string;
  /** Який етап уже надіслано про ЦЮ зміну. */
  sentStage: 0 | ReminderStage;
  /** Хвилин від попереднього пуша; null, якщо його не було. */
  minutesSinceSent: number | null;
};

/**
 * Усе, що вирішується без треку: година, мітка, тривалість зміни, проміжок
 * між етапами. Повертає причину відмови або null, якщо треба дивитися трек.
 *
 * Окремо від `decideReminder` не заради краси: у живому проході це дозволяє
 * не читати тисячі точок там, де відповідь уже відома — а такий випадок
 * трапляється на кожному тіку решту дня після надісланого пуша.
 */
export function precheckReminder(
  i: Pick<ReminderInput, "hour" | "hoursOpen" | "sentStage" | "minutesSinceSent">
): { stage: ReminderStage | null; reason: string | null } {
  const current = stageForHour(i.hour);
  if (current === 0) {
    return {
      stage: null,
      reason:
        i.hour >= UNTIL_HOUR
          ? "вечір — далі локальні нагадування й автозакриття"
          : `ще ${i.hour}:00 за Києвом`,
    };
  }
  if (current <= i.sentStage) {
    return { stage: null, reason: `уже нагадували (етап ${i.sentStage})` };
  }
  if (i.hoursOpen < MIN_HOURS_OPEN) {
    return { stage: null, reason: `відкрита лише ${i.hoursOpen.toFixed(1)} год` };
  }
  if (i.sentStage > 0 && (i.minutesSinceSent == null || i.minutesSinceSent < MIN_STAGE_GAP_MINUTES)) {
    return { stage: null, reason: "замало часу після етапу 1" };
  }
  return { stage: current, reason: null };
}

/**
 * Рішення без бази — щоб перевірити всі гілки таблицею випадків.
 *
 * Порядок перевірок значущий: спершу все, що не залежить від треку, і лише
 * потім сам трек.
 */
export function decideReminder(i: ReminderInput): { stage: ReminderStage | null; reason: string } {
  const pre = precheckReminder(i);
  if (pre.reason != null) return { stage: null, reason: pre.reason };
  const current = pre.stage!;

  // --- Трек не пишеться: точок немає взагалі або давно ---
  if (i.silentMin >= DEAD_TRACK_MINUTES) {
    return {
      stage: current,
      // «Infinity хв» у логу читається як поламка — називаємо словами.
      reason: Number.isFinite(i.silentMin)
        ? `трек мовчить ${Math.round(i.silentMin)} хв`
        : "точок за зміну не було жодної",
    };
  }

  // --- Тиша коротша за годину: буфер міг ще не долетіти, судити рано ---
  if (i.silentMin > ALIVE_MINUTES) {
    return { stage: null, reason: `точки не свіжі (${Math.round(i.silentMin)} хв), буфер відстає` };
  }

  // --- Планшет живий: питання лише, чи стоїть машина ---
  if (i.standingMin != null && i.standingMin >= STANDING_MINUTES) {
    const since = i.standingSince ? ` з ${i.standingSince}` : "";
    return { stage: current, reason: `стоїть ${Math.round(i.standingMin)} хв${since}` };
  }
  if (i.standingMin != null) {
    return { stage: null, reason: `стоїть лише ${Math.round(i.standingMin)} хв` };
  }
  return { stage: null, reason: `їде, зупинки ≥${STANDING_MINUTES} хв немає` };
}

export type CloseReminderDecision = {
  shiftId: string;
  userId: string;
  name: string | null;
  startedAt: Date;
  lastPointAt: Date | null;
  /** Чи піде пуш у цьому проході — і якщо ні, то чому. */
  send: boolean;
  stage: ReminderStage | null;
  reason: string;
};

/**
 * Рішення по одній зміні — окремо від надсилання, як `decideForShift` в
 * auto-close: так його можна прогнати на живих даних, нічого не шлючи.
 */
export async function decideForShift(
  shift: { id: string; userId: string; startedAt: Date; user: { name: string | null } },
  now: Date
): Promise<CloseReminderDecision> {
  const base = {
    shiftId: shift.id,
    userId: shift.userId,
    name: shift.user.name,
    startedAt: shift.startedAt,
    lastPointAt: null as Date | null,
  };
  const skip = (reason: string): CloseReminderDecision => ({
    ...base,
    send: false,
    stage: null,
    reason,
  });

  const hour = kyivHour(now);
  const hoursOpen = (now.getTime() - shift.startedAt.getTime()) / 3_600_000;

  // Мітка про ЦЮ зміну; про попередню — не рахується.
  const mark = parseMark(await getSyncState(reminderKey(shift.userId)));
  const sentStage: 0 | ReminderStage = mark?.shiftId === shift.id ? mark.stage : 0;
  const minutesSinceSent =
    mark?.shiftId === shift.id ? (now.getTime() - mark.sentAt.getTime()) / 60_000 : null;

  /**
   * Спершу те, що не потребує треку. Якщо цієї години вже нагадували,
   * читати тисячі точок заради «уже нагадували» — марно.
   */
  const pre = precheckReminder({ hour, hoursOpen, sentStage, minutesSinceSent });
  if (pre.reason != null) return skip(pre.reason);

  /**
   * Немає адреси — немає й сенсу рахувати. Мітку не ставимо: якщо людина
   * оновить застосунок удень, нагадування ще має піти.
   */
  const token = await prisma.pushToken.findFirst({
    where: { userId: shift.userId, revokedAt: null },
    select: { id: true },
  });
  if (!token) return skip("немає адреси для сповіщень");

  /** Остання точка людини, а не зміни: буфер міг ще не долетіти. */
  const lastPoint = await prisma.trackPoint.findFirst({
    where: { userId: shift.userId, recordedAt: { gte: shift.startedAt } },
    orderBy: { recordedAt: "desc" },
    select: { recordedAt: true },
  });
  const withPoint = { ...base, lastPointAt: lastPoint?.recordedAt ?? null };
  const silentMin = lastPoint ? (now.getTime() - lastPoint.recordedAt.getTime()) / 60_000 : Infinity;

  // Зупинку питаємо лише в живого планшета — інакше відповідь і так «буфер».
  const tail = silentMin <= ALIVE_MINUTES ? await guessWorkEnd(shift.id, { tailOnly: true }) : null;
  const standingMin = tail ? (now.getTime() - tail.at.getTime()) / 60_000 : null;

  const decision = decideReminder({
    hour,
    hoursOpen,
    silentMin,
    standingMin,
    standingSince: tail ? kyivTime(tail.at) : undefined,
    sentStage,
    minutesSinceSent,
  });

  return { ...withPoint, send: decision.stage != null, stage: decision.stage, reason: decision.reason };
}

const BODY = "Ви вже завершили роботу? Не забудьте закрити зміну.";
const TITLE: Record<ReminderStage, string> = {
  1: "Зміна ще відкрита",
  2: "Зміна досі відкрита",
};

/**
 * Один прохід по відкритих змінах.
 *
 * Повертає всі рішення — і надіслані, і пропущені: воркеру потрібне число
 * для логу, а `--dry` у скрипті — уся картина без міток. Мітка незворотна,
 * і поставлена дослідженням вона зʼїла б справжнє нагадування.
 */
export async function remindUnclosedShifts(
  now: Date = new Date(),
  opts: { dryRun?: boolean } = {}
): Promise<CloseReminderDecision[]> {
  // Поза вікном — жодного читання бази: воркер стукає сюди щочверть години.
  if (stageForHour(kyivHour(now)) === 0) return [];

  const open = await prisma.shift.findMany({
    where: {
      status: "OPEN",
      startedAt: { lt: new Date(now.getTime() - MIN_HOURS_OPEN * 3_600_000) },
    },
    select: { id: true, userId: true, startedAt: true, user: { select: { name: true } } },
  });

  const decisions: CloseReminderDecision[] = [];

  for (const shift of open) {
    const decision = await decideForShift(shift, now);
    decisions.push(decision);
    if (!decision.send || !decision.stage || opts.dryRun) continue;

    await sendPushToUser(shift.userId, {
      title: TITLE[decision.stage],
      body: BODY,
      /**
       * Лише `screen` — без `reason`: те поле планшет читає як команду
       * підняти трек (notification-taps.ts), а це нагадування людині.
       */
      data: { screen: "/shift" },
      urgent: true,
    });

    await setSyncState(
      reminderKey(shift.userId),
      `${shift.id}|${decision.stage}|${now.toISOString()}`
    );
  }

  return decisions;
}
