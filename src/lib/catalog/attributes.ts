/**
 * Звідки беруться значення атрибутних фільтрів.
 *
 * Обмін із 1С характеристик не віддає взагалі — у номенклатурі є назва, код і
 * опис, і все. Тому єдине джерело, що покриває весь каталог, — сама назва:
 * «Болгарка акумуляторна 18В Ø125», «Круг відрізний 125х1.2х22.2». Поверх неї
 * лягають структуровані характеристики з каталогів виробників і з описів, які
 * колись зібрали скрипти в scripts/vendor-catalog.
 *
 * Модуль чистий (без Prisma), бо його ганяють двома шляхами: масовим прогоном
 * scripts/extract-specs.mts і обміном, коли в товару змінилась назва.
 *
 * Головне правило: НІЧОГО НЕ ВИГАДУВАТИ. Поруч живе src/lib/simulation/specs.ts
 * із такими ж регексами, але його resolveSpecs дописує типові значення там, де
 * даних немає («болгарка без цифр — хай буде 900 Вт, 125 мм»). Для симулятора
 * підбору це доречно, для фільтра — ні: вигадане значення мовчки викидає товар
 * із чужої видачі й так само мовчки додає в чужу. Тому парсимо лише те, що
 * справді написано, а решта лишається NULL.
 */

import type { PowerSource } from "@/lib/catalog/facets";
import { normalizeName } from "@/lib/catalog/classify";

export interface RawAttrs {
  powerSource?: PowerSource;
  discDiameterMm?: number;
  voltageV?: number;
  powerWatts?: number;
}

/** Напруги акумуляторного інструменту. Число поза списком — не напруга. */
const VOLTAGES = [12, 14, 18, 20, 24, 36, 40, 54] as const;

/**
 * Діаметри кругів, що бувають насправді.
 *
 * Білий список, а не «будь-яке число перед мм»: у назві повно інших розмірів —
 * довжина, ширина, посадковий отвір, довжина шини. «Круг 125х1.2х22.2» містить
 * три числа, і лише перше з них діаметр.
 */
const DISCS = [76, 100, 115, 125, 150, 180, 200, 230, 250, 300, 350, 400] as const;

const PETROL = /бензинов|бензо|4\s?[tт]\b|двотактн|двигун внутрішнього/i;
const BATTERY = /акумулятор|акумул\.|«акб»|\bli-ion\b|безщітков/i;
const MAINS = /мережев|електричн|220\s?[вv]\b/i;

/**
 * Групи, де «не акумуляторний» означає «мережевий», і це не здогад.
 *
 * Такий інструмент буває рівно двох видів: від розетки або від батареї (третій
 * варіант, бензиновий, живе в садових групах і тут не трапляється). Батарею в
 * назві позначають завжди — це головний аргумент продажу, — тож її відсутність
 * і є відповіддю.
 *
 * Без цього правила фасет «Живлення» для болгарок покривав 12 позицій із 25:
 * акумуляторні знаходились, а мережеві лишались без значення й випадали з
 * видачі, щойно людина обирала «Від мережі». Половина полиці, невидима саме
 * тоді, коли її шукають, гірша за відсутність фільтра.
 *
 * Садових груп тут немає навмисно: у мотокоси чи ланцюгової пили варіантів
 * три, і мовчання назви не звужує вибір до одного.
 */
const MAINS_BY_DEFAULT = new Set([
  "болгарка", "дриль", "шуруповерт", "гайковерт", "перфоратор", "відбійний-молоток",
  "шліфмашина", "лобзик", "пила-електрична", "фрезер", "електрорубанок", "мийка",
  "пилосос", "точило", "фен-будівельний", "паяльник", "клейовий-пістолет",
]);

/**
 * Атрибути з назви товару.
 *
 * typeKey потрібен, бо те саме число означає різне: у «Круг відрізний
 * 125х1.2х22.2» діаметр стоїть першим числом ланцюжка, а в назві болгарки —
 * після «Ø» чи в коді моделі («AG125», «МШУ-180»).
 */
