/**
 * Чи справді йде запис — і перепідписка, коли приймач замовк.
 *
 * Окремо від watchdog.ts, і причина конкретна: `expo-background-task` жорстко
 * ставить WorkManager-обмеження `NetworkType.CONNECTED` (див. його
 * BackgroundTaskScheduler.kt), тобто той сторож НЕ прокидається без мережі.
 * А саме там, де мережі немає — у селі за сімдесят кілометрів — трек і
 * пропадає «і далі не відновлюється».
 *
 * Тут перевірка, яка мережі не потребує взагалі. Вона ловить стан, який
 * `hasStartedLocationUpdatesAsync()` не бачить: підписка формально жива, а
 * фіксів немає годинами. Для системи це «все гаразд», для людини — дірка в
 * маршруті.
 *
 * Ліки — перепідписка: зупинити й запустити оновлення наново. Зависла підписка
 * на провайдер від цього оживає, а якщо трек ішов нормально, перезапуск
 * коштує однієї пропущеної точки.
 */

import { AppState } from "react-native";
import * as Location from "expo-location";
import { TRACK_TASK } from "./task-name";
import { exactGuardStatus } from "@modules/track-guard";
import { getLastFix, getLastFixAt, getMode, setLastError } from "./state";

/**
 * Скільки тиші вважати збоєм.
 *
 * У робочому режимі фікс іде раз на 20 с, тож п'ять хвилин — це вже не
 * «погано видно небо», а зупинений приймач. Після зміни інтервал три хвилини,
 * тому й поріг більший.
 */
const STALE_MS: Record<"SHIFT" | "AFTER_SHIFT", number> = {
  SHIFT: 5 * 60_000,
  AFTER_SHIFT: 15 * 60_000,
};

/** Щоб перепідписка не крутилася по колу, якщо приймач мовчить із фізичних причин. */
const MIN_RETRY_MS = 5 * 60_000;
let lastRestartAt = 0;

export type HealthResult =
  | "не-пишемо"
  | "свіжо"
  | "перепідписались"
  | "зарано-повторювати"
  | "чекаємо-вікна";

/**
 * Скільки часу після спрацювання будильника вважати вікном дозволу.
 *
 * Android 12+ забороняє піднімати службу переднього плану з фону, але лишив
 * винятки, і спрацювання ТОЧНОГО будильника — один із них. Вікно коротке:
 * система дає його на час обробки й трохи по тому. Хвилина — свідомо
 * обережна оцінка; помилитися тут краще в бік «не чіпати».
 */
const ALARM_WINDOW_MS = 60_000;

/**
 * Чи маємо ми зараз право підняти службу — і чи можна тому ЧІПАТИ підписку.
 *
 * Це найдорожча перевірка у файлі, і ось чому. Перепідписка — це зупинка й
 * запуск наново. Зупинка вдається завжди, запуск із фону — ніколи. Тобто
 * лікування, застосоване не в тому вікні, ГАРАНТОВАНО вбиває трек до миті,
 * коли людина відкриє застосунок руками.
 *
 * За 14 днів до 09.09.2026 у журналі п'ять `start_failed`, і всі п'ять — це
 * «Couldn't start the foreground». Жодного іншого приводу впасти в запуску не
 * було взагалі: сто відсотків падінь — саме цей випадок. Перепідписок за той
 * самий час 54, у всіх семи планшетів. Тобто сторож, покликаний лікувати
 * мовчазний приймач, регулярно доробляв за нього роботу до кінця.
 *
 * Три законні вікна:
 *   • передній план — дозволено завжди;
 *   • будильник щойно спрацював (див. TrackAlarmReceiver.kickJs);
 *   • пробудження сповіщенням — там своє тимчасове помилування від системи,
 *     і викликач каже про це сам.
 *
 * У збірках без нативного модуля (до 1.6.1) лишається саме передній план — і
 * це строго краще за сьогоднішнє «спробувати й убити».
 */
async function mayRestartService(pushWindow: boolean): Promise<boolean> {
  if (AppState.currentState === "active") return true;
  if (pushWindow) return true;
  const guard = exactGuardStatus();
  if (!guard.available || !guard.lastFiredAt) return false;
  return Date.now() - guard.lastFiredAt < ALARM_WINDOW_MS;
}

