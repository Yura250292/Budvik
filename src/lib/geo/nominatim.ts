import { inBox, type GeoBox } from "./region";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "Budvik-ERP/1.0 (delivery route planner)";

/**
 * Що саме знайшов геокодер.
 *
 * HOUSE — будинок або заклад (магазин, пошта, склад). STREET — лише вулиця
 * чи ринок. SETTLEMENT — лише населений пункт: точка в центрі міста чи села.
 *
 * Доти геокодер цього не казав, і центр Львова записувався як «точна адреса»:
 * на 24.09.2026 у двох точках центру сиділо 105 клієнтів із GEOCODED.
 */
export type GeoPrecision = "HOUSE" | "STREET" | "SETTLEMENT";

export type GeocodeHit = {
  lat: number;
  lng: number;
  displayName: string;
  precision: GeoPrecision;
};

export type GeocodeOptions = {
  /** Шукати лише в цій рамці (див. searchBoxFor у ./region). */
  box?: GeoBox;
  /**
   * Населений пункт з адреси: знахідка мусить бути в ньому. Без цього
   * «Бібрка, Крушельницької 3» ставала на Крушельницьку у Львові, а
   * «Кам'янка-Бузька, Незалежності 79» — на майдан у Тернополі.
   */
  settlement?: string | null;
  /**
   * Не спинятися на центрі міста: шукати далі, поки якась стратегія не дасть
   * вулицю чи будинок. Для точок клієнтів (locateClient). Живий пошук і
   * маршрути беруть першу знахідку, як і раніше, — там важить швидкість.
   */
  preferPrecise?: boolean;
};

const RANK: Record<GeoPrecision, number> = { SETTLEMENT: 0, STREET: 1, HOUSE: 2 };

/** Грубіша з двох точностей: стратегія без номера будинку не дає HOUSE. */
function cap(p: GeoPrecision, max: GeoPrecision): GeoPrecision {
  return RANK[p] <= RANK[max] ? p : max;
}

// In-memory cache to avoid duplicate lookups
const cache = new Map<string, GeocodeHit>();

// Rate-limit: track last request time
let lastRequestTime = 0;

async function waitForRateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestTime = Date.now();
}

/** Common Russian→Ukrainian city name mappings */
const CITY_NAME_MAP: Record<string, string> = {
  "светловодск": "Світловодськ",
  "кременчуг": "Кременчук",
  "днепр": "Дніпро",
  "днепропетровск": "Дніпро",
  "запорожье": "Запоріжжя",
  "житомир": "Житомир",
  "харьков": "Харків",
  "херсон": "Херсон",
  "одесса": "Одеса",
  "николаев": "Миколаїв",
  "полтава": "Полтава",
  "сумы": "Суми",
  "чернигов": "Чернігів",
  "черновцы": "Чернівці",
  "черкассы": "Черкаси",
  "кировоград": "Кропивницький",
  "кропивницкий": "Кропивницький",
  "ровно": "Рівне",
  "луцк": "Луцьк",
  "ужгород": "Ужгород",
  "тернополь": "Тернопіль",
  "ивано-франковск": "Івано-Франківськ",
  "львов": "Львів",
  "винница": "Вінниця",
  "хмельницкий": "Хмельницький",
  "белая церковь": "Біла Церква",
  "бердянск": "Бердянськ",
  "мелитополь": "Мелітополь",
  "каменец-подольский": "Кам'янець-Подільський",
  "александрия": "Олександрія",
  "знаменка": "Знам'янка",
  "павлоград": "Павлоград",
  "никополь": "Нікополь",
  "умань": "Умань",
  "нежин": "Ніжин",
  "конотоп": "Конотоп",
  "шостка": "Шостка",
  "коростень": "Коростень",
  "бердичев": "Бердичів",
  "славута": "Славута",
  "новоград-волынский": "Новоград-Волинський",
  "измаил": "Ізмаїл",
  "первомайск": "Первомайськ",
  "вознесенск": "Вознесенськ",
  "кривой рог": "Кривий Ріг",
};

