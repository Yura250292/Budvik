/**
 * Точка клієнта на карті: де вона (Львівщина чи ні), звідки взялась і чи їй
 * вірити.
 *
 * Навіщо. Точки ставили три джерела різної якості: людина на місці (MANUAL),
 * геокодер за адресою (GEOCODED) і геокодер, що знайшов лише населений пункт
 * (CITY). Помічник бачив лише широту й довготу, тож для нього всі вони були
 * однаково точними. А 24.09.2026 на проді: 849 клієнтів злиплися купками по
 * 3+ різні адреси на одній точці, клієнти ринку «Торпедо» у Львові стояли під
 * Запоріжжям, Нова пошта Білої Церкви — у Львові.
 *
 * Львівщина. Фірма торгує областю, торгові їздять нею. Клієнт у Тернополі,
 * Києві чи Одесі — це відправка (здебільшого Новою поштою), не точка в
 * маршруті торгового. Регіон за точкою — кордоном області (geo/lviv-oblast),
 * а коли точка суперечить тексту адреси, «лише доставка» вирішує текст:
 * хибна точка частіше, ніж хибна адреса.
 *
 * Регулярки нижче — ОДНІ для Postgres (`~*` у виді client_geo) і для JS
 * (placeTest): синтаксис спільний, `\b` не вживаємо (у JS він не знає
 * кирилиці), межа слова — «не літера». Збіг тримає scripts/check-client-geo.mts.
 *
 * Модуль чистий: без бази й мережі. Перевірку точки через інтернет робить
 * facts/pin-check.ts.
 */

import { haversineM } from "@/lib/track/geo";
import { kyivDaySql } from "@/lib/date/kyiv";
import { LVIV_OBLAST_SQL } from "@/lib/geo/lviv-oblast";
import type { AddressPrecision } from "@/lib/geo/nominatim";

/** Кирилична літера для межі слова. */
const L = "а-яіїєґ";

/** Текст каже «Львів» або «Львівська область» (але не «вул. Львівська» в Києві). */
export const PLACE_LVIV_RE = String.raw`(^|[^${L}])львів([^${L}]|$)|львівськ[${L}]*\.?\s*обл`;

/**
 * Текст каже інше місто чи область України.
 *
 * Міста — цілим словом і без дефіса після: «Київська» (вулиця у Львові) не
 * рахується, «Дніпро-М» (магазин) теж. Області — прикметником перед «обл».
 *
 * Миколаєва в списку немає навмисно: є місто Миколаїв на Львівщині
 * (Стрийський район), і «м.Миколаїв, р-нок» — наші клієнти. Миколаївську
 * область ловить прикметник «миколаївськ… обл».
 */
const OTHER_CITIES = [
  "київ", "тернопіль", "луцьк", "рівне", "ужгород", "мукачев[ое]", "чернівці", "хмельницький", "вінниця",
  "житомир", "черкаси", "полтава", "суми", "чернігів", "харків", "дніпро", "запоріжжя", "одеса",
  "херсон", "кропивницький", "кременчук", "кривий ріг", "біла церква", "ірпінь", "бровари", "буча", "умань",
  "ковель", "дубно", "калуш", "коломия", "івано-франківськ", "нововолинськ", "кам.янець-подільський",
  "бердичів", "шостка", "конотоп", "ніжин", "фастів", "світловодськ", "костопіль",
];
const OTHER_OBLASTS = [
  "київськ", "тернопільськ", "івано-франківськ", "волинськ", "рівненськ", "закарпатськ", "чернівецьк",
  "хмельницьк", "вінницьк", "житомирськ", "черкаськ", "полтавськ", "сумськ", "чернігівськ", "харківськ",
  "дніпропетровськ", "запорізьк", "одеськ", "миколаївськ", "херсонськ", "кіровоградськ", "донецьк", "луганськ",
];
export const PLACE_OTHER_RE =
  String.raw`(^|[^${L}])(${OTHER_CITIES.join("|")})([^${L}-]|$)` +
  String.raw`|(${OTHER_OBLASTS.join("|")})[${L}]*\.?\s*обл`;

/** Адреса — відділення чи поштомат перевізника: точка показує відділення, а не магазин. */
export const NP_BRANCH_RE = String.raw`нов[аоі][${L}]*\s*пошт|поштомат|(^|[^${L}])нп\s*№|укрпошт|meest|розетк|rozetka`;

/** Та сама перевірка, що `text ~* re` у Postgres. */
export function placeTest(re: string, text: string | null | undefined): boolean {
  return !!text && new RegExp(re, "iu").test(text);
}

/** Скільки різних адрес на одній точці вже означає «геокодер поставив навмання». */
export const HEAP_MIN = 3;

