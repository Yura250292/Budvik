/**
 * Пульт «чому не пишеться»: стан кожного планшета одним запитом.
 *
 * Навіщо окремий модуль, коли є `diagnose()`. Той відповідає на питання
 * «сказати офісу чи ні» і повертає ОДНУ фразу — цього досить для Telegram,
 * але замало, щоб зрозуміти причину. Місяць розборів показав, що причину
 * називають не слова, а три числа, яких у тій фразі немає:
 *
 *   contextStartedAt — коли піднявся процес застосунку;
 *   fixBatches       — скільки разів служба покликала застосунок від того часу;
 *   contextPoints    — скільки точок із тих викликів дійшло до буфера.
 *
 * Саме вони 08.09 за хвилину відповіли на питання, на яке пульс не відповідав
 * ніколи: «служба запущена, підписка є, дозвіл Завжди, батарея не обмежує» —
 * і нуль викликів за три години. Тобто ламається не застосунок, а доставка
 * координат від системи до нього, і жодна перевірка стану цього не покаже.
 *
 * Тому тут поруч лежать: факти пристрою, факти сервера (точки), журнал подій
 * і ОДИН висновок із дією. Один модуль на три поверхні — екран, воркер і
 * скрипт у терміналі, — щоб вони не розходилися в діагнозі.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart, kyivDayEnd } from "@/lib/date/kyiv";
import { diagnose } from "@/lib/track/diagnosis";

/** Скільки хвилин без виклику служби вважати, що вона не кличе застосунок. */
const NO_CALL_MIN = 12;
/** Скільки хвилин без точки при відкритій зміні — це вже втрата дня. */
const SILENT_MIN = 20;
/** Перші хвилини зміни не судимо: приймач шукає небо. */
const GRACE_MIN = 10;
/** Пульс раз на чверть години; удвічі більше — планшет замовк. */
const BEAT_SILENT_MIN = 35;

export type HealthState = "OK" | "WARN" | "DEAD" | "IDLE";

export type TabletHealth = {
  userId: string;
  name: string;
  role: string;
  /** Зміна просто зараз: відкрита, скільки хвилин, коли почалась. */
  shift: { id: string; startedAt: string; minutes: number } | null;
  points: { today: number; lastAt: string | null; lastMinutesAgo: number | null };
  beat: BeatView | null;
  /** Журнал самого пристрою за сьогодні — свіжіші зверху. */
  events: { at: string; kind: string; note: string | null }[];
  state: HealthState;
  /** Що відбувається — однією фразою, без термінів. */
  verdict: string;
  /** Що зробити просто зараз. Порожньо, коли робити нічого не треба. */
  action: string | null;
};

type BeatView = {
  at: string;
  minutesAgo: number;
  appVersion: string | null;
  osVersion: string | null;
  device: string | null;
  tracking: boolean;
  subscribed: boolean | null;
  mode: string | null;
  buffered: number;
  lastFixAt: string | null;
  lastFixMinutesAgo: number | null;
  lastFixAccuracyM: number | null;
  lastSyncAt: string | null;
  lastError: string | null;
  locationPermission: string | null;
  locationMode: string | null;
  batteryOptimized: boolean | null;
  batteryPct: number | null;
  watchdogAt: string | null;
  watchdogStatus: string | null;
  /** Три числа, заради яких усе це існує. */
  contextStartedAt: string | null;
  contextMinutes: number | null;
  fixBatches: number | null;
  contextPoints: number | null;
};

/** «1 точка», «3 точки», «12 точок» — інакше пульт читається як машинний лог. */
function points(n: number): string {
  const t = n % 10;
  const h = n % 100;
  if (t === 1 && h !== 11) return `${n} точка`;
  if (t >= 2 && t <= 4 && (h < 12 || h > 14)) return `${n} точки`;
  return `${n} точок`;
}

