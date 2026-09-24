/**
 * Розкладка статей витрат 1С: який це вид витрати і чия вона.
 *
 * У 1С 335 статей із групами (Родитель): «Офіс», «Логістика», «Склад»,
 * «Торговий відділ», магазини DNIPRO M і КУВАЛДА, по одній групі на
 * торгового. Довідник у 1С ми не правимо (1С лише читаємо), тож і «вид», і
 * «власник» виводимо тут — з назви статті й групи. Рішення, прийняте руками
 * в адмінці, захищає `CostItem.manualAt`: класифікатор таку статтю не чіпає.
 *
 * Торгового шукаємо тим самим правилом, що й обмін для накладних
 * (apply-documents.ts): людина — та, чиї ВСІ слова імені на сайті є в групі
 * чи назві статті 1С, і лише коли така одна. Група «Кулик Дмитро» — Кулик,
 * хоча «Дмитро» є й у Передрія. Для статті без групи («Паливо Кулик») —
 * запасне правило: слово, яке з торгових має лише одна людина. «Премія
 * Дмитро» при двох Дмитрах не належить нікому — краще «фірма», ніж чужа
 * витрата в людини.
 *
 * `\b` у регулярних виразах JS кирилицю не бачить, тому короткі слова
 * («зп», «дп», «сто», «газ») перевіряємо як окремі слова, а решту — входженням.
 */

export type CostKind =
  | "SALARY"
  | "FUEL"
  | "RENT"
  | "TAX"
  | "UTILITIES"
  | "ADS"
  | "CLIENT_BONUS"
  | "GPS"
  | "DEPRECIATION"
  | "REPAIR"
  | "SECURITY"
  | "ACCOUNTING"
  | "COMMS"
  | "BANK"
  | "INVENTORY"
  | "HOUSEHOLD"
  | "DELIVERY"
  | "STAFF"
  | "OTHER";

export type CostScope = "COMPANY" | "OFFICE" | "WAREHOUSE" | "LOGISTICS" | "SALES" | "STORE" | "REP";

export const COST_KIND_LABELS: Record<CostKind, string> = {
  SALARY: "зарплата",
  FUEL: "пальне",
  RENT: "оренда",
  TAX: "податки",
  UTILITIES: "комунальні",
  ADS: "реклама",
  CLIENT_BONUS: "бонуси клієнтам",
  GPS: "GPS",
  DEPRECIATION: "амортизація",
  REPAIR: "ремонт і обслуговування",
  SECURITY: "охорона",
  ACCOUNTING: "бухгалтерія",
  COMMS: "звʼязок",
  BANK: "банк",
  INVENTORY: "недостачі й надлишки",
  HOUSEHOLD: "господарські потреби",
  DELIVERY: "транспорт і доставка",
  STAFF: "персонал (крім зарплати)",
  OTHER: "інше",
};

export const COST_SCOPE_LABELS: Record<CostScope, string> = {
  COMPANY: "фірма",
  OFFICE: "офіс",
  WAREHOUSE: "склад",
  LOGISTICS: "логістика",
  SALES: "торговий відділ",
  STORE: "магазини",
  REP: "торгові поіменно",
};

/** Слова рядка в нижньому регістрі; апостроф — частина слова («звʼязок»). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);
}

type Rule = { kind: CostKind; words?: string[]; parts?: string[] };

/** Порядок важливий: «ЗП СММ» — зарплата, а не реклама; «Амортизація авто» — не ремонт. */
const KIND_RULES: Rule[] = [
  { kind: "INVENTORY", parts: ["недостач", "надлиш", "списанн"] },
  { kind: "SALARY", words: ["зп"], parts: ["зарплат", "заробітн", "премі"] },
  { kind: "FUEL", words: ["дп"], parts: ["палив", "пальн", "бензин", "дизел", "заправ"] },
  { kind: "DEPRECIATION", parts: ["амортиз"] },
  { kind: "GPS", words: ["gps"], parts: ["трекер", "геолок"] },
  { kind: "CLIENT_BONUS", parts: ["бонус"] },
  { kind: "RENT", parts: ["оренд"] },
  { kind: "TAX", words: ["єсв", "есв", "пдв", "пдфо", "ндфл"], parts: ["податк", "військов"] },
  { kind: "SECURITY", parts: ["охорон"] },
  { kind: "ACCOUNTING", parts: ["бухгалт", "медок", "m.e.doc"] },
  { kind: "UTILITIES", words: ["газ", "вода", "світло"], parts: ["комунал", "електроенерг", "електропостач", "опаленн", "утримання об"] },
  // Банк раніше за рекламу: «Затрати на прийом платежів з ПРОМ» — комісія, а не Prom.
  { kind: "BANK", parts: ["банк", "комісі", "еквайр", "платеж"] },
  { kind: "ADS", words: ["смм", "smm", "пром", "prom"], parts: ["реклам", "банер", "вивіск", "маркетинг"] },
  { kind: "REPAIR", words: ["сто", "то", "шини"], parts: ["ремонт", "запчаст", "шиномонт", "обслуговуван"] },
  { kind: "HOUSEHOLD", words: ["чай", "кава"], parts: ["прибиран", "господарськ", "побутов", "канцтовар", "інвентар"] },
  { kind: "DELIVERY", parts: ["доставк", "пошт", "транспортн", "перевезен"] },
  { kind: "STAFF", parts: ["співробітник", "персонал", "навчанн"] },
  { kind: "COMMS", parts: ["зв'яз", "звяз", "телефон", "інтернет", "мобільн"] },
];

