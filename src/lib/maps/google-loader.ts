/**
 * Завантажувач Google Maps JavaScript API.
 *
 * Свій, а не пакет @googlemaps/js-api-loader: усе, що від нього потрібно, —
 * один тег script і обіцянка, що він доїхав. Зайва залежність у застосунку,
 * який ставлять руками на планшети, це ще один привід збірці зламатися.
 *
 * Ключ приходить змінною середовища. Немає ключа — немає карти Google, і
 * екран лишається на нашій (Leaflet + OpenStreetMap). Це не запобіжник на
 * випадок помилки, а робочий режим: до появи ключа все працює як раніше.
 */

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";

/** Чи можемо взагалі малювати карту Google. */
export const hasGoogleMaps = KEY.length > 0;

/**
 * Обіцянка одна на сторінку.
 *
 * Google дозволяє завантажити свій скрипт РІВНО раз: другий тег кидає
 * попередження й ламає бібліотеку. Тому проміс кешуємо, а не створюємо
 * щоразу, коли монтується карта.
 */
let loading: Promise<typeof google.maps> | null = null;

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (!hasGoogleMaps) return Promise.reject(new Error("Немає ключа Google Maps"));
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    // Скрипт міг уже приїхати (перехід між екранами) — тоді нічого не робимо.
    if (typeof google !== "undefined" && google.maps?.Map) {
      resolve(google.maps);
      return;
    }

    /**
     * Чекаємо на CALLBACK, а не на `onload`.
     *
     * З `loading=async` (а без нього Google сипле попередженням і блокує
     * розбір сторінки) на момент `onload` конструкторів ще немає:
     * `google.maps` існує, а `google.maps.Map` — ні, і створення карти
     * падає з «maps.Map is not a constructor». `importLibrary` теж не
     * допомагає: його додає вбудований bootstrap-снипет Google, а не
     * звичайний тег script.
     *
     * Тому єдиний робочий шлях для тега — параметр `callback`: Google сам
     * викличе нашу функцію, коли API справді готове.
     */
    const done = `__budvikMapsReady${Date.now()}`;
    const w = window as unknown as Record<string, unknown>;
    w[done] = () => {
      delete w[done];
      if (typeof google === "undefined" || !google.maps?.Map) {
        reject(new Error("Google Maps готовий, але без конструкторів"));
        return;
      }
      resolve(google.maps);
    };

    const script = document.createElement("script");
    /*
      `language=uk` — щоб підписи були українською незалежно від того, як
      налаштований планшет; `region=UA` впливає на межі й на те, які назви
      Google вважає основними. `libraries=marker` — заради класичного
      `google.maps.Marker`.
    */
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}` +
      `&language=uk&region=UA&loading=async&libraries=marker&callback=${done}`;
    script.async = true;
    script.onerror = () => {
      delete w[done];
      reject(new Error("Не вдалося завантажити Google Maps"));
    };
    document.head.appendChild(script);
  });

  return loading;
}