export async function ensureFreshFixes(
  opts: { pushWindow?: boolean } = {}
): Promise<HealthResult> {
  const mode = await getMode();

  /**
   * Порожній режим — це НЕ завжди «людина не на зміні».
   *
   * `startTracking` обнуляє режим, коли запуск служби впав, — і 01.09 планшет
   * простояв так із відкритою зміною: сторож раз на чверть години пробував
   * підняти запис із фону, де Android цього не дозволяє, а ця перевірка,
   * єдина, що працює на передньому плані, виходила отут першим рядком і не
   * робила нічого. Тобто людина відкривала застосунок, дивилася на нього — і
   * він не лікувався.
   */
  if (!mode) {
    if (Date.now() - lastRestartAt < MIN_RETRY_MS) return "зарано-повторювати";
    lastRestartAt = Date.now();
    const { ensureRecording } = await import("./controller");
    return (await ensureRecording().catch(() => false)) ? "перепідписались" : "не-пишемо";
  }

  // Пізніше з двох джерел: мітка фікса або час останньої записаної точки.
  // Друге не бреше за побудовою — див. getLastFixAt.
  const fixAt = await getLastFixAt();
  const silentMs = fixAt != null ? Date.now() - fixAt : Infinity;
  if (silentMs < STALE_MS[mode]) return "свіжо";

  if (Date.now() - lastRestartAt < MIN_RETRY_MS) return "зарано-повторювати";

  const minutes = Number.isFinite(silentMs) ? Math.round(silentMs / 60_000) : null;

  /**
   * Не маємо права підняти службу — не чіпаємо ту, що є.
   *
   * Мовчазний приймач — це погано, але підписка, яку зупинили й не змогли
   * запустити, — це гарантовано мертвий день. Наступне спрацювання будильника
   * (щонайпізніше за чверть години) прийде вже у вікні дозволу й полікує те
   * саме, нічого не ламаючи. Різниця в ціні помилки: тут ми ризикуємо
   * п'ятнадцятьма хвилинами, там — усім, що лишилося до вечора.
   *
   * Причина їде в пульс: із сервера «чекаємо вікна» і «перепідписались»
   * мусять розрізнятися, інакше розбір знову впреться в те, що прапорці
   * бездоганні, а точок немає.
   */
  if (!(await mayRestartService(opts.pushWindow === true))) {
    await setLastError(
      minutes === null
        ? "жодного фікса — чекаємо вікна дозволу"
        : `приймач мовчав ${minutes} хв — чекаємо вікна дозволу`
    );
    return "чекаємо-вікна";
  }

  lastRestartAt = Date.now();
  await setLastError(
    minutes === null ? "жодного фікса — перепідписка" : `приймач мовчав ${minutes} хв — перепідписка`
  );

  try {
    // Зупинка обов'язкова: повторний start поверх живої підписки нових
    // параметрів не підхоплює й провайдер лишається тим самим зависшим.
    if (await Location.hasStartedLocationUpdatesAsync(TRACK_TASK)) {
      await Location.stopLocationUpdatesAsync(TRACK_TASK);
    }
    const { startTracking } = await import("./controller");
    await startTracking(mode);

    /**
     * Разова проба — щоб наступного разу не гадати.
     *
     * 02.09 планшет годину мовчав при живій підписці, і з сервера неможливо
     * було відрізнити «приймач не бачить неба» від «система не віддає
     * координат саме нашому застосунку». Пряма проба відповідає на це одним
     * рядком: або приходить координата з похибкою, або приходить помилка
     * системи — і те, й те їде в пульс.
     */
    const { setStartError } = await import("./state");
    try {
      const probe = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      await setStartError(
        `проба приймача: ±${Math.round(probe.coords.accuracy ?? -1)} м`
      );
    } catch (e) {
      await setStartError(`проба приймача впала: ${e instanceof Error ? e.message : String(e)}`);
    }
    return "перепідписались";
  } catch (e) {
    await setLastError(e instanceof Error ? e.message : String(e));
    return "перепідписались";
  }
}
