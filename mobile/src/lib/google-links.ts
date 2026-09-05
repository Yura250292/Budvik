/**
 * Посилання на Google Maps по затвердженому порядку точок.
 *
 * Копія src/lib/maps/google-links.ts із сайту. Копія, а не імпорт: застосунок
 * не має доступу до коду сайту, і тягнути його через спільний пакет заради
 * тридцяти рядків чистих функцій дорожче, ніж тримати дублікат.
 *
 * Ціна дубля відома: зміна ліміту Google доведеться внести у ДВА місця.
 * Ліміт цей стабільний роками, а розбіжність одразу видно — водій відкриє
 * посилання й побачить не ті адреси.
 */

export const MAX_POINTS_PER_LINK = 10;

export type MapPoint = { lat: number; lng: number };

/** Одна частина маршруту: посилання і скільки точок у ньому. */
export type MapLink = { url: string; points: number };

/**
 * Ділить точки на посилання Google Maps.
 *
 * Google приймає щонайбільше ~10 точок на посилання (початок + 8 проміжних +
 * кінець), а в денному маршруті їх буває 25. Кожна наступна частина стартує з
 * останньої точки попередньої — водій доїхав до кінця частини 1, відкрив
 * частину 2 і поїхав далі без розриву.
 *
 * Менше двох точок — порожній масив: маршруту з однієї точки не буває.
 */
export function googleMapsLinks(points: MapPoint[]): MapLink[] {
  return splitIntoLinks(points, directionsUrl);
}

/**
 * Маршрут, який починається ТАМ, ДЕ ЗАРАЗ ВОДІЙ.
 *
 * Стартову точку не задаємо взагалі, і Google підставляє «Ваше
 * місцезнаходження» — живе, а не те, яке пристрій зловив кілька хвилин
 * тому. Раніше сюди клали останню відому координату: у машині, що вже
 * рушила, вона застаріває швидше, ніж водій встигає натиснути кнопку, а
 * коли координати не було зовсім, дорога починалася з ПЕРШОЇ ТОЧКИ —
 * Google рахував, ніби водій уже там стоїть.
 *
 * Порожній сегмент у формі-шляху (`/dir//точка/точка`) цього НЕ дає —
 * Google його ігнорує. Текст «My+Location» теж не годиться: він
 * геокодується як назва й веде в випадкове місто. Працює лише api=1 без
 * origin.
 *
 * Перша частина везе РІВНО десять точок, а не девʼять.
 *
 * Тут довго стояв запас «мінус одна на старт», успадкований від звичайного
 * посилання з origin. Але origin ми саме тут і не передаємо — його місце
 * порожнє, і Google витрачає його на живу позицію водія, а не на нашу
 * точку. Ліміт api=1 — девʼять проміжних плюс призначення, тобто десять
 * наших точок. Через той запас десята зникала з посилання МОВЧКИ: водій
 * бачив у списку десять адрес, а в навігаторі девʼять.
 */
export function googleMapsLinksFromHere(points: MapPoint[]): MapLink[] {
  if (points.length === 0) return [];

  const head = points.slice(0, MAX_POINTS_PER_LINK);
  const links: MapLink[] = [{ url: fromHereUrl(head), points: head.length }];

  // Хвіст їде звичайними частинами: кожна стартує з останньої точки
  // попередньої, щоб дорога не рвалася.
  const rest = points.slice(head.length - 1);
  if (rest.length > 1) links.push(...splitIntoLinks(rest, directionsUrl));

  return links;
}

