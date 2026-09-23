/**
 * Геолокація для маршрутних питань помічнику.
 *
 * Власник просив, щоб маршрут у чаті починався там, де він зараз. Сервер
 * уміє від цього рахувати (src/lib/assistant/here.ts); тут — лише як
 * дістати координати з пристрою, не набридаючи.
 *
 * Запит дозволу на місце браузер показує при першому ж зверненні, тому
 * звертаємося лише з маршрутним питанням: торговий, що питає «скільки
 * винен Кунанець», не мусить бачити вікна про геолокацію. Коли дозвіл уже
 * є й позиція в цій вкладці вже бралася, надсилаємо її і з наступними
 * повідомленнями — «додай ще Яцьківа» продовжує той самий маршрут, і
 * старт не має стрибнути на склад посеред розмови.
 *
 * Нічого не блокує: немає геолокації, відмова, таймаут — повідомлення йде
 * без координат, і сервер чесно скаже, звідки рахував.
 */

export type DeviceHere = { lat: number; lng: number; accuracy: number; at: number };

/** Маршрутне питання — або прохання почати «від мене». */
const ROUTE_Q = /маршрут|об.?їзд|звідси|геолок|від\s+мене|де\s+я\b|поїхат|доїхат|навігац|обʼїхат|об'їхат/i;

/** Скільки чекаємо на відповідь пристрою, мс. */
const ASK_TIMEOUT_MS = 5_000;
/** Позиція, свіжіша за це, береться з кешу без нового звернення. */
const REUSE_MS = 2 * 60_000;

let last: DeviceHere | null = null;

export function isRouteQuestion(text: string): boolean {
  return ROUTE_Q.test(text);
}

function ask(timeoutMs: number): Promise<DeviceHere | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: DeviceHere | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    // Деякі WebView не викликають жодного колбека — власний запобіжник.
    const guard = setTimeout(() => finish(null), timeoutMs + 500);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          clearTimeout(guard);
          last = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp || Date.now() };
          finish(last);
        },
        () => {
          clearTimeout(guard);
          finish(null);
        },
        { enableHighAccuracy: true, maximumAge: REUSE_MS, timeout: timeoutMs }
      );
    } catch {
      clearTimeout(guard);
      finish(null);
    }
  });
}

/** Координати для цього повідомлення — або null, якщо вони йому не потрібні чи недоступні. */
export async function hereForMessage(text: string): Promise<DeviceHere | null> {
  const route = isRouteQuestion(text);
  // Не маршрутне питання й позиції ще не брали — пристрій не чіпаємо.
  if (!route && !last) return null;
  if (last && Date.now() - last.at < REUSE_MS) return last;
  return ask(route ? ASK_TIMEOUT_MS : 2_000);
}