export function attrsFromName(name: string, typeKey?: string | null): RawAttrs {
  // Через normalizeName — та сама нормалізація, що в класифікаторі: у назвах
  // з 1С трапляються латинські гомогліфи, і «Ø125мм» з латинською «м» інакше
  // не збігся б ні з чим.
  const text = normalizeName(name);
  const out: RawAttrs = {};

  // ── Живлення ────────────────────────────────────────────────────────────
  // Бензин перевіряємо першим: «бензинова мотокоса з акумуляторним запуском»
  // лишається бензиновою.
  if (PETROL.test(text)) out.powerSource = "benzo";
  else if (BATTERY.test(text)) out.powerSource = "akum";
  else if (MAINS.test(text)) out.powerSource = "merezha";

  // ── Напруга акумулятора ────────────────────────────────────────────────
  // «18В», «18 V», «20В Max». Без пробілу теж: у назвах його часто немає.
  for (const m of text.matchAll(/(\d{2})\s*(?:в|v)(?![a-zа-яіїєґ\d])/gi)) {
    const v = Number(m[1]);
    if ((VOLTAGES as readonly number[]).includes(v)) {
      out.voltageV = v;
      break;
    }
  }
  // Напруга акумулятора сама по собі означає акумуляторний інструмент —
  // навіть коли слова «акумуляторна» в назві немає.
  if (out.voltageV && !out.powerSource) out.powerSource = "akum";

  // ── Потужність ─────────────────────────────────────────────────────────
  const kw = text.match(/(\d+[.,]\d+)\s*квт/i);
  if (kw) {
    out.powerWatts = Math.round(parseFloat(kw[1].replace(",", ".")) * 1000);
  } else {
    const w = text.match(/(\d{3,4})\s*(?:вт|w)(?![a-zа-яіїєґ])/i);
    if (w) out.powerWatts = Number(w[1]);
  }
  // Ват без згадки батареї — це мережа. Обережно: лише від 300 Вт, бо
  // дрібніші числа в назвах бувають чим завгодно, і лише коли живлення ще не
  // визначене явним словом.
  if (!out.powerSource && out.powerWatts && out.powerWatts >= 300) out.powerSource = "merezha";
  if (!out.powerSource && typeKey && MAINS_BY_DEFAULT.has(typeKey)) out.powerSource = "merezha";

  // ── Діаметр диска ──────────────────────────────────────────────────────
  const disc = discFromName(text, typeKey);
  if (disc) out.discDiameterMm = disc;

  return out;
}

/** Групи, де перше число назви — це діаметр: «125х1.2х22.2». */
const DISC_TYPES = new Set([
  "відрізний-круг",
  "шліфувальний-круг",
  "алмазний-диск",
  "пиляльний-диск",
]);

function discFromName(text: string, typeKey?: string | null): number | undefined {
  const pick = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined;
    const v = Number(raw);
    return (DISCS as readonly number[]).includes(v) ? v : undefined;
  };

  if (typeKey && DISC_TYPES.has(typeKey)) {
    // Ланцюжок розмірів круга: діаметр × товщина × посадка. Беремо перше
    // число — саме воно стоїть на етикетці й саме про нього питає покупець.
    const chain = text.match(/(?:^|[^\d])(\d{2,3})\s*[хx×*]\s*\d/i);
    const fromChain = pick(chain?.[1]);
    if (fromChain) return fromChain;
  }

  // «Ø125», «Ø 125 мм», «діаметр 125»
  const marked = text.match(/(?:ø|діаметр(?:\s+диска)?)\s*(\d{2,3})/i);
  const fromMarked = pick(marked?.[1]);
  if (fromMarked) return fromMarked;

  // Код моделі: «AG125», «GAG 125», «МШУ-180/1900», «WS 230».
  const model = text.match(/(?:^|[^\d])(?:ag|ws|мшу|кшм|gag)[\s-]*(\d{3})(?![\d])/i);
  const fromModel = pick(model?.[1]);
  if (fromModel) return fromModel;

  // Звичайне «125 мм» — останнім, бо в назві таких чисел буває кілька.
  const mm = text.match(/(?:^|[^\d])(\d{2,3})\s*мм/i);
  return pick(mm?.[1]);
}

