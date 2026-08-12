/**
 * Місто чи область: за яким тарифом оплачувати точку вигрузки.
 *
 * Правило власника дослівно: «ми у Львові; об'їзна і все, що за нею, —
 * область (15 грн), усе ближче по карті — місто (25 грн)». Тобто межа
 * геометрична, а не адміністративна: Винники формально окреме місто, але
 * всередині кільця, і платити за них як за область було б неправильно.
 *
 * Звідси порядок рішення — від найнадійнішого джерела до найслабшого:
 *   1. Ручний override на контрагенті. Останнє слово завжди за адміном.
 *   2. Полігон: координати всередині кільця об'їзної → місто.
 *   3. Евристика адреси, якщо координат немає (геокодування накрилося або
 *      клієнта завели без адреси).
 *   4. Нічого не відомо → область, найдешевший варіант, і позначка
 *      UNKNOWN, щоб UI підсвітив точку і адмін міг виправити руками.
 *
 * Модуль чистий: жодного Prisma й жодних мережевих запитів.
 */

export type DeliveryZoneValue = "CITY" | "OBLAST";

/** Звідки взялася зона — UI показує це, щоб було видно сумнівні точки. */
export type ZoneSource = "OVERRIDE" | "POLYGON" | "ADDRESS" | "UNKNOWN";

export interface ZoneInput {
  /** Counterparty.deliveryZone — ручний override адміна */
  override?: DeliveryZoneValue | null;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}

export interface ZoneResult {
  zone: DeliveryZoneValue;
  source: ZoneSource;
}

/**
 * Кільце львівської об'їзної, [lat, lng], проти годинникової.
 *
 * Знято по трасі великої об'їзної (M06/H02/M11 + північна та південна
 * обхідні) з кроком приблизно 2–3 км; точність порядку сотень метрів
 * достатня, бо на самій межі клієнтів практично немає, а спірні випадки
 * закриває ручний override.
 *
 * Якщо об'їзну добудують і межа поїде — правиться цей масив, дані
 * переливати не треба: зона ніде не зберігається як факт, вона щоразу
 * рахується наново.
 */
export const LVIV_RING_POLYGON: [number, number][] = [
  [49.8985, 23.9330], // північний захід, Рясне
  [49.9070, 23.9800], // північ, Голоско
  [49.9060, 24.0350], // північ, Замарстинів / Збоїща
  [49.8950, 24.0850], // північний схід, Малехів
  [49.8760, 24.1200], // схід, Підбірці
  [49.8520, 24.1350], // схід, Виннички
  [49.8280, 24.1250], // південний схід, Винники
  [49.8050, 24.0900], // південь, Пасіки-Зубрицькі
  [49.7930, 24.0400], // південь,Сихів / Зубра
  [49.7900, 23.9900], // південний захід, Солонка
  [49.8060, 23.9350], // захід, Сокільники
  [49.8330, 23.8950], // захід, Наварія / аеропорт
  [49.8600, 23.8800], // північний захід, Скнилів
  [49.8830, 23.8950], // північний захід, Рясне-2
];

/**
 * Точка всередині полігона (ray casting).
 *
 * Промінь вправо від точки; кожне перетинання ребра перемикає прапорець.
 * Непарна кількість перетинів — точка всередині.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: [number, number][]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const straddles = latI > lat !== latJ > lat;
    if (!straddles) continue;
    const lngAtLat = ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (lng < lngAtLat) inside = !inside;
  }
  return inside;
}

/**
 * Назви передмість у межах кільця. Потрібні лише як запасний варіант для
 * адрес без координат: у Винниках і Сокільниках власна нумерація вулиць,
 * і без цього списку така адреса впала б в область.
 */
const CITY_SETTLEMENTS = [
  "львів",
  "львов",
  "винники",
  "сокільники",
  "сокольники",
  "рясне",
  "малехів",
  "зубра",
  "пасіки-зубрицькі",
  "скнилів",
];

/**
 * Населені пункти, які легко сплутати зі Львовом у рядку адреси, але вони
 * поза кільцем: «Львівська обл., Городок» містить «львів» як підрядок.
 */
const OBLAST_MARKERS = [
  "обл.",
  "область",
  "район",
  "р-н",
  "нова пошта",
  "новая почта",
];

/** Адреса схожа на міську? Лише для точок без координат. */
export function looksLikeCity(address: string): boolean {
  const a = address.toLowerCase().trim();
  if (!a) return false;

  // «м. Львів, вул. Городоцька» — місто; «Львівська обл., смт Брюховичі» — ні.
  const hasOblastMarker = OBLAST_MARKERS.some((m) => a.includes(m));
  const hasCityName = CITY_SETTLEMENTS.some((s) => a.includes(s));

  if (!hasCityName) return false;
  if (hasOblastMarker) {
    // «м. Львів, Львівська обл.» трапляється в картках 1С — якщо є явне
    // «м. Львів» чи «м.Львів», віримо йому, а не загальному «обл.».
    return /\bм\.?\s*львів/i.test(address) || /\bг\.?\s*львов/i.test(address);
  }
  return true;
}

/**
 * Зона точки вигрузки.
 *
 * Невідома зона свідомо оплачується як область: помилитися на користь
 * компанії дешевше, ніж роздати зайве, а UI все одно покаже такі точки
 * окремо, щоб адмін їх розібрав.
 */
export function classifyZone(input: ZoneInput): ZoneResult {
  if (input.override === "CITY" || input.override === "OBLAST") {
    return { zone: input.override, source: "OVERRIDE" };
  }

  const { lat, lng } = input;
  if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
    const inside = pointInPolygon(lat, lng, LVIV_RING_POLYGON);
    return { zone: inside ? "CITY" : "OBLAST", source: "POLYGON" };
  }

  if (input.address && input.address.trim()) {
    return looksLikeCity(input.address)
      ? { zone: "CITY", source: "ADDRESS" }
      : { zone: "OBLAST", source: "ADDRESS" };
  }

  return { zone: "OBLAST", source: "UNKNOWN" };
}

/**
 * Ключ для дедуплікації точок: три накладні на одну адресу — одна точка.
 *
 * Нормалізуємо агресивно (регістр, пунктуація, «вул./вулиця», подвійні
 * пробіли), бо в 1С одна й та сама адреса пишеться по-різному в різних
 * документах. Якщо адреси немає — падаємо на контрагента: точка все одно
 * одна, навіть якщо адреса не заповнена.
 */
export function addressKey(
  address: string | null | undefined,
  counterpartyId: string | null | undefined,
  fallback: string
): string {
  const a = (address ?? "").trim();
  if (a) {
    const normalized = a
      .toLowerCase()
      .replace(/["'«»`]/g, "")
      .replace(/\b(вул|вулиця|ул|улица|просп|проспект|пров|провулок|буд|будинок|дом)\b\.?/g, "")
      .replace(/[.,;/\\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized) return `addr:${normalized}`;
  }
  if (counterpartyId) return `cp:${counterpartyId}`;
  return `row:${fallback}`;
}