/**
 * Normalize a Nova Poshta address into a geocodable street address.
 * Input:  "НОВА ПОШТА №1,Светловодск,вул. Січових Стрільців(ран.вул.9-го Января),102"
 * Output: "Світловодськ, вулиця Січових Стрільців, 102"
 */
function normalizeNovaPoshtaAddress(address: string): string | null {
  // Detect NP-style address (case-insensitive)
  if (!/нова\s*пошта|nova\s*poshta|відділення|нп\s*№?\d/i.test(address)) {
    return null;
  }

  // Remove "НОВА ПОШТА №N" / "Відділення №N" prefix
  let cleaned = address
    .replace(/^(НОВА\s*ПОШТА|Nova\s*Poshta|НП)\s*№?\s*\d+\s*[,;:\s]*/i, "")
    .replace(/^відділення\s*№?\s*\d+\s*[,;:\s]*/i, "")
    .trim();

  // Remove parenthetical old street names: "(ран.вул.9-го Января)" or "(раніше вул. ...)"
  cleaned = cleaned.replace(/\s*\(ран(?:іше)?\.?\s*[^)]*\)/gi, "");

  // Split into parts (city, street, number...)
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  // Translate Russian city names to Ukrainian
  const normalizedParts = parts.map((part) => {
    const lower = part.toLowerCase().trim();
    return CITY_NAME_MAP[lower] || part;
  });

  return normalizedParts.join(", ");
}

/**
 * Початок слова для кириличних скорочень.
 *
 * НЕ `\b`: у JavaScript `\b` означає межу `\w`, а `\w` — це лише ASCII, тому
 * `/\bвул\./` не спрацьовує НІКОЛИ — перед «в» немає ASCII-межі. Через це всі
 * правила нижче роками нічого не замінювали, і geocodeAddress слав однаковий
 * рядок у чотирьох «різних» стратегіях замість чотирьох варіантів написання.
 *
 * Замість межі — початок рядка або будь-що, що не літера й не цифра.
 */
const START = "(?<=^|[^\\p{L}\\p{N}])";