/**
 * Плоскі координати в км від центру Львова — щоб відстань між двома
 * клієнтами модель рахувала простою формулою sqrt(dx²+dy²), а не
 * гаверсинусом, який вона пише з помилками. Похибка в межах області ±3 %.
 */
const X_KM_PER_DEG = 71.8; // 111,32 × cos(49,84°)
const Y_KM_PER_DEG = 111.2;
const CENTER = { lat: 49.84, lng: 24.03 };

/** Тіло виду client_geo (див. query-views.ts). */
export function clientGeoViewSql(): string {
  const lat = `c."deliveryLat"`;
  const lng = `c."deliveryLng"`;
  return `
      SELECT c.id AS client_id, c.name, g.addr AS address, ${lat} AS lat, ${lng} AS lng,
             g.pin_source, pu.name AS pinned_by, ${kyivDaySql('c."geoAt"')} AS pinned_day,
             c."geoAccuracyM" AS accuracy_m, g.region,
             CASE WHEN t.text_lviv THEN FALSE WHEN t.text_other THEN TRUE
                  WHEN g.region IS NULL THEN NULL ELSE g.region = 'OUTSIDE' END AS shipping_only,
             COALESCE(g.addr ~* '${NP_BRANCH_RE}', FALSE) AS np_branch,
             h.n AS heap,
             (r.reason IS NOT NULL) AS suspect, r.reason AS suspect_reason,
             ROUND((2 * 6371 * asin(sqrt(
               power(sin(radians(${lat} - dp.lat) / 2), 2)
               + cos(radians(dp.lat)) * cos(radians(${lat})) * power(sin(radians(${lng} - dp.lng) / 2), 2)
             )))::numeric, 1) AS km_from_depot,
             ROUND(((${lng} - ${CENTER.lng}) * ${X_KM_PER_DEG})::numeric, 2) AS x_km,
             ROUND(((${lat} - ${CENTER.lat}) * ${Y_KM_PER_DEG})::numeric, 2) AS y_km,
             CASE WHEN ${lat} IS NOT NULL
                  THEN 'https://www.google.com/maps/search/?api=1&query=' || ROUND(${lat}::numeric, 6) || ',' || ROUND(${lng}::numeric, 6)
             END AS map_url,
             ru.name AS rep, ${kyivDaySql("cf.last_sale_at")} AS last_sale_day,
             c."isInternal" AS internal, c."isActive" AS active
      FROM "Counterparty" c
      JOIN client_facts cf ON cf.client_id = c.id
      LEFT JOIN "User" ru ON ru.id = cf.rep_id
      LEFT JOIN "User" pu ON pu.id = c."geoById"
      LEFT JOIN (
        SELECT sl.lat, sl.lng FROM "StockLocation" sl
        WHERE sl."isActive" AND NOT sl."isService" AND sl.lat IS NOT NULL AND sl.lng IS NOT NULL
        ORDER BY sl."isDefault" DESC, sl.name
        LIMIT 1
      ) dp ON TRUE
      LEFT JOIN (
        SELECT round("deliveryLat"::numeric, 4) AS la, round("deliveryLng"::numeric, 4) AS lo,
               COUNT(DISTINCT lower(COALESCE(NULLIF(btrim("deliveryAddress"), ''), NULLIF(btrim(address), ''), name)))::int AS n
        FROM "Counterparty"
        WHERE "deliveryLat" IS NOT NULL AND "deliveryLng" IS NOT NULL
        GROUP BY 1, 2
      ) h ON h.la = round(${lat}::numeric, 4) AND h.lo = round(${lng}::numeric, 4)
      CROSS JOIN LATERAL (
        SELECT COALESCE(NULLIF(btrim(c."deliveryAddress"), ''), NULLIF(btrim(c.address), '')) AS addr,
               CASE WHEN ${lat} IS NULL OR ${lng} IS NULL
                    THEN CASE WHEN c."geoSource" = 'FAILED' THEN 'FAILED' ELSE 'NONE' END
                    ELSE COALESCE(c."geoSource"::text, 'UNKNOWN') END AS pin_source,
               CASE WHEN ${lat} IS NULL OR ${lng} IS NULL THEN NULL
                    WHEN ${LVIV_OBLAST_SQL} @> point(${lng}, ${lat}) THEN 'LVIV'
                    ELSE 'OUTSIDE' END AS region
      ) g
      CROSS JOIN LATERAL (
        -- Місто буває лише в дужках назви: «Шахматенко Павло (м.Львів)».
        SELECT concat_ws(' ', g.addr, substring(c.name from '\\(([^)]*)\\)')) AS place
      ) pl
      CROSS JOIN LATERAL (
        SELECT COALESCE(pl.place ~* '${PLACE_LVIV_RE}', FALSE) AS text_lviv,
               COALESCE(pl.place ~* '${PLACE_OTHER_RE}', FALSE) AS text_other
      ) t
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN g.region IS NULL OR g.pin_source = 'MANUAL' THEN NULL
          WHEN g.pin_source = 'CITY' THEN 'знайдено лише населений пункт, не адресу'
          WHEN g.region = 'OUTSIDE' AND t.text_lviv THEN 'адреса у Львові чи області, а точка поза Львівщиною'
          WHEN g.region = 'LVIV' AND t.text_other AND NOT t.text_lviv THEN 'адреса в іншій області, а точка на Львівщині'
          WHEN h.n >= ${HEAP_MIN} THEN 'на цій точці ' || h.n || ' різних адрес — геокодер поставив навмання або в центр міста'
        END AS reason
      ) r`;
}

