/**
 * Текст маршруту для водія — один будівник на клієнта й на сервер.
 *
 * Логіст пересилає маршрут у месенджер, і те саме повідомлення тепер уміє
 * надсилати сервер (`/api/erp/delivery-routes/[id]/send-link`). Дві копії
 * розійшлися б на першій же правці: водій отримав би з кнопки один текст, а
 * з Telegram — інший, і повірив би тому, що прийшло пізніше.
 *
 * Правила тексту, здобуті 02–03.09 на живих маршрутах:
 *   - у списку ВСІ точки маршруту, а не лише ті, що ввійшли в посилання:
 *     клієнт без піна інакше зникав мовчки (15 точок у маршруті, 13 у листі);
 *   - нумерація за порядком маршруту — та сама, що в чек-листі водія;
 *   - частини підписані «1/2», інакше водій не знає, що є продовження;
 *   - форма посилання /maps/dir/точка/точка — власник перевірив на телефоні,
 *     саме вона будує дорогу через усі точки (api=1 лишається застосунку).
 *
 * Чистий модуль: без prisma, без "use client", без звернень до DOM.
 */

import {
  googleMapsLinksFromHere,
  type MapLink,
  type MapPoint,
} from "@/lib/maps/google-links";

/** Точка в тому вигляді, в якому її знають і картка маршруту, і сервер. */
export type MessageStop = {
  kind?: "DELIVERY" | "PICKUP" | "ERRAND";
  title?: string | null;
  address: string | null;
  /** Власна координата точки — є лише в поїздок без контрагента. */
  lat?: number | null;
  lng?: number | null;
  counterparty?: {
    name: string;
    deliveryLat?: number | null;
    deliveryLng?: number | null;
  } | null;
};

/**
 * Координата точки: спершу картка клієнта, потім власна координата точки.
 *
 * Той самий порядок, що в екрані дня водія (lib/track/day-stops.ts). Пін
 * клієнта пріоритетніший, бо його уточнюють руками, і уточнення має діяти
 * на всі маршрути; власні lat/lng є лише в поїздок без контрагента.
 */
export function coordsOf(s: MessageStop): MapPoint | null {
  const lat = s.counterparty?.deliveryLat ?? s.lat ?? null;
  const lng = s.counterparty?.deliveryLng ?? s.lng ?? null;
  return lat == null || lng == null ? null : { lat, lng };
}

export function nameOf(s: MessageStop): string {
  return s.title || s.counterparty?.name || s.address || "Точка";
}

/**
 * Українська форма числа: 1 точка, 2 точки, 5 точок.
 *
 * Дрібниця, але цей текст читає не сервер, а водій у месенджері, і «4 точок»
 * у повідомленні з офісу виглядає так само, як помилка в накладній.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const points = (n: number) => `${n} ${plural(n, "точка", "точки", "точок")}`;

/** «2026-09-04» → «04.09.2026». Без Date — рядок уже київська доба. */
export function formatDayUa(day: string): string {
  const [y, m, d] = day.split("-");
  return y && m && d ? `${d}.${m}.${y}` : day;
}

export type DriverMessage = {
  /** Готовий текст для месенджера */
  text: string;
  /** Посилання Google Maps частинами по ≤10 точок */
  links: MapLink[];
  /** Скільки точок мають координати й потрапили в посилання */
  withCoords: number;
  /** Скільки точок без координат — вони є в тексті, але не в посиланні */
  missing: number;
};

export function buildDriverMessage({
  number,
  day,
  driverName,
  stops,
}: {
  number: string;
  /** Київська доба маршруту, YYYY-MM-DD */
  day: string;
  driverName: string | null;
  /** Точки в збереженому порядку маршруту */
  stops: MessageStop[];
}): DriverMessage {
  const withCoords = stops.filter((s) => coordsOf(s));
  const missing = stops.length - withCoords.length;
  // Стартом Google візьме поточне місце водія: до першого клієнта теж треба
  // доїхати, а раніше посилання вдавало, ніби він уже там стоїть.
  const links = googleMapsLinksFromHere(withCoords.map((s) => coordsOf(s)!));

  const text = [
    `Маршрут ${number} · ${formatDayUa(day)}${driverName ? ` · ${driverName}` : ""}`,
    ...stops.map((s, i) => {
      const addr = s.address ? ` — ${s.address}` : "";
      const noPin = coordsOf(s) ? "" : " ⚠ немає точки на карті, їхати за адресою";
      return `${i + 1}. ${nameOf(s)}${addr}${noPin}`;
    }),
    "",
    ...links.map((l, i) =>
      links.length === 1
        ? `Google Maps (від вашого місця): ${l.url}`
        : i === 0
          ? `Google Maps, частина 1/${links.length} — від вашого місця (${points(l.points)}): ${l.url}`
          : `Google Maps, частина ${i + 1}/${links.length} (${points(l.points)}): ${l.url}`
    ),
    ...(missing > 0
      ? [
          "",
          `Увага: ${points(missing)} без координат — у посиланні ${missing === 1 ? "її" : "їх"} немає, дивіться адресу в списку вище.`,
        ]
      : []),
  ].join("\n");

  return { text, links, withCoords: withCoords.length, missing };
}

/**
 * Той самий текст для Telegram (parse_mode=HTML).
 *
 * Екранування обовʼязкове: у назвах клієнтів з 1С трапляються «&» і кутові
 * дужки («ТзОВ "Альфа & Бета"»), і Telegram відповідає на них 400, тобто
 * маршрут просто не доїхав би.
 */
export function toTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