/** Expand Ukrainian abbreviations for better Nominatim matching */
function expandAbbreviations(address: string): string {
  return address
    .replace(new RegExp(`${START}вул\\.?\\s*`, "giu"), "вулиця ")
    .replace(new RegExp(`${START}пров\\.?\\s*`, "giu"), "провулок ")
    .replace(new RegExp(`${START}просп\\.?\\s*`, "giu"), "проспект ")
    .replace(new RegExp(`${START}бульв\\.?\\s*`, "giu"), "бульвар ")
    .replace(new RegExp(`${START}пл\\.\\s*`, "giu"), "площа ")
    .replace(new RegExp(`${START}р-н`, "giu"), "район")
    .replace(new RegExp(`${START}обл\\.?\\s*`, "giu"), "область ")
    .replace(new RegExp(`${START}с\\.\\s*`, "giu"), "село ")
    .replace(new RegExp(`${START}смт\\.?\\s*`, "giu"), "")
    .replace(new RegExp(`${START}м\\.\\s*`, "giu"), "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip abbreviations entirely for a looser search.
 *
 * «район» і «область» тут теж зникають: Nominatim не знає старих районів
 * (Перемишлянського вже немає — є Львівський), і слово «район» у запиті
 * гарантовано дає нуль результатів навіть для села, яке в OSM є.
 */
function stripAbbreviations(address: string): string {
  return address
    .replace(
      new RegExp(
        `${START}(вул\\.|вулиця|пров\\.|провулок|просп\\.|проспект|бульв\\.|бульвар|пл\\.|площа|р-н|районі|району|район|обл\\.|області|область|с\\.|село|смт\\.?|м\\.)\\s*`,
        "giu"
      ),
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Replace Russian city names with Ukrainian equivalents in address string */
function normalizeRussianCityNames(address: string): string {
  const parts = address.split(",").map((p) => p.trim());
  const normalized = parts.map((part) => {
    const lower = part.toLowerCase().trim();
    return CITY_NAME_MAP[lower] || part;
  });
  return normalized.join(", ");
}

type NominatimRow = {
  lat: string;
  lon: string;
  display_name: string;
  class?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
};

/**
 * Точність однієї знахідки Nominatim — для geocodeAddress/locateClient.
 *
 * Ринок — лише STREET: координати воріт не є адресою павільйону, і торговий
 * мусить уточнити точку сам. (Схожий, але інший precisionOf нижче — для
 * перевірки точки в помічнику: той дивиться лише на addresstype.)
 */
function hitPrecision(row: NominatimRow): GeoPrecision {
  const cls = row.class ?? row.category ?? "";
  const type = row.type ?? "";
  if (cls === "amenity" && type === "marketplace") return "STREET";
  if (row.address?.house_number) return "HOUSE";
  if (cls === "place" && (type === "house" || type === "building")) return "HOUSE";
  if (["shop", "craft", "office", "building", "amenity", "tourism", "man_made"].includes(cls)) {
    return "HOUSE";
  }
  if (cls === "highway" || row.addresstype === "road") return "STREET";
  return "SETTLEMENT";
}

function normPlace(s: string): string {
  const lower = s.toLowerCase().trim();
  return (CITY_NAME_MAP[lower]?.toLowerCase() ?? lower).replace(/['`’ʼ\-\s]/g, "");
}

/**
 * Чи згадано в адресі-знахідці наш населений пункт. Порівнюємо початок назви:
 * «Камянка-Бузька» з 1С і «Кам'янка-Бузька» з OSM — одне місто, як і
 * «Львов» та «Львів».
 */
export function mentionsSettlement(label: string, settlement: string): boolean {
  const want = normPlace(settlement).slice(0, 5);
  if (want.length < 3) return true;
  return label
    .split(",")
    // «Львівська область», «Золочівський район», «Бібрська громада» — не пункт:
    // інакше для «м. Львів» підходило будь-яке село області (Нижній Турів
    // під Самбором замість Нижнього Шувару).
    .filter((part) => !/(област|район|громад|україна|ukraine)/iu.test(part))
    .some((part) => normPlace(part).startsWith(want));
}

/**
 * Запит із терпінням до мережі: обрив з'єднання, 429 чи 5xx — ще дві спроби
 * з паузою. 24.09.2026 прогін по 1321 клієнту впав на 120-му через миттєвий
 * EADDRNOTAVAIL. Після третьої невдачі — кидаємо, а не «не знайдено»:
 * інакше обрив мережі записувався б як FAILED.
 */
async function fetchPatiently(url: string): Promise<Response> {
  const waits = [5_000, 20_000];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (![429, 502, 503, 504].includes(res.status)) return res;
      if (attempt >= waits.length) throw new Error(`Nominatim: HTTP ${res.status} після ${attempt + 1} спроб`);
    } catch (e) {
      if (attempt >= waits.length) throw e;
    }
    await new Promise((r) => setTimeout(r, waits[attempt]));
    lastRequestTime = Date.now();
  }
}

/** Try a single Nominatim search query */
async function nominatimSearch(
  query: string,
  options?: { country?: string; box?: GeoBox; settlement?: string | null }
): Promise<GeocodeHit | null> {
  await waitForRateLimit();

  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "3",
    addressdetails: "1",
    "accept-language": "uk",
  });

  if (options?.country) {
    params.set("countrycodes", options.country);
  }
  if (options?.box) {
    const b = options.box;
    params.set("viewbox", `${b.west},${b.north},${b.east},${b.south}`);
    params.set("bounded", "1");
  }

  const res = await fetchPatiently(`${NOMINATIM_URL}/search?${params}`);
  if (!res.ok) return null;

  const data = (await res.json()) as NominatimRow[];
  if (!Array.isArray(data)) return null;

  for (const row of data) {
    const lat = parseFloat(row.lat);
    const lng = parseFloat(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // bounded=1 уже тримає рамку, але перевіряємо ще раз: вона — головна
    // гарантія, що Жовква знову не опиниться в Криму.
    if (options?.box && !inBox(options.box, lat, lng)) continue;
    if (options?.settlement && !mentionsSettlement(row.display_name, options.settlement)) continue;
    return { lat, lng, displayName: row.display_name, precision: hitPrecision(row) };
  }
  return null;
}

/** Extract possible city/region from address for context */
function extractCity(address: string): string | null {
  // Common pattern: "City, street, number" — take first comma-separated part
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) return parts[0];
  return null;
}

/** Generate search variants by reordering parts */
function generateVariants(address: string, opts: { guessCities: boolean }): string[] {
  const variants: string[] = [];
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length >= 2) {
    // Reverse order: "Поршна, 8" → "8 Поршна"
    variants.push(parts.reverse().join(" "));
    // "Street Number, City" style — try "City Street Number"
    variants.push(parts.join(", "));
  }

  // If it looks like "Street, Number" (short), try with common cities
  if (opts.guessCities && parts.length <= 2 && address.length < 30) {
    const commonCities = ["Вінниця", "Київ", "Хмельницький"];
    const stripped = stripAbbreviations(address);
    for (const city of commonCities) {
      if (!address.toLowerCase().includes(city.toLowerCase())) {
        variants.push(`${city}, ${stripped}`);
      }
    }
  }

  return variants;
}

/**
 * Geocode an address using multiple fallback strategies:
 * 0. Nova Poshta address normalized to «city, street, number»
 * 1. Original text with Ukraine filter
 * 2. Expanded abbreviations with Ukraine filter
 * 3. Stripped abbreviations with Ukraine filter
 * 4. Add "Україна" suffix for context
 * 5. Reordered parts / city appended
 * 6. Without country filter (global search)
 * 7. City + street without the house number
 * 8. The settlement name alone
 *
 * З `preferPrecise` стратегії йдуть, доки не знайдеться будинок або вулиця:
 * центр міста з ранньої стратегії — лише запасний варіант, пізніша може дати
 * вулицю. Без нього — перша знахідка, як і раніше.
 *
 * `box` обмежує пошук рамкою (Львівщина для наших клієнтів). Без неї
 * запасні стратегії знаходили однойменну вулицю в іншій області.
 */
export async function geocodeAddress(
  address: string,
  options: GeocodeOptions = {}
): Promise<GeocodeHit | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const { box, settlement, preferPrecise = false } = options;
  const cacheKey = `${box ? "box:" : ""}${settlement ? `in:${settlement}:` : ""}${preferPrecise ? "p:" : ""}${trimmed.toLowerCase()}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const search = (q: string, country?: string) => nominatimSearch(q, { country, box, settlement });

  let best: GeocodeHit | null = null;
  /** true — кращого не треба, далі не шукаємо. */
  const offer = (hit: GeocodeHit | null, max: GeoPrecision = "HOUSE"): boolean => {
    if (hit) {
      const capped = { ...hit, precision: cap(hit.precision, max) };
      if (!best || RANK[capped.precision] > RANK[best.precision]) best = capped;
    }
    return !!best && (!preferPrecise || RANK[best.precision] >= RANK.STREET);
  };
  const done = () => {
    if (best) cache.set(cacheKey, best);
    return best;
  };

  // Strategy 0: if it looks like a Nova Poshta address, normalize it first
  const npNormalized = normalizeNovaPoshtaAddress(trimmed);
  if (npNormalized) {
    const npExpanded = expandAbbreviations(npNormalized);
    const npStripped = stripAbbreviations(npNormalized);

    // Try normalized NP address with expanded abbreviations
    if (offer(await search(npExpanded, "ua"))) return done();
    if (offer(await search(npStripped, "ua"))) return done();
    // Try just "City, Street" without house number (NP branch may not match exact number)
    const npParts = npStripped.split(",").map((p) => p.trim()).filter(Boolean);
    if (npParts.length >= 2) {
      const cityStreet = npParts.slice(0, 2).join(", ");
      if (offer(await search(cityStreet, "ua"), "STREET")) return done();
    }
    if (best) return done();
  }

  const expanded = expandAbbreviations(trimmed);
  const stripped = stripAbbreviations(trimmed);

  // Strategy 1: original text, Ukraine
  if (offer(await search(trimmed, "ua"))) return done();

  // Strategy 2: expanded abbreviations, Ukraine
  if (expanded !== trimmed && offer(await search(expanded, "ua"))) return done();

  // Strategy 3: stripped abbreviations, Ukraine
  if (stripped !== trimmed && stripped !== expanded && offer(await search(stripped, "ua"))) {
    return done();
  }

  // Strategy 3.5: normalize Russian city names to Ukrainian
  const withUkrCities = normalizeRussianCityNames(expanded);
  if (withUkrCities !== expanded && offer(await search(withUkrCities, "ua"))) return done();

  // Strategy 4: append "Україна" for better context
  if (!best && offer(await search(`${stripped}, Україна`))) return done();

  // Strategy 5: reordered variants and city-appended searches.
  // Здогадки з чужими містами (Вінниця, Київ…) у рамці Львівщини марні.
  if (!best) {
    for (const variant of generateVariants(trimmed, { guessCities: !box })) {
      if (offer(await search(variant, "ua"))) return done();
      if (best) break;
    }
  }

  // Strategy 6: global search as last resort
  if (!best && offer(await search(trimmed))) return done();

  // Strategy 7: drop the house number and any human landmarks.
  //
  // This is the strategy that actually works on our data. Nominatim has poor
  // house-number coverage in Ukraine outside Kyiv: "Львів, Кульпарківська, 93"
  // returns nothing at all, while "Львів, Кульпарківська" answers instantly.
  // Every strategy above keeps the number, so all six fail together on an
  // address that OSM could resolve to the street.
  //
  // The street is enough for a delivery route: the driver needs the block, not
  // the doorstep, and the exact pin gets corrected on site anyway.
  const cityStreet = dropHouseNumber(stripped);
  if (cityStreet && cityStreet !== stripped) {
    if (offer(await search(cityStreet, "ua"), "STREET")) return done();
  }

  // Strategy 8: сам населений пункт, без району і вулиці.
  //
  // «Перемишлянський район с.Липівці» — типова наша адреса: район у ній той,
  // якого вже не існує (після 2020 це Львівський), і Nominatim на такий запит
  // мовчить, хоч село в OSM є. Прізвищеподібний прикметник району теж збиває
  // пошук, тож на останньому кроці кидаємо все, крім назви пункту.
  //
  // Точність — до села, і так і позначається (SETTLEMENT): торговий бачить,
  // куди їхати, а карта не видає це за адресу.
  if (!best) {
    const settlement = settlementOnly(stripped);
    if (settlement) offer(await search(settlement, "ua"), "SETTLEMENT");
  }

  return done();
}

/**
 * Місто й вулиця без номера будинку та орієнтирів.
 *
 * Наші адреси написані для людини, не для геокодера: «м.Черляни (після
 * повороту зліва чорний магазин Інструмент) вул.Миру», «м.Золочів, на базарі
 * маг.», «вул. Коротка, магазин Наша хата, біля площі». Усе, що після назви
 * вулиці, для Nominatim — шум, через який запит не знаходить нічого.
 *
 * Беремо перші дві значущі частини (населений пункт + вулиця) і чистимо
 * від номерів та дужок.
 */
export function dropHouseNumber(address: string): string {
  const parts = address
    .split(",")
    .map((p) => p.replace(/\([^)]*\)/g, " ").trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  const keep: string[] = [];
  for (const part of parts) {
    // Частина, що складається лише з номера («93», «21Б», «34/А»), — це
    // будинок; на ній зупиняємось.
    if (/^\d+\s*[а-яa-zА-ЯA-Z]?(\s*\/\s*\d+\s*[а-яa-zА-ЯA-Z]?)?$/.test(part)) break;

    // Прибираємо номер, приліплений до назви: «вул.Миру 21Б» → «вул.Миру».
    const cleaned = part
      .replace(/№\s*[\dА-Яа-яA-Za-z/\\-]+/g, " ")
      // Знову ж таки не \b, а межа за не-літерою — див. START вище.
      .replace(
        new RegExp(`${START}(буд|будинок|дом|кв|офіс|оф)\\.?\\s*[\\dА-Яа-яA-Za-z/-]*`, "giu"),
        " "
      )
      .replace(/[\dА-Яа-я]*\d+[\dА-Яа-я/-]*\s*$/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned) keep.push(cleaned);
    if (keep.length >= 2) break;
  }

  return keep.join(", ");
}

/**
 * Лише назва населеного пункту — остання надія перед «не знайдено».
 *
 * Розрахунок на те, що назва пункту — це слово БЕЗ районного суфікса.
 * «Перемишлянський район с.Липівці» після stripAbbreviations стає
 * «Перемишлянський Липівці»; прикметник на -ський/-цький/-ий тут завжди про
 * район чи область, а не про село, тож викидаємо його і лишається «Липівці».
 *
 * Повертає порожній рядок, якщо після чистки нічого не лишилось або лишилось
 * те саме, що вже шукали, — тоді дарма ще раз смикати Nominatim.
 */
export function settlementOnly(address: string): string {
  const words = address
    .replace(/\([^)]*\)/g, " ")
    .split(/[,\s]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    // Номери будинків і залишки скорочень назвою пункту бути не можуть.
    .filter((w) => !/\d/.test(w))
    .filter((w) => !/^(район|області|область|районі|району)$/i.test(w))
    // Прикметник району або області: «Перемишлянський», «Львівська».
    .filter((w) => !/(ський|цький|ська|цька|ької|ського)$/i.test(w));

  if (words.length === 0) return "";

  // Беремо найдовше слово: у «Перемишлянський Липівці» після фільтра лишається
  // одне, а в спірних випадках назва пункту довша за прийменники й уточнення.
  const best = words.reduce((a, b) => (b.length > a.length ? b : a));
  return best.length >= 3 && best !== address ? best : "";
}

/**
 * Кандидати для ручного вибору: людина шукає адресу і сама тикає потрібну.
 *
 * Свідомо НЕ використовує ланцюжок стратегій geocodeAddress. Той перебирає
 * до восьми варіантів написання з паузою 1,1 с між запитами — на безнадійній
 * адресі це 9 секунд, і всі інші користувачі стоять у черзі за тим самим
 * глобальним лічильником. Для живого пошуку в полі це неприйнятно: тут
 * рівно один запит, а «нічого не знайшлося» — теж відповідь, бо далі людина
 * поставить пін пальцем.
 */
export async function searchAddressCandidates(
  query: string,
  limit = 6
): Promise<Array<{ lat: number; lng: number; displayName: string }>> {
  await waitForRateLimit();

  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: String(Math.min(Math.max(limit, 1), 10)),
    "accept-language": "uk",
    countrycodes: "ua",
  });

  const res = await fetch(`${NOMINATIM_URL}/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return [];

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  return data
    .map((d: { lat: string; lon: string; display_name: string }) => ({
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
      displayName: d.display_name,
    }))
    .filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng));
}

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<{ lat: number; lng: number; displayName: string; shortName: string } | null> {
  await waitForRateLimit();

  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lng.toString(),
    format: "json",
    "accept-language": "uk",
    zoom: "18",
  });

  const res = await fetch(`${NOMINATIM_URL}/reverse?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data || data.error) return null;

  // Build short name from address parts
  const addr = data.address || {};
  const parts = [
    addr.city || addr.town || addr.village || "",
    addr.road || "",
    addr.house_number || "",
  ].filter(Boolean);

  return {
    lat,
    lng,
    displayName: data.display_name || "",
    shortName: parts.join(", ") || data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
  };
}

export async function geocodeAddresses(
  addresses: string[]
): Promise<Array<({ address: string } & GeocodeHit) | null>> {
  const results: Array<({ address: string } & GeocodeHit) | null> = [];
  for (const address of addresses) {
    const geo = await geocodeAddress(address);
    results.push(geo ? { address, ...geo } : null);
  }
  return results;
}

/**
 * Наскільки точно Nominatim знайшов адресу — за його `addresstype`.
 *
 * ADDRESS — будинок чи об'єкт (магазин, ринок, заклад); STREET — лише
 * вулиця, будинок не впізнано; CITY — лише населений пункт чи ширше.
 * Невідомий тип вважаємо вулицею: ні «точно», ні «лише місто» про нього
 * чесно не скажеш.
 */
export type AddressPrecision = "ADDRESS" | "STREET" | "CITY";

const CITY_TYPES = new Set([
  "city", "town", "village", "hamlet", "isolated_dwelling", "suburb", "quarter", "neighbourhood",
  "municipality", "borough", "city_district", "district", "county", "state", "region", "country", "locality",
]);
const STREET_TYPES = new Set(["road", "street", "square", "postcode"]);

export function precisionOf(addresstype: string | null | undefined): AddressPrecision {
  const t = (addresstype ?? "").toLowerCase();
  if (CITY_TYPES.has(t)) return "CITY";
  if (STREET_TYPES.has(t) || !t) return "STREET";
  if (/^(house|building|shop|amenity|office|craft|tourism|leisure|man_made|industrial|commercial|retail|place|highway|railway|landuse|historic)$/.test(t)) {
    return "ADDRESS";
  }
  return "STREET";
}

/**
 * Запити для ПЕРЕВІРКИ адреси: від повної до самого населеного пункту.
 *
 * Навмисно без хвоста стратегій geocodeAddress — там є пошук без країни і
 * підстановка «Вінниця/Київ/Хмельницький» до коротких адрес, і саме так
 * клієнти ринку «Торпедо» у Львові опинилися під Запоріжжям. Перевірка має
 * або знайти адресу в Україні, або чесно сказати «не знайшов».
 *
 * Префікс Нової пошти («НОВА ПОШТА №15,», «Пункт приймання-видачі»,
 * «Поштомат 5212») прибираємо: Nominatim шукає вулицю, а не відділення.
 */
export function addressLookupQueries(address: string): string[] {
  const cleaned = address
    .replace(/¶/g, " ")
    .replace(/(нова\s*пошта|nova\s*poshta)\s*(№\s*\d+)?/giu, " ")
    .replace(/пункт\s+приймання\s*-?\s*видач[іи]/giu, " ")
    .replace(/(поштомат|відділення)\s*№?\s*\d*/giu, " ")
    .replace(/\(до\s+\d+\s*кг[^)]*\)/giu, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(,\s*)+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, "")
    .trim();
  if (!cleaned) return [];

  const out: string[] = [];
  for (const q of [cleaned, dropHouseNumber(cleaned), settlementOnly(cleaned)]) {
    const t = q.trim();
    if (t.length >= 3 && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Одна знахідка на адресу з позначкою точності — для перевірки точки клієнта.
 *
 * Лише Україна, з перевагою Львівщини (viewbox без bounded: область лише
 * підказка, клієнт у Тернополі теж знайдеться). Перший запит, що дав
 * результат, і є відповідь: «вулицю знайшли, будинок ні» — теж знання.
 */
export async function lookupAddress(
  address: string
): Promise<{ lat: number; lng: number; displayName: string; precision: AddressPrecision; query: string } | null> {
  for (const query of addressLookupQueries(address)) {
    await waitForRateLimit();
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "1",
      "accept-language": "uk",
      countrycodes: "ua",
      viewbox: "22.6,50.7,25.5,48.7",
      bounded: "0",
    });
    const res = await fetch(`${NOMINATIM_URL}/search?${params}`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) continue;
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) continue;
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    return { lat, lng, displayName: String(hit.display_name ?? ""), precision: precisionOf(hit.addresstype), query };
  }
  return null;
}