const minutesSince = (d: Date | null | undefined, now: number): number | null =>
  d ? Math.max(0, Math.round((now - d.getTime()) / 60_000)) : null;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export async function trackHealthBoard(day?: string): Promise<{
  day: string;
  now: string;
  tablets: TabletHealth[];
}> {
  const theDay = day ?? kyivDate(new Date());
  const from = kyivDayStart(theDay);
  const to = kyivDayEnd(theDay);
  const now = Date.now();

  /**
   * Кого показуємо: у кого є планшет АБО зміна сьогодні.
   *
   * Не «усі торгові»: у списку є офісні імена з «Ответственный» 1С, і
   * порожні рядки про них перетворили б пульт на смітник (див. пам'ять про
   * польових торгових проти офісу).
   */
  const users = await prisma.user.findMany({
    where: {
      role: { in: ["SALES", "DRIVER"] },
      OR: [
        { deviceTokens: { some: { revokedAt: null } } },
        { shifts: { some: { startedAt: { gte: from, lte: to } } } },
      ],
    },
    select: { id: true, name: true, email: true, role: true },
  });

  const tablets: TabletHealth[] = [];

  for (const u of users) {
    const [shift, beatRow, events, pointAgg] = await Promise.all([
      prisma.shift.findFirst({
        where: { userId: u.id, status: "OPEN" },
        orderBy: { startedAt: "desc" },
        select: { id: true, startedAt: true },
      }),
      prisma.deviceHeartbeat.findFirst({ where: { userId: u.id }, orderBy: { at: "desc" } }),
      prisma.trackEvent.findMany({
        where: { userId: u.id, at: { gte: from, lte: to } },
        orderBy: { at: "desc" },
        take: 25,
        select: { at: true, kind: true, note: true },
      }),
      prisma.trackPoint.aggregate({
        where: { userId: u.id, recordedAt: { gte: from, lte: to } },
        _count: { _all: true },
        _max: { recordedAt: true },
      }),
    ]);

    const pointsToday = pointAgg._count._all;
    const lastPointAt = pointAgg._max.recordedAt;
    const lastPointMinutesAgo = minutesSince(lastPointAt, now);
    const shiftMinutes = shift ? Math.round((now - shift.startedAt.getTime()) / 60_000) : null;

    const beat: BeatView | null = beatRow
      ? {
          at: beatRow.at.toISOString(),
          minutesAgo: minutesSince(beatRow.at, now) ?? 0,
          appVersion: beatRow.appVersion,
          osVersion: beatRow.osVersion,
          device: beatRow.deviceName ?? beatRow.osBuild ?? null,
          tracking: beatRow.tracking,
          subscribed: beatRow.subscribed,
          mode: beatRow.mode,
          buffered: beatRow.buffered,
          lastFixAt: iso(beatRow.lastFixAt),
          lastFixMinutesAgo: minutesSince(beatRow.lastFixAt, now),
          lastFixAccuracyM: beatRow.lastFixAccuracyM,
          lastSyncAt: iso(beatRow.lastSyncAt),
          lastError: beatRow.lastError,
          locationPermission: beatRow.locationPermission,
          locationMode: beatRow.locationMode,
          batteryOptimized: beatRow.batteryOptimized,
          batteryPct: beatRow.batteryPct,
          watchdogAt: iso(beatRow.watchdogAt),
          watchdogStatus: beatRow.watchdogStatus,
          contextStartedAt: iso(beatRow.contextStartedAt),
          /**
           * Вік контексту рахуємо ДО МИТІ ПУЛЬСУ, а не до «зараз».
           *
           * `fixBatches` описує стан на момент відправки пульсу, і міряти його
           * теперішнім часом означає обмовляти справний планшет: застосунок,
           * який щойно піднявся і чесно доповів «викликів 0», через півгодини
           * читався б як «пів години живе і жодного виклику». Саме так пульт
           * і вчинив з Передрієм за двадцять хвилин після його підйому.
           */
          contextMinutes:
            beatRow.contextStartedAt
              ? Math.max(
                  0,
                  Math.round((beatRow.at.getTime() - beatRow.contextStartedAt.getTime()) / 60_000)
                )
              : null,
          fixBatches: beatRow.fixBatches,
          contextPoints: beatRow.contextPoints,
        }
      : null;

    const { state, verdict, action } = judge({
      shiftOpen: !!shift,
      shiftMinutes,
      pointsToday,
      lastPointMinutesAgo,
      beat,
      hasDevice: true,
    });

    tablets.push({
      userId: u.id,
      name: u.name ?? u.email ?? "—",
      role: u.role,
      shift: shift
        ? { id: shift.id, startedAt: shift.startedAt.toISOString(), minutes: shiftMinutes ?? 0 }
        : null,
      points: {
        today: pointsToday,
        lastAt: iso(lastPointAt),
        lastMinutesAgo: lastPointMinutesAgo,
      },
      beat,
      events: events.map((e) => ({ at: e.at.toISOString(), kind: e.kind, note: e.note })),
      state,
      verdict,
      action,
    });
  }

  /** Найгірші зверху: пульт читають згори вниз і закривають на середині. */
  const rank: Record<HealthState, number> = { DEAD: 0, WARN: 1, OK: 2, IDLE: 3 };
  tablets.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name, "uk"));

  return { day: theDay, now: new Date().toISOString(), tablets };
}