/**
 * Характеристики з опису у форматі одного рядка.
 *
 * «Характеристики — Матеріал: CrV; Довжина: 250 мм.» — так їх пише
 * scripts/vendor-catalog і scripts/polax-catalog-sync. Булітний формат
 * («Характеристики:\n• Ключ: значення») розбирає splitDescription із
 * description-sections.ts, а цей досі не розбирав ніхто: пари лежали в тексті
 * картки й нікуди більше не йшли.
 */
export function splitInlineSpecs(description: string): { key: string; value: string }[] {
  const m = description.match(/характеристики\s*[—–-]\s*([^\n]+)/i);
  if (!m) return [];

  return m[1]
    .replace(/\.\s*$/, "")
    .split(";")
    .map((chunk) => {
      const pair = chunk.match(/^\s*([^:]{1,40}):\s*(.+?)\s*$/);
      return pair ? { key: pair[1].trim(), value: pair[2].trim() } : null;
    })
    .filter((x): x is { key: string; value: string } => x !== null);
}

/** Ключі характеристик, що нас цікавлять. Решта пар лишається в описі. */
const KEY_POWER = /живлен|тип двигун|тип живлен|джерело живлен/i;
const KEY_DISC = /діаметр\s*(диск|круг|кола)|діаметр,\s*мм$|^діаметр$/i;
const KEY_VOLT = /напруга(\s*акумулятор)?|вольтаж/i;
const KEY_WATT = /^потужн|потужність(,\s*вт)?/i;

/**
 * Атрибути з пар «ключ: значення».
 *
 * Спільний шлях для описів (обох форматів) і для характеристик із сайтів
 * виробників — вони приходять однаковими парами, тож і розбираються однаково.
 */
export function attrsFromSpecPairs(pairs: { key: string; value: string }[]): RawAttrs {
  const out: RawAttrs = {};

  for (const { key, value } of pairs) {
    // Ключі з сайтів бувають із двокрапкою в кінці («Матеріал:»).
    const k = key.replace(/:$/, "").trim();
    const v = value.trim();
    if (!k || !v) continue;

    if (!out.powerSource && KEY_POWER.test(k)) {
      if (PETROL.test(v)) out.powerSource = "benzo";
      else if (/акумулятор|батаре/i.test(v)) out.powerSource = "akum";
      else if (/мереж|електр|220/i.test(v)) out.powerSource = "merezha";
    }

    if (out.discDiameterMm === undefined && KEY_DISC.test(k)) {
      const n = Number(v.match(/(\d{2,3})/)?.[1]);
      if ((DISCS as readonly number[]).includes(n)) out.discDiameterMm = n;
    }

    if (out.voltageV === undefined && KEY_VOLT.test(k)) {
      const n = Number(v.match(/(\d{2})/)?.[1]);
      if ((VOLTAGES as readonly number[]).includes(n)) out.voltageV = n;
    }

    if (out.powerWatts === undefined && KEY_WATT.test(k)) {
      const kw = v.match(/(\d+[.,]?\d*)\s*квт/i);
      if (kw) out.powerWatts = Math.round(parseFloat(kw[1].replace(",", ".")) * 1000);
      else {
        const n = Number(v.match(/(\d{3,4})/)?.[1]);
        if (n >= 100 && n <= 9000) out.powerWatts = n;
      }
    }
  }

  if (out.voltageV && !out.powerSource) out.powerSource = "akum";
  return out;
}

/**
 * Злиття джерел: перше визначене значення виграє.
 *
 * Порядок задає той, хто викликає, — він різний для різних полів. Живлення
 * найнадійніше в назві («Болгарка акумуляторна» — це факт із етикетки), а
 * числа навпаки: структурована пара «Діаметр диска: 125 мм» точніша за
 * вгадування числа серед інших чисел назви.
 */
export function mergeAttrs(...sources: RawAttrs[]): RawAttrs {
  const out: RawAttrs = {};
  for (const src of sources) {
    if (out.powerSource === undefined && src.powerSource !== undefined) out.powerSource = src.powerSource;
    if (out.discDiameterMm === undefined && src.discDiameterMm !== undefined) out.discDiameterMm = src.discDiameterMm;
    if (out.voltageV === undefined && src.voltageV !== undefined) out.voltageV = src.voltageV;
    if (out.powerWatts === undefined && src.powerWatts !== undefined) out.powerWatts = src.powerWatts;
  }
  return out;
}
