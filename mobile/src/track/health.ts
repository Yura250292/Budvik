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

import * as Location from "expo-location";
import { TRACK_TASK } from "./task-name";
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

export type HealthResult = "не-пишемо" | "свіжо" | "перепідписались" | "зарано-повторювати";

export async function ensureFreshFixes(): Promise<HealthResult> {
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
  lastRestartAt = Date.now();

  const minutes = Number.isFinite(silentMs) ? Math.round(silentMs / 60_000) : null;
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
