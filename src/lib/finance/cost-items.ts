/**
 * Розкладка статей витрат 1С: який це вид витрати і чия вона.
 *
 * У 1С 335 статей із групами (Родитель): «Офіс», «Логістика», «Склад»,
 * «Торговий відділ», магазини DNIPRO M і КУВАЛДА, по одній групі на
 * торгового. Довідник у 1С ми не правимо (1С лише читаємо), тож і «вид», і
 * «власник» виводимо тут — з назви статті й групи. Рішення, прийняте руками
 * в адмінці, захищає `CostItem.manualAt`: класифікатор таку статтю не чіпає.
 *
 * Торгового шукаємо за словом назви («Паливо Кулик», група «Джумага»), і
 * лише коли слово вказує рівно на одну людину: «Премія Дмитро» при двох
 * Дмитрах не належить нікому — краще «компанія», ніж чужа витрата в людини.
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
  { kind: "UTILITIES", words: ["газ", "вода", "світло"], parts: ["комунал", "електроенерг", "опаленн"] },
  { kind: "ADS", words: ["смм", "smm"], parts: ["реклам", "банер", "вивіск", "маркетинг"] },
  { kind: "REPAIR", words: ["сто", "то", "шини"], parts: ["ремонт", "запчаст", "шиномонт", "обслуговуван"] },
  { kind: "COMMS", parts: ["зв'яз", "звяз", "телефон", "інтернет", "мобільн"] },
  { kind: "BANK", parts: ["банк", "комісі", "еквайр"] },
];

export type CostItemClass = { kind: CostKind; scope: CostScope; repId: string | null; storeName: string | null };

export function classifyCostItem(
  name: string,
  groupName: string | null,
  reps: { id: string; name: string }[]
): CostItemClass {
  const text = `${groupName ?? ""} ${name}`;
  const lower = text.toLowerCase().replace(/[’ʼ`]/g, "'");
  const ws = new Set(words(text));

  const rule = KIND_RULES.find((r) => r.words?.some((w) => ws.has(w)) || r.parts?.some((p) => lower.includes(p)));
  const kind: CostKind = rule?.kind ?? "OTHER";

  // Торговий: слово назви чи групи збігається зі словом його імені рівно в одного.
  const matched = reps.filter((r) => words(r.name).some((w) => w.length >= 3 && ws.has(w)));
  if (matched.length === 1) return { kind, scope: "REP", repId: matched[0].id, storeName: null };

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