/**
 * Один висновок і одна дія.
 *
 * Порядок перевірок — від найдорожчого до найдешевшого, і він значущий:
 * перше правило, що спрацювало, і є діагнозом. Найдорожче тут — не «немає
 * дозволу» (це видно й так), а стан, у якому ВСЕ виглядає справним.
 */
export function judge(input: {
  shiftOpen: boolean;
  shiftMinutes: number | null;
  pointsToday: number;
  lastPointMinutesAgo: number | null;
  beat: BeatView | null;
  hasDevice: boolean;
}): { state: HealthState; verdict: string; action: string | null } {
  const { shiftOpen, shiftMinutes, pointsToday, lastPointMinutesAgo, beat } = input;

  if (!shiftOpen) {
    return {
      state: "IDLE",
      verdict: pointsToday > 0 ? `Зміну закрито, за день ${points(pointsToday)}` : "Зміну не відкрито",
      action: null,
    };
  }

  if (shiftMinutes != null && shiftMinutes < GRACE_MIN && pointsToday === 0) {
    return { state: "OK", verdict: "Зміна щойно відкрита — чекаємо перші точки", action: null };
  }

  /** Точки йдуть — далі пояснювати нема чого. */
  const fresh = lastPointMinutesAgo != null && lastPointMinutesAgo <= SILENT_MIN;
  if (fresh) {
    if (beat?.locationMode === "OFF") {
      return {
        state: "WARN",
        verdict: `Пише (${points(pointsToday)}), але геолокація вимкнена — маршрут по вежах`,
        action: "Увімкнути геолокацію на планшеті: похибка зараз сотні метрів",
      };
    }
    if (beat?.locationPermission && beat.locationPermission !== "ALWAYS") {
      return {
        state: "WARN",
        verdict: `Пише (${points(pointsToday)}), але дозвіл не «Завжди»`,
        action: "Поставити «Дозволяти завжди» — інакше запис стане, щойно згасне екран",
      };
    }
    /**
     * Батарея, що «оптимізує» застосунок, — головна причина дір у треку на
     * оболонці Lenovo, і видно її ЛИШЕ поки трек ще живий. Коли він уже
     * помер, це виглядає як усе інше, тож попереджаємо заздалегідь.
     */
    if (beat?.batteryOptimized) {
      return {
        state: "WARN",
        verdict: `Пише (${points(pointsToday)}), але система обмежує застосунок у фоні`,
        action: "Зняти обмеження батареї: саме через нього трек рветься на години",
      };
    }
    const waiting = beat && beat.buffered > 0 ? `, ${points(beat.buffered)} чекають відправки` : "";
    return { state: "OK", verdict: `Пише — ${points(pointsToday)} за день${waiting}`, action: null };
  }

  if (!beat) {
    return {
      state: "DEAD",
      verdict: "Планшет не звітував жодного разу — стара збірка або застосунок не запускався",
      action: "Поставити свіжу збірку: без неї причину не видно взагалі",
    };
  }

  /**
   * Найважливіше правило пульта — і те, якого не було цілий місяць.
   *
   * Обидві умови міряються МОМЕНТОМ ПУЛЬСУ: застосунок прожив достатньо, щоб
   * служба встигла покликати його, і не покликала жодного разу. Судити про це
   * теперішнім часом не можна — числа описують мить відправки, а не зараз.
   */
  const contextAlive = beat.contextMinutes != null && beat.contextMinutes >= NO_CALL_MIN;
  const noCalls = beat.fixBatches === 0;
  if (contextAlive && noCalls && beat.tracking) {
    return {
      state: "DEAD",
      verdict:
        `Служба запущена, а координат не віддає: за ${beat.contextMinutes} хв ` +
        `життя застосунку система покликала його 0 разів`,
      action: "Хай відкриє застосунок — із переднього плану служба піднімається завжди",
    };
  }

  if (beat.locationPermission === "DENIED") {
    return { state: "DEAD", verdict: "Дозволу на локацію немає", action: "Видати дозвіл у застосунку" };
  }
  if (beat.locationMode === "OFF") {
    return {
      state: "DEAD",
      verdict: "Геолокацію вимкнено перемикачем",
      action: "Увімкнути місцезнаходження на планшеті",
    };
  }
  if (!beat.tracking) {
    return {
      state: "DEAD",
      verdict: "Запис вимкнено при відкритій зміні",
      action: "Хай відкриє застосунок — запис підніметься сам",
    };
  }

  if (beat.buffered > 0) {
    return {
      state: "WARN",
      verdict: `Пише, але не відправляє: у планшеті ${points(beat.buffered)}`,
      action: "Нічого — доїдуть самі, щойно буде зв'язок",
    };
  }

  if (beat.minutesAgo > BEAT_SILENT_MIN) {
    return {
      state: "DEAD",
      verdict:
        `Планшет мовчить ${beat.minutesAgo} хв` +
        (lastPointMinutesAgo != null ? `, точок немає ${Math.min(lastPointMinutesAgo, shiftMinutes ?? lastPointMinutesAgo)} хв` : ""),
      action: "Подзвонити: хай відкриє застосунок. Маршрут може лежати в планшеті й доїде одразу",
    };
  }

  return {
    state: "DEAD",
    verdict:
      `Точок немає ${lastPointMinutesAgo != null ? Math.min(lastPointMinutesAgo, shiftMinutes ?? lastPointMinutesAgo) : "?"} хв` +
      (beat.lastFixMinutesAgo != null ? `, приймач мовчить ${beat.lastFixMinutesAgo} хв` : ""),
    action: "Хай відкриє застосунок",
  };
}

/** Одна фраза для Telegram — щоб пульт і сповіщення не розходилися. */
export function headline(t: TabletHealth): string | null {
  return diagnose({
    hasDevice: true,
    shiftOpen: !!t.shift,
    beat: t.beat
      ? {
          minutesAgo: t.beat.minutesAgo,
          tracking: t.beat.tracking,
          buffered: t.beat.buffered,
          lastFixMinutesAgo: t.beat.lastFixMinutesAgo,
          lastFixAccuracyM: t.beat.lastFixAccuracyM,
          locationPermission: t.beat.locationPermission,
          locationMode: t.beat.locationMode,
          batteryOptimized: t.beat.batteryOptimized,
          lastError: t.beat.lastError,
        }
      : null,
    lastPointMinutesAgo: t.points.lastMinutesAgo,
    shiftMinutes: t.shift?.minutes ?? null,
    hasPointsInShift: t.points.today > 0,
  });
}
