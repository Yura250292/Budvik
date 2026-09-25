/**
 * Де стоїть клієнт — за адресою з 1С. Один ланцюг для кнопки «Геокодувати»
 * в адмінці й для разових скриптів, щоб правило точності було одне.
 *
 * Правило запису (geoSource):
 * - GEOCODED — лише знайдений будинок чи заклад;
 * - CITY — вулиця, ринок чи центр населеного пункту. Такий пін на карті
 *   порожнистий і просить торгового уточнити точку на місці.
 * Доти в GEOCODED потрапляв і центр міста: 105 клієнтів у двох точках
 * центру Львова, і жоден не виглядав приблизним.
 *
 * Порядок: Nominatim (очищена адреса, потім сира) → Google Geocoding →
 * Google Places за назвою магазину → центр пункту → пункт із назви клієнта.
 */

import { cleanAddress, settlementFromName, settlementOf, shopNameOf } from "./clean-address";
import { googleGeocode, googlePlace } from "./google";
import { geocodeAddress, type GeoPrecision } from "./nominatim";
import { lvivMarketOf } from "./markets";
import { otherOblastOf, searchBoxFor } from "./region";

export type ClientLocation = {
  lat: number;
  lng: number;
  geoSource: "GEOCODED" | "CITY";
  precision: GeoPrecision;
  /** Хто знайшов — для звітів скриптів. */
  via: "osm" | "google" | "places" | "name" | "market";
  label: string;
};

const RANK = { SETTLEMENT: 0, STREET: 1, HOUSE: 2 } as const;

function cap(p: GeoPrecision, max: GeoPrecision): GeoPrecision {
  return RANK[p] <= RANK[max] ? p : max;
}

function fromOsm(hit: { lat: number; lng: number; displayName: string; precision: GeoPrecision }, via: ClientLocation["via"] = "osm"): ClientLocation {
  return {
    lat: hit.lat,
    lng: hit.lng,
    precision: hit.precision,
    geoSource: hit.precision === "HOUSE" ? "GEOCODED" : "CITY",
    via,
    label: hit.displayName,
  };
}

/**
 * null — не знайшлося нічого, навіть населеного пункту (→ FAILED).
 *
 * Помилки Google (вимкнений API, вичерпаний ліміт) летять нагору: мовчки
 * звалитись на OSM означало б тихо записати сотні «центрів міста» там, де
 * Google знайшов би будинок.
 */
/**
 * Ринок: ворота ринку — не адреса павільйону, тож точка завжди приблизна
 * (CITY), навіть коли геокодер знайшов «Кукурудзяна, 1» до будинку.
 * «Площа Ринок» — назва площі, не базар. «Торпедо №227 (центральний ряд)»
 * — теж ринок, хоч слова «ринок» у рядку й немає.
 */
const MARKET = /ринок|ринку|р-н?ок|р-к|базар|торпедо|шувар|(?<![\p{L}])(ряд|будка|павільйон|контейнер)/iu;
const isMarket = (address: string) => MARKET.test(address.replace(/пл(оща|\.)?\s*ринок/giu, " "));

export async function locateClient(address: string | null, name: string): Promise<ClientLocation | null> {
  const loc = await locate(address, name);
  if (loc && loc.geoSource === "GEOCODED" && isMarket(address ?? "")) {
    return { ...loc, geoSource: "CITY", precision: "STREET" };
  }
  return loc;
}

