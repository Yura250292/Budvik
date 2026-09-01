/**
 * Відправка буфера на сервер і пульс пристрою.
 *
 * Порт логіки з Kotlin-служби — з тими самими числами й тими самими
 * запобіжниками, бо кожен із них з'явився після конкретної втрати даних.
 */

import { staffApi, StaffApiError, APP_BUILD } from "@/api/staff";
import { readDeviceState } from "./device-state";
import { getRole } from "./state";
import { notifyNow } from "./notify";
import { cancelCloseReminders } from "./reminder";
import {
  bufferedCount,
  dropPoints,
  oldestPoints,
  type BufferedPoint,
} from "./db";
import {
  getLastError,
  getLastFix,
  getLastFlushAt,
  getLastHeartbeatAt,
  getMode,
  isShiftOpen,
  setLastError,
  setLastFlushAt,
  setLastHeartbeatAt,
  setShiftOpen,
} from "./state";

/**
 * Стеля пачки. Сервер відхиляє понад 500 одним 400, і колись через це поїхав
 * увесь буфер разом — а з ним і день маршруту. 200 — те саме число, що в
 * Kotlin-службі.
 */
const MAX_BATCH = 200;

/** Скільки чекати між відправками, якщо точок мало. */
const FLUSH_INTERVAL_MS = 120_000;
/** Стільки точок — і відправляємо, не чекаючи інтервалу. */
const FLUSH_AT_POINTS = 10;
const HEARTBEAT_INTERVAL_MS = 180_000;

/**
 * Замок відправки — і мить її останнього поступу.
 *
 * Самого замка виявилося мало. 01.09 у полі стояли три планшети з буфером у
 * сотні точок: пульс ішов, GPS писав, помилок не було жодної — а точки не
 * їхали. Відправка висіла на запиті, який не завершиться ніколи (у тій збірці
 * ще не було тайм-ауту), і тримала замок до смерті процесу. Тайм-аут додано,
 * але покладатися лише на нього не можна: будь-яке нове зависання всередині
 * циклу знову зачинило б буфер назавжди — і знову мовчки.
 *
 * Тому замок тепер із поступом: він чинний, лише поки відправка рухається.
 * Стоїть довше за FLUSH_STALL_MS — його забирає наступна спроба.
 */
let flushing = false;
let flushProgressAt = 0;
/** Хто тримає замок: зависла спроба не має знімати його з-під живої. */
let flushOwner = 0;

/**
 * Скільки відправка може стояти без поступу, перш ніж її визнають зависною.
 *
 * Утричі більше за межу однієї пачки (90 с у staffRequest): повільна сільська
 * мережа в неї вкладається, а запит, який не завершиться ніколи, — ні.
 */
const FLUSH_STALL_MS = 5 * 60_000;

/**
 * Крок відправки з власною межею часу — і з іменем кроку в помилці.
 *
 * Тайм-аут у staffRequest прикриває рівно одне: очікування відповіді сервера.
 * Але 01.09 відправка зависала й на 1.4.0, де той тайм-аут уже стояв, — отже
 * вішає щось поза ним. Найімовірніше сам запит: у React Native скасування
 * через AbortController не завжди доходить до з'єднання, яке застрягло на
 * рівні Android, і тоді обіцянка не завершується ніколи.
 *
 * Гонка нижче не скасовує зависле — воно лишається висіти в порожнечі й
 * помирає разом із процесом. Але вона робить дві речі, яких бракувало:
 * звільняє замок і НАЗИВАЄ крок. Наступного разу не доведеться гадати, у
 * якому з чотирьох місць стоїть відправка, — це буде написано в пульсі.
 */
