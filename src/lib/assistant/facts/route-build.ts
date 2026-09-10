/**
 * Точки маршруту з того, як їх назвала людина.
 *
 * «Побудуй маршрут: Кунанець, Левкович, вул. Шевченка 10, Стрий, Склад» —
 * у такому переліку упереміш клієнти з бази, голі адреси й сам склад.
 * Кожне ім'я розв'язується окремо, і неоднозначні НЕ зупиняють роботу:
 * маршрут будується з тих, кого впізнали, а решта повертається списком,
 * щоб її було видно у відповіді. Зупиняти людину питанням про
 * однофамільця посеред переліку означало б змусити її диктувати все знову.
 *
 * Спільний для кодової відповіді торгового й для інструмента керівника:
 * правила впізнавання одні, різниться лише те, чи дозволено геокодувати
 * незнайомі адреси (для торгового — ні, бо він називає лише клієнтів).
 *
 * Геокодування — Nominatim, ~1,1 с на запит, а невдала адреса перебирає до
 * восьми варіантів написання. Тому адрес за один виклик береться не більше
 * `maxGeocode`; решта повертається у `noPin`, і викликач має про це сказати.
 */

import { prisma } from "@/lib/prisma";
import { defaultDepot } from "@/lib/routes/depot";
import { findClients, pickOneClient } from "@/lib/assistant/facts/client-search";
import { geocodeAddress } from "@/lib/geo/nominatim";
import { humanText } from "@/lib/assistant/format";

export type RouteStop = {
  /** Ідентифікатор контрагента; для адреси й складу — null. */
  id: string | null;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  source: "клієнт" | "адреса" | "склад";
};

export type RouteStopsResult = {
  /** У тому ж порядку, що й вхідні імена; порядок обʼїзду — справа OSRM. */
  picked: RouteStop[];
  /** Не впізнали: ні клієнта, ні адреси. */
  unclear: string[];
  /** Впізнали, але поставити на карту не змогли: клієнт без піна, адреса понад ліміт, склад без координат. */
  noPin: string[];
  /**
   * Адреси, які не геокодували через ліміт (вони ж є і в noPin). Окремо,
   * щоб викликач міг чесно сказати «назвіть решту окремо», а не вгадувати
   * по цифрі в назві, чи це адреса, чи клієнт без піна.
   */
  geocodeSkipped: string[];
};

/**
 * Слово, за яким людина має на увазі наш склад.
 *
 * Саме слово або з одним уточненням («Склад Дубляни», «наш офіс»). Довші
 * назви — «База будматеріалів Іванчук» — це вже клієнт, і вони йдуть у
 * пошук по базі.
 */
const DEPOT_WORD = /^(наш(ий)?\s+|головний\s+)?(склад|база|офіс)(\s+\S+)?$/i;

/**
 * Схоже на адресу, а не на назву клієнта: є цифра (номер будинку) або
 * позначка вулиці чи населеного пункту. Не `\b` — з кирилицею він не
 * працює, межа слова тут `(^|\s)`.
 */
const ADDRESS_LIKE = /\d|(^|\s)(вул|просп|пл|м\.|с\.|смт|село|місто)/i;

/** Скільки адрес геокодуємо за один виклик, якщо викликач не сказав інакше. */
const DEFAULT_MAX_GEOCODE = 5;

export function isDepotWord(name: string): boolean {
  return DEPOT_WORD.test(name.trim());
}

export function looksLikeAddress(name: string): boolean {
  return ADDRESS_LIKE.test(name);
}

export async function resolveRouteStops(
  names: string[],
  repId: string,
  opts: { geocode: boolean; maxGeocode?: number }
): Promise<RouteStopsResult> {
  const maxGeocode = opts.maxGeocode ?? DEFAULT_MAX_GEOCODE;
  const cleaned = names.map((n) => n.trim()).filter(Boolean);

  const wantsDepot = cleaned.some(isDepotWord);
  const depotPromise = wantsDepot ? defaultDepot() : Promise.resolve(null);

  /**
   * Клієнтів шукаємо всіх одразу — це швидкі запити до своєї бази.
   * Беремо ОДНОГО з кількох збігів, а не питаємо: правила в pickOneClient.
   */
  const lookups = await Promise.all(
    cleaned.map(async (name) => {
      if (isDepotWord(name)) return { name, hit: null };
      return { name, hit: pickOneClient(await findClients(name, repId, { limit: 4 })) };
    })
  );
  const depot = await depotPromise;

  // Координати — однією пачкою, а не по запиту на кожного.
  const ids = [...new Set(lookups.flatMap((l) => (l.hit ? [l.hit.id] : [])))];
  const geo = ids.length
    ? await prisma.counterparty.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, address: true, deliveryLat: true, deliveryLng: true },
      })
    : [];
  const geoById = new Map(geo.map((g) => [g.id, g]));

  const picked: RouteStop[] = [];
  const unclear: string[] = [];
  const noPin: string[] = [];
  const geocodeSkipped: string[] = [];
  const seenIds = new Set<string>();
  let depotTaken = false;
  let geocoded = 0;

  for (const { name, hit } of lookups) {
    if (isDepotWord(name)) {
      if (!depot) {
        noPin.push(name);
      } else if (!depotTaken) {
        // Склад у переліку двічі — все одно одна точка.
        depotTaken = true;
        picked.push({ id: null, name: depot.name, address: null, lat: depot.lat, lng: depot.lng, source: "склад" });
      }
      continue;
    }

    if (hit) {
      // Той самий клієнт названий двічі («Левкович» і «Левкович Стрий») —
      // одна точка, інакше OSRM малює нульове плече.
      if (seenIds.has(hit.id)) continue;
      seenIds.add(hit.id);

      const g = geoById.get(hit.id);
      if (g?.deliveryLat == null || g.deliveryLng == null) {
        noPin.push(hit.name);
        continue;
      }
      picked.push({
        id: g.id,
        name: g.name,
        address: g.address ? humanText(g.address, 120) : null,
        lat: g.deliveryLat,
        lng: g.deliveryLng,
        source: "клієнт",
      });
      continue;
    }

    if (!opts.geocode || !looksLikeAddress(name)) {
      unclear.push(name);
      continue;
    }

    if (geocoded >= maxGeocode) {
      noPin.push(name);
      geocodeSkipped.push(name);
      continue;
    }

    /**
     * Послідовно, а не Promise.all: Nominatim тримає одну чергу на весь
     * процес (див. waitForRateLimit), тож паралельність тут нічого не
     * прискорює, а ліміт на кількість адрес лічити простіше по черзі.
     */
    geocoded++;
    const found = await geocodeAddress(name).catch(() => null);
    if (!found) {
      unclear.push(name);
      continue;
    }
    picked.push({
      id: null,
      name,
      address: humanText(found.displayName, 120),
      lat: found.lat,
      lng: found.lng,
      source: "адреса",
    });
  }

  return { picked, unclear, noPin, geocodeSkipped };
}
