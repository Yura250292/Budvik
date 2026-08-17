const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "Budvik-ERP/1.0 (delivery route planner)";

// In-memory cache to avoid duplicate lookups
const cache = new Map<string, { lat: number; lng: number; displayName: string }>();

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

/** Try a single Nominatim search query */
async function nominatimSearch(
  query: string,
  options?: { structured?: boolean; country?: string }
): Promise<{ lat: number; lng: number; displayName: string } | null> {
  await waitForRateLimit();

  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "3",
    "accept-language": "uk",
  });

  if (options?.country) {
    params.set("countrycodes", options.country);
  }

  const res = await fetch(`${NOMINATIM_URL}/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data.length) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    displayName: data[0].display_name as string,
  };
}

/** Extract possible city/region from address for context */
function extractCity(address: string): string | null {
  // Common pattern: "City, street, number" — take first comma-separated part
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) return parts[0];
  return null;
}

/** Generate search variants by reordering parts */
function generateVariants(address: string): string[] {
  const variants: string[] = [];
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length >= 2) {
    // Reverse order: "Поршна, 8" → "8 Поршна"
    variants.push(parts.reverse().join(" "));
    // "Street Number, City" style — try "City Street Number"
    variants.push(parts.join(", "));
  }

  // If it looks like "Street, Number" (short), try with common cities
  if (parts.length <= 2 && address.length < 30) {
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
 * 1. Original text with Ukraine filter
 * 2. Expanded abbreviations with Ukraine filter
 * 3. Stripped abbreviations with Ukraine filter
 * 4. Add "Україна" suffix for context
 * 5. Reordered parts / city appended
 * 6. Without country filter (global search)
 */
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; displayName: string } | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const cacheKey = trimmed.toLowerCase();
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  // Strategy 0: if it looks like a Nova Poshta address, normalize it first
  const npNormalized = normalizeNovaPoshtaAddress(trimmed);
  if (npNormalized) {
    const npExpanded = expandAbbreviations(npNormalized);
    const npStripped = stripAbbreviations(npNormalized);

    // Try normalized NP address with expanded abbreviations
    let result = await nominatimSearch(npExpanded, { country: "ua" });
    if (!result) {
      result = await nominatimSearch(npStripped, { country: "ua" });
    }
    // Try just "City, Street" without house number (NP branch may not match exact number)
    if (!result) {
      const npParts = npStripped.split(",").map((p) => p.trim()).filter(Boolean);
      if (npParts.length >= 2) {
        // Try city + street (without house number)
        const cityStreet = npParts.slice(0, 2).join(", ");
        result = await nominatimSearch(cityStreet, { country: "ua" });
      }
    }
    if (result) {
      cache.set(cacheKey, result);
      return result;
    }
  }

  const expanded = expandAbbreviations(trimmed);
  const stripped = stripAbbreviations(trimmed);

  // Strategy 1: original text, Ukraine
  let result = await nominatimSearch(trimmed, { country: "ua" });

  // Strategy 2: expanded abbreviations, Ukraine
  if (!result && expanded !== trimmed) {
    result = await nominatimSearch(expanded, { country: "ua" });
  }

  // Strategy 3: stripped abbreviations, Ukraine
  if (!result && stripped !== trimmed && stripped !== expanded) {
    result = await nominatimSearch(stripped, { country: "ua" });
  }

  // Strategy 3.5: normalize Russian city names to Ukrainian
  if (!result) {
    const withUkrCities = normalizeRussianCityNames(expanded);
    if (withUkrCities !== expanded) {
      result = await nominatimSearch(withUkrCities, { country: "ua" });
    }
  }

  // Strategy 4: append "Україна" for better context
  if (!result) {
    const withCountry = `${stripped}, Україна`;
    result = await nominatimSearch(withCountry);
  }

  // Strategy 5: reordered variants and city-appended searches
  if (!result) {
    const variants = generateVariants(trimmed);
    for (const variant of variants) {
      result = await nominatimSearch(variant, { country: "ua" });
      if (result) break;
    }
  }

  // Strategy 6: global search as last resort
  if (!result) {
    result = await nominatimSearch(trimmed);
  }

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
  if (!result) {
    const cityStreet = dropHouseNumber(stripped);
    if (cityStreet && cityStreet !== stripped) {
      result = await nominatimSearch(cityStreet, { country: "ua" });
    }
  }

  // Strategy 8: сам населений пункт, без району і вулиці.
  //
  // «Перемишлянський район с.Липівці» — типова наша адреса: район у ній той,
  // якого вже не існує (після 2020 це Львівський), і Nominatim на такий запит
  // мовчить, хоч село в OSM є. Прізвищеподібний прикметник району теж збиває
  // пошук, тож на останньому кроці кидаємо все, крім назви пункту.
  //
  // Точність — до села. Для бази торгового це прийнятно: подача рахується
  // десятками кілометрів, і хата в межах села їх не змінює.
  if (!result) {
    const settlement = settlementOnly(stripped);
    if (settlement) {
      result = await nominatimSearch(settlement, { country: "ua" });
    }
  }

  if (result) {
    cache.set(cacheKey, result);
  }

  return result;
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
): Promise<Array<{ address: string; lat: number; lng: number; displayName: string } | null>> {
  const results: Array<{ address: string; lat: number; lng: number; displayName: string } | null> = [];
  for (const address of addresses) {
    const geo = await geocodeAddress(address);
    results.push(geo ? { address, ...geo } : null);
  }
  return results;
}