function kindOf(text: string): CostKind | null {
  const lower = text.toLowerCase().replace(/[’ʼ`]/g, "'");
  const ws = new Set(words(text));
  return KIND_RULES.find((r) => r.words?.some((w) => ws.has(w)) || r.parts?.some((p) => lower.includes(p)))?.kind ?? null;
}

export type CostItemClass = { kind: CostKind; scope: CostScope; repId: string | null; storeName: string | null };

export function classifyCostItem(
  name: string,
  groupName: string | null,
  reps: { id: string; name: string }[]
): CostItemClass {
  const text = `${groupName ?? ""} ${name}`;
  const lower = text.toLowerCase().replace(/[’ʼ`]/g, "'");

  // Вид — спершу з назви статті, і лише коли вона мовчить — з групи: у групі
  // «Інтернет/Пром» лежать і Нова Пошта, і зв'язок, і канцтовари, і слово
  // «пром» у групі робило б їх усіх рекламою.
  const kind: CostKind = kindOf(name) ?? (groupName ? kindOf(groupName) : null) ?? "OTHER";

  const repId = matchRep(groupName, name, reps);
  if (repId) return { kind, scope: "REP", repId, storeName: null };

  if (/dnipro|кувалд|магазин/i.test(text)) {
    return { kind, scope: "STORE", repId: null, storeName: (groupName ?? name).trim() };
  }
  const scope: CostScope = lower.includes("офіс")
    ? "OFFICE"
    : lower.includes("склад")
      ? "WAREHOUSE"
      : /логіст|водії|водій|доставк|розвозк/.test(lower)
        ? "LOGISTICS"
        : lower.includes("торгов")
          ? "SALES"
          : "COMPANY";
  return { kind, scope, repId: null, storeName: null };
}

/**
 * Торговий статті. Спершу правило накладних: усі слова імені людини на сайті
 * є в групі (а тоді в назві) статті, і така людина одна. Далі запасне: слово
 * з імені, яке серед торгових має лише одна людина («кулик»), — щоб «Паливо
 * Кулик» без групи теж знайшов Кулика, а спільне «дмитро» нікого не ловило.
 */
function matchRep(groupName: string | null, name: string, reps: { id: string; name: string }[]): string | null {
  const people = reps.map((r) => ({ id: r.id, words: new Set(words(r.name).filter((w) => w.length >= 3)) })).filter((p) => p.words.size > 0);

  for (const text of [groupName, name]) {
    if (!text) continue;
    const ws = new Set(words(text));
    const all = people.filter((p) => [...p.words].every((w) => ws.has(w)));
    if (all.length === 1) return all[0].id;
    if (all.length > 1) return null;
  }

  const owners = new Map<string, Set<string>>();
  for (const p of people) for (const w of p.words) owners.set(w, (owners.get(w) ?? new Set()).add(p.id));
  const ws = new Set(words(`${groupName ?? ""} ${name}`));
  const hits = new Set<string>();
  for (const w of ws) {
    const o = owners.get(w);
    if (o && o.size === 1) hits.add([...o][0]);
  }
  if (hits.size !== 1) return null;
  const id = [...hits][0];
  // Слово з імені ІНШОЇ людини поруч — інша людина з тим самим прізвищем:
  // «Калашник Дмитро» в 1С — не Калашник Дарья на сайті, хоч прізвище одне.
  const conflict = [...ws].some((w) => owners.has(w) && !owners.get(w)!.has(id));
  return conflict ? null : id;
}