/** Дорога від поточного місця водія через усі задані точки по порядку. */
export function fromHereUrl(points: MapPoint[]): string {
  const dest = points[points.length - 1];
  const waypoints = points
    .slice(0, -1)
    .map((p) => `${round(p.lat)},${round(p.lng)}`)
    .join("|");

  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${round(dest.lat)},${round(dest.lng)}` +
    (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "") +
    `&travelmode=driving`
  );
}

function splitIntoLinks(
  points: MapPoint[],
  build: (chunk: MapPoint[]) => string
): MapLink[] {
  const links: MapLink[] = [];
  let i = 0;
  while (i < points.length - 1) {
    const chunk = points.slice(i, i + MAX_POINTS_PER_LINK);
    links.push({ url: build(chunk), points: chunk.length });
    i += MAX_POINTS_PER_LINK - 1;
  }
  return links;
}

/** Посилання «прокласти дорогу» через усі задані точки по порядку. */
export function directionsUrl(points: MapPoint[]): string {
  const origin = points[0];
  const dest = points[points.length - 1];
  const waypoints = points
    .slice(1, -1)
    .map((p) => `${p.lat},${p.lng}`)
    .join("|");

  return (
    `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}` +
    `&destination=${dest.lat},${dest.lng}` +
    (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "") +
    `&travelmode=driving`
  );
}

/**
 * Шість знаків після коми — приблизно 0,1 метра.
 *
 * Довші хвости точності не додають, зате роблять посилання таким, що його
 * ламають месенджери при перенесенні рядка (те саме правило, що на сайті).
 */
function round(v: number): number {
  return Number(v.toFixed(6));
}

/** Посилання на одну точку — «довези мене сюди». */
export function pointUrl(point: MapPoint): string {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${point.lat},${point.lng}&travelmode=driving`
  );
}

/**
 * Чим водій їде: Google Maps чи Waze.
 *
 * Вибір, а не наше рішення за нього. Половина водіїв в Україні звикла до
 * Waze і читає його з півпогляду, друга половина — до Google; нав'язаний
 * навігатор означає, що людина щоразу закриває його й відкриває свій.
 */
export type NavApp = "google" | "waze";

/**
 * Дорога до ОДНІЄЇ точки — те, чим водій їде насправді.
 *
 * Окремо від googleMapsLinksFromHere, і це головна відмінність підходу.
 * Посилання на кілька точок упирається в ліміт Google (дев'ять проміжних),
 * тому день різався на «Частина 1 / Частина 2», і між частинами водій мусив
 * сам згадати, що треба повернутися в кабінет і відкрити наступну. По одній
 * точці ліміту немає взагалі: наступну підставляє застосунок, коли
 * попередню відмічено.
 *
 * Waze приймає лише одну точку — і саме тому він тут рівноправний: у цій
 * схемі більше однієї й не треба.
 */
export function navigateUrl(point: MapPoint, app: NavApp = "google"): string {
  if (app === "waze") {
    // https://waze.com/ul, а не waze://: якщо застосунку на пристрої немає,
    // схема waze:// мовчки не робить нічого, а ця адреса відкриє веб-версію.
    return `https://waze.com/ul?ll=${round(point.lat)}%2C${round(point.lng)}&navigate=yes`;
  }
  return pointUrl(point);
}

/**
 * Дорога для ПАЧКИ точок — одним викликом на всі екрани.
 *
 * Правило просте й повторювалося вже в трьох місцях: одна точка (або Waze,
 * який більше однієї не приймає) — це «веди мене туди», кілька — посилання
 * від поточного місця через них. Тримати його трьома копіями означало
 * рано чи пізно розійтися: у пачці з однієї точки Google показав би екран
 * попереднього перегляду замість навігації.
 *
 * Порожня пачка дає порожній рядок, а не помилку: наприкінці дня вести
 * просто нікуди, і викликач має право цього не перевіряти.
 */
export function batchNavigateUrl(points: MapPoint[], app: NavApp = "google"): string {
  if (points.length === 0) return "";
  if (app === "waze" || points.length === 1) return navigateUrl(points[0], app);
  return googleMapsLinksFromHere(points)[0]?.url ?? "";
}


/**
 * Android-намір, який ВЕДЕ одразу.
 *
 * Звичайне посилання `maps/dir/?api=1` відкриває Google Maps на екрані
 * попереднього перегляду: водій бачить дорогу й мусить ще раз натиснути
 * «Почати». За кермом це зайвий дотик рівно в ту мить, коли руки зайняті.
 * Намір `google.navigation:` запускає покрокову навігацію без цього кроку.
 *
 * Тільки в застосунку і тільки для ОДНІЄЇ точки: схема не приймає
 * проміжних, тож пачка з трьох чи пʼяти лишається на звичайному посиланні.
 * На сайті її теж немає — браузер таку схему не відкриє, а у WebView наш
 * же перехоплювач її заблокує.
 */
export function navIntentUrl(point: MapPoint): string {
  return `google.navigation:q=${round(point.lat)},${round(point.lng)}&mode=d`;
}