function step<T>(what: string, ms: number, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    run().finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Крок «${what}» не завершився за ${Math.round(ms / 1000)} с`)),
        ms
      );
    }),
  ]);
}

/**
 * Скільки точок беремо в пачку ЗАРАЗ.
 *
 * Пачка на 200 точок — це десятки кілобайт, і на сільському каналі саме вона
 * застрягає першою, тоді як пульс на кілька сотень байтів проходить. Тому
 * після невдачі ріжемо пачку навпіл, а після вдалої — вертаємо стелю. Так
 * поганий зв'язок сповільнює відправку, замість того щоб зупиняти її зовсім.
 */
let batchSize = MAX_BATCH;
const MIN_BATCH = 25;

/**
 * Віддає буфер пачками, доки він не спорожніє.
 *
 * Видаляє РІВНО те, що сервер підтвердив, і аж після відповіді: у цю мить трек
 * пишеться далі, і зріз «перші N» зніс би свіжі точки, яких сервер не бачив.
 */
export async function flush(force = false): Promise<void> {
  /**
   * `force` — для виходу з акаунта: там після відправки буфер СТИРАЄТЬСЯ, тож
   * тихе повернення на замку означає не «відкладемо», а «день видалено».
   * Чекати п'ять хвилин на визнання замка зависним у цьому місці нема коли.
   */
  const stalled = flushing && (force || Date.now() - flushProgressAt >= FLUSH_STALL_MS);
  if (flushing && !stalled) return;

  const me = ++flushOwner;
  flushing = true;
  flushProgressAt = Date.now();

  /**
   * Запис стану теж під межею і теж мовчазний: пульс — це довідка, і
   * зависання на ній не має тримати саму відправку. Саме через те, що ці
   * рядки були звичайними await, помилка не встигала дійти до сервера.
   */
  const note = async (msg: string | null) => {
    try {
      await step("запис стану", 10_000, () => setLastError(msg));
    } catch {
      /* стан — не робота */
    }
  };
  const markSent = async () => {
    try {
      await step("позначка відправки", 10_000, () => setLastFlushAt(Date.now()));
    } catch {
      /* те саме */
    }
  };

  // Про зависання мусить дізнатися сервер: без цього рядка в пульсі не
  // лишається сліду, і причина знову виглядає як «немає зв'язку».
  if (stalled) await note("Відправка зависла — почато заново");

  try {
    for (;;) {
      const slice = await step("читання буфера", 20_000, () => oldestPoints(batchSize));
      if (slice.length === 0) break;

      /**
       * Фаза їде одна на пачку, а буфер може містити межу закриття зміни:
       * робочі точки і дорога додому лежать поруч. Тому ріжемо пачку на першій
       * зміні фази — інакше вечірні кілометри лягли б у робочий пробіг, і
       * рахунок дня розійшовся б із одометром. Хвіст забере наступний оберт.
       */
      const phase = slice[0]?.phase ?? undefined;
      const cut = slice.findIndex((p: BufferedPoint) => (p.phase ?? undefined) !== phase);
      const batch = cut === -1 ? slice : slice.slice(0, cut);

      try {
        await step("відправка пачки", 120_000, () =>
          staffApi.trackPoints({
            points: batch.map((p: BufferedPoint) => ({
              lat: p.lat,
              lng: p.lng,
              accuracyM: p.accuracyM ?? undefined,
              speedKmh: p.speedKmh ?? undefined,
              headingDeg: p.headingDeg ?? undefined,
              // Час пристрою, а не час відправки: на ньому тримається і дедуп на
              // сервері, і сам порядок точок у дні.
              recordedAt: p.recordedAt,
            })),
            phase: phase ?? undefined,
          })
        );
        await step("видалення надісланого", 20_000, () => dropPoints(batch));
        await note(null);
        // Пачка пройшла — канал тримає стелю, вертаємо її.
        batchSize = MAX_BATCH;
        /**
         * Позначка «остання вдала відправка» — після КОЖНОЇ пачки, а не коли
         * буфер спорожніє. Інакше довгий злив виглядає з сервера як цілковите
         * мовчання: рівно так і виглядав день, з якого це почалося.
         */
        await markSent();
        flushProgressAt = Date.now();
      } catch (e) {
        const status = e instanceof StaffApiError ? e.status : 0;

        /**
         * 401 обробляє сам клієнт (стирає токен і зупиняє службу) — тут лишаємо
         * буфер недоторканим: людина увійде знову, і день доїде.
         */
        if (status === 401) throw e;

        /**
         * Решта 4xx, крім 403 і 429, — це «сервер ніколи не прийме цю пачку».
         * Тримати її означало б забити буфер назавжди і втратити все, що після
         * неї. 403 віддає захист хостингу, 429 — стеля частоти: обидва минають.
         */
        if (status >= 400 && status < 500 && status !== 403 && status !== 429) {
          await step("видалення відхиленого", 20_000, () => dropPoints(batch)).catch(() => {});
          await note(`Пачку відхилено (${status})`);
          flushProgressAt = Date.now();
          continue;
        }

        // Не долетіло — наступного разу пробуємо меншою пачкою.
        batchSize = Math.max(MIN_BATCH, Math.floor(batchSize / 2));
        await note(e instanceof Error ? e.message : String(e));
        return; // мережа або сервер — спробуємо наступного разу
      }
    }
    await markSent();
  } finally {
    // Замок знімає лише його власник: зависла спроба, яка нарешті відповіла,
    // не має відчиняти буфер з-під тієї, що працює просто зараз.
    if (flushOwner === me) flushing = false;
  }
}

/** Чи час відправляти: або назбиралося, або минув інтервал. */
export async function maybeFlush(): Promise<void> {
  const [count, last] = await Promise.all([bufferedCount(), getLastFlushAt()]);
  if (count === 0) return;
  if (count >= FLUSH_AT_POINTS || Date.now() - last >= FLUSH_INTERVAL_MS) {
    await flush();
  }
}

/**
 * Пульс: сервер має бачити живий пристрій навіть тоді, коли точок немає.
 *
 * Без нього мовчання планшета неможливо відрізнити від «людина не виїхала».
 * Відповідь заразом звіряє локальний стан із серверним: зміну міг закрити офіс,
 * і застосунок мусить дізнатися про це, а не малювати своє.
 */
export async function heartbeat(force = false): Promise<{ shouldTrack: boolean } | null> {
  const last = await getLastHeartbeatAt();
  if (!force && Date.now() - last < HEARTBEAT_INTERVAL_MS) return null;

  const [buffered, mode, shiftOpen, fix, lastError, lastSync, device] = await Promise.all([
    bufferedCount(),
    getMode(),
    isShiftOpen(),
    getLastFix(),
    getLastError(),
    getLastFlushAt(),
    readDeviceState(),
  ]);

  try {
    const pulse = await staffApi.heartbeat({
      reportedAt: new Date().toISOString(),
      tracking: mode !== null,
      mode: mode ?? "NONE",
      shiftOpen,
      buffered,
      lastFixAt: fix ? new Date(fix.at).toISOString() : undefined,
      lastFixAccuracyM: fix?.accuracyM ?? undefined,
      lastSyncAt: lastSync ? new Date(lastSync).toISOString() : undefined,
      lastError: lastError ?? undefined,
      /**
       * Стан пристрою — заради відповіді на питання «чому трек обірвався».
       * Ті самі значення, що шле Kotlin-трекер, щоб адмінка не мала двох шкал.
       */
      locationPermission: device.locationPermission,
      locationMode: device.locationMode,
      batteryPct: device.batteryPct ?? undefined,
      batteryOptimized: device.batteryOptimized ?? undefined,
      appVersion: APP_BUILD,
    });
    await setLastHeartbeatAt(Date.now());

    // Правда про зміну — серверна: її міг закрити офіс, поки планшет був поза мережею.
    if (typeof pulse?.shiftOpen === "boolean" && pulse.shiftOpen !== shiftOpen) {
      await setShiftOpen(pulse.shiftOpen);

      /**
       * Зміну закрили не з цього пристрою — офіс або автозакриття.
       *
       * Без цієї гілки служба лишалася б у робочому режимі з карткою «зміна
       * відкрита»: людина бачила б одне, а сервер знав інше, і трек далі
       * писався б як робочий. Тому переводимо запис у режим «після зміни» й
       * кажемо людині, що сталося — інакше вона дізнається про це аж тоді,
       * коли не зійдеться пробіг.
       *
       * Водія не чіпаємо: він зміну не відкриває взагалі, і його трек іде від
       * входу до виходу (див. controller.onStaffLogin).
       */
      if (!pulse.shiftOpen) {
        const role = await getRole();
        if (role !== "DRIVER") {
          const { endShiftTracking } = await import("./controller");
          await endShiftTracking();
          // Нагадування «зміна ще відкрита» тепер брехали б: її вже
          // закрито, і о 19:30 людина отримала б спонукання зробити те,
          // що зроблено.
          await cancelCloseReminders();
          await notifyNow(
            "Зміну закрито",
            "Зміну закрито не з цього пристрою. Зранку сфотографуйте одометр — інакше пробіг порахується за GPS."
          );
        }
      }
    }
    return { shouldTrack: pulse?.shouldTrack ?? false };
  } catch {
    // Пульс — довідка, а не робота: його втрата не має нічого ламати.
    return null;
  }
}
