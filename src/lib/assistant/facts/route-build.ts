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
 * Потенційні клієнти (ромби на карті) — третє джерело після клієнтів і
 * перед адресами: ім'я, якого немає серед контрагентів, шукаємо серед
 * відкритих ромбів (prospects/find.ts). Точка тоді несе примітку: хто це, яка
 * категорія і чи стоїть пін лише в центрі населеного пункту.
 *
 * Геокодування — Nominatim, ~1,1 с на запит, а невдала адреса перебирає до
 * восьми варіантів написання. Тому адрес за один виклик береться не більше
 * `maxGeocode`; решта повертається у `noPin`, і викликач має про це сказати.
 */

import { prisma } from "@/lib/prisma";
import { defaultDepot } from "@/lib/routes/depot";
import { clientQuery, findClients, pickOneClient } from "@/lib/assistant/facts/client-search";
import { queryWords } from "@/lib/assistant/facts/search-words";
import { geocodeAddress } from "@/lib/geo/nominatim";
import { humanText } from "@/lib/assistant/format";
import { findOpenProspects, prospectNote } from "@/lib/prospects/find";

export type RouteStop = {
  /** Ідентифікатор контрагента; для адреси й складу — null. */
  id: string | null;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  source: "клієнт" | "адреса" | "склад" | "потенційний";
  /** Для ромба: хто це (категорія, спеціалізація) і чи точна точка. */
  note?: string;
  /** Точка приблизна — стоїть у центрі населеного пункту. */
  approximate?: boolean;
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
  /**
   * Для кожного невпізнаного — до трьох схожих клієнтів за прізвищем.
   *
   * «Не знайдено в базі» людина чує як «такого клієнта немає» і йде
   * шукати його в 1С, хоча він був за одну букву. Варіанти дають моделі
   * змогу перепитати: «Може, Яцьків Іван Теодорович (м.Перемишляни)?» —
   * і людина відповідає одним тапом, а не диктує перелік заново.
   */
  suggestions: Array<{ asked: string; options: string[] }>;
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
  const prospectOptions: Array<{ asked: string; options: string[] }> = [];
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

    const prospects = await findOpenProspects(name, 3);
    if (prospects.length === 1) {
      const p = prospects[0];
      if (seenIds.has(p.id)) continue;
      seenIds.add(p.id);
      picked.push({
        id: null,
        name: p.name,
        address: p.address ? humanText(p.address, 120) : null,
        lat: p.lat,
        lng: p.lng,
        source: "потенційний",
        note: prospectNote(p),
        approximate: p.approximate,
      });
      continue;
    }
    if (prospects.length > 1 && !looksLikeAddress(name)) {
      unclear.push(name);
      prospectOptions.push({ asked: name, options: prospects.map((p) => p.name) });
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

  const suggestions = await suggestFor(unclear, repId);
  for (const po of prospectOptions) {
    const same = suggestions.find((x) => x.asked === po.asked);
    if (same) same.options = [...same.options, ...po.options];
    else suggestions.push(po);
  }

  return { picked, unclear, noPin, geocodeSkipped, suggestions };
}

/** Номер будинку або вулиця — це адреса, а не забуте імʼя клієнта. */
const STREET_LIKE = /\d|(^|\s)(вул|просп|пл)/i;

/** Скільки варіантів пропонувати на одне невпізнане імʼя. */
const SUGGEST_MAX = 3;

/**
 * Схожі клієнти для невпізнаних імен — пошук лише за першим значущим словом.
 *
 * Повний пошук вимагає ВСІХ слів, тож одна зайва чи перекручена деталь
 * («Теодорович» замість «Федорович», чуже місто) відкидає клієнта
 * повністю. Прізвище ж людина майже завжди називає правильно, і саме за
 * ним варто показати, хто є. Адреси з номером будинку чи вулицею сюди не
 * йдуть: серед клієнтів їм шукати нічого. Саме «м.» адресою НЕ вважаємо —
 * клієнта називають «Яцків (м. Перемишляни)», і це найчастіший випадок.
 */
async function suggestFor(unclear: string[], repId: string): Promise<RouteStopsResult["suggestions"]> {
  const out: RouteStopsResult["suggestions"] = [];
  for (const asked of unclear) {
    if (STREET_LIKE.test(asked)) continue;
    const surname = queryWords(clientQuery(asked))[0];
    if (!surname || surname.length < 3) continue;
    const hits = await findClients(surname, repId, { limit: SUGGEST_MAX });
    if (hits.length) out.push({ asked, options: hits.map((h) => h.name) });
  }
  return out;
}