/* ── Висновок перевірки точки ─────────────────────────────────────────── */

export type PinSource = "MANUAL" | "GEOCODED" | "CITY" | "FAILED" | "NONE" | "UNKNOWN";

export type PinVerdictCode =
  | "OK" // точка там, де адреса
  | "NEAR" // поруч, для доставки годиться, вхід у магазин — глянути
  | "MOVE" // точка далеко від адреси — пересунути
  | "HUMAN_DIFFERS" // точку ставила людина, адреса каже інше — вірити людині, адреса в 1С могла застаріти
  | "CITY_ONLY" // адресу знайдено лише до населеного пункту, точка в ньому
  | "NOT_FOUND" // адресу в інтернеті не знайдено
  | "NO_PIN" // точки немає
  | "NO_ADDRESS"; // адреси в картці немає

type LatLng = { lat: number; lng: number };

/** Допуски, км: до `ok` — збігається, до `near` — поруч; далі — не там. */
const TOLERANCE: Record<AddressPrecision, { ok: number; near: number }> = {
  ADDRESS: { ok: 0.3, near: 1.5 },
  STREET: { ok: 0, near: 1.5 }, // вулиця довга: «збігається» про будинок не скажеш
  CITY: { ok: 0, near: 5 },
};

export function pinVerdict(i: {
  hasAddress: boolean;
  pinSource: PinSource | string;
  pin: LatLng | null;
  found: (LatLng & { precision: AddressPrecision }) | null;
}): { code: PinVerdictCode; km: number | null; text: string } {
  if (!i.pin) {
    if (i.found) return { code: "NO_PIN", km: null, text: "точки на карті немає — за адресою знайдено місце, його можна поставити" };
    return i.hasAddress
      ? { code: "NOT_FOUND", km: null, text: "точки немає, і адреси в інтернеті не знайшлося — поставити може лише людина на місці" }
      : { code: "NO_ADDRESS", km: null, text: "ні адреси, ні точки — поставити може лише людина на місці" };
  }
  if (!i.hasAddress) return { code: "NO_ADDRESS", km: null, text: "адреси в картці немає — порівняти точку нема з чим" };
  if (!i.found) return { code: "NOT_FOUND", km: null, text: "адресу в інтернеті не знайдено — перевірити точку нема з чим" };

  const km = Math.round(haversineM(i.pin.lat, i.pin.lng, i.found.lat, i.found.lng) / 100) / 10;
  const tol = TOLERANCE[i.found.precision];
  const human = i.pinSource === "MANUAL";

  // ok = 0 для вулиці й міста: навіть збіг до метра (точка CITY стоїть у тому
  // самому вузлі OSM) нічого не каже про будинок.
  if (tol.ok > 0 && km <= tol.ok) return { code: "OK", km, text: "точка збігається з адресою" };
  if (km <= tol.near) {
    if (i.found.precision === "CITY") {
      return { code: "CITY_ONLY", km, text: "адреса знаходиться лише до населеного пункту, точка в ньому — точніше скаже тільки людина на місці" };
    }
    return {
      code: "NEAR",
      km,
      text: i.found.precision === "STREET"
        ? "вулицю знайдено, точка на ній або поруч — будинок так не перевірити"
        : `точка поруч з адресою (${km} км) — для доставки годиться, вхід у магазин варто глянути`,
    };
  }
  if (human) {
    return { code: "HUMAN_DIFFERS", km, text: `точку ставила людина на місці — їй вірити більше; адреса за ${km} км від точки, можливо, в 1С вона стара` };
  }
  return { code: "MOVE", km, text: `точка за ${km} км від адреси — стоїть не там, пересунути` };
}