async function locate(address: string | null, name: string): Promise<ClientLocation | null> {
  const raw = (address ?? "").trim();
  const box = raw ? searchBoxFor(raw) : undefined;
  const cleaned = raw ? cleanAddress(raw, { lviv: !!box, requireSettlement: true }) : null;
  const settlement = raw ? settlementOf(raw) : null;
  // Відомий львівський ринок — перевірені координати, а не геокодер.
  const market = raw && isMarket(raw) && (!settlement || /^льв/iu.test(settlement)) ? lvivMarketOf(raw) : null;
  if (market) {
    return { lat: market.lat, lng: market.lng, geoSource: "CITY", precision: "STREET", via: "market", label: market.label };
  }

  // Поза Львівщиною — клієнт доставки (Нова Пошта в Ахтирці, Rozetka в
  // Надвірній): досить його міста. Без розпізнаного міста — нічого: пошук по
  // всій Україні за «вул. Шевченка, 3» ставив Ахтирку в Одеську область.
  if (raw && !box) {
    if (!settlement) return null;
    const oblast = otherOblastOf(raw);
    const inOblast = (loc: ClientLocation | null) =>
      loc && (!oblast || loc.label.toLowerCase().includes(oblast)) ? loc : null;
    const hit = await geocodeAddress(raw, { settlement, preferPrecise: true });
    return inOblast(hit ? fromOsm(hit) : null) ?? inOblast(await settlementCenter(settlement, undefined, oblast));
  }

  const noStreetCap: GeoPrecision = /вул|просп|пл\.|площ|пров|бульв|шосе|ринок|базар|ряд/iu.test(raw)
    ? "STREET"
    : "SETTLEMENT";

  // Найкраща груба знахідка (вулиця чи центр пункту) — на випадок, якщо
  // будинку не знайде ніхто. У об'єкті, бо TS не бачить присвоєння в замиканні.
  const best: { loc: ClientLocation | null } = { loc: null };
  const keep = (loc: ClientLocation) => {
    if (!best.loc || RANK[loc.precision] > RANK[best.loc.precision]) best.loc = loc;
  };

  if (raw) {
    // Очищена адреса йде першою: хвости «маг.Е1», «біля їдальні» збивають
    // Nominatim на центр міста, а вулицю з будинком він часто знає.
    for (const q of [cleaned, raw]) {
      if (!q) continue;
      // Вулиця з очищеної адреси вже краща за все, що дасть сирий рядок.
      if (best.loc?.precision === "STREET") break;
      const hit = await geocodeAddress(q, { box, settlement, preferPrecise: true });
      if (!hit) continue;
      // Без вулиці з номером в адресі будинку знайтися не може: «м. Львів»
      // інакше ставав музеєм «Арсенал» з позначкою «точно». А без вулиці
      // й ринку взагалі — лише населений пункт.
      const loc = fromOsm(cleaned ? hit : { ...hit, precision: cap(hit.precision, noStreetCap) });
      if (loc.precision === "HOUSE") return loc;
      keep(loc);
    }

    const g = await googleGeocode(cleaned ?? raw, { box, settlement });
    if (g) return { ...g, geoSource: "GEOCODED", via: "google" };

    const shop = shopNameOf(raw);
    const center = best.loc ?? (settlement ? await settlementCenter(settlement, box) : null);
    if (shop && center) {
      const p = await googlePlace(`${shop}, ${settlement ?? ""}`.replace(/,\s*$/, ""), center);
      if (p) return { ...p, geoSource: "GEOCODED", via: "places" };
    }
    if (center) keep(center);
  }

  if (best.loc) return best.loc;

  const fromName = settlementFromName(name);
  if (fromName) {
    const hit = await geocodeAddress(fromName, { box: searchBoxFor(fromName), settlement: fromName.split(",")[0] });
    if (hit) return { ...fromOsm(hit, "name"), precision: "SETTLEMENT", geoSource: "CITY" };
  }
  return null;
}

async function settlementCenter(
  settlement: string,
  box: ReturnType<typeof searchBoxFor>,
  oblast?: string | null
): Promise<ClientLocation | null> {
  const region = box ? ", Львівська область" : oblast ? `, ${oblast}а область` : "";
  const hit = await geocodeAddress(`${settlement}${region}, Україна`, { box, settlement });
  return hit ? { ...fromOsm(hit), precision: "SETTLEMENT", geoSource: "CITY" } : null;
}
