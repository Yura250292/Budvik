/**
 * Тексти пропозицій клієнту — шаблони, а не модель.
 *
 * Чистий модуль: без Prisma, без next/* і без мережі. Його перевіряє
 * scripts/check-outreach.mts, і він мусить давати той самий текст на сервері,
 * у скрипті й у майбутній кампанії.
 *
 * Чому шаблони. Повідомлення йде від імені торгового на його особистий номер
 * клієнта, і одне вигадане «знижка 10%» коштує більше, ніж тисяча вдалих
 * текстів: ціни ставить 1С, сайт їх змінити не може, і торговий опиниться між
 * клієнтом, якому пообіцяли, і офісом, який не давав. Модель такого слова не
 * гарантує, шаблон — гарантує, а assertNoInventedDiscount ловить помилку
 * в самих шаблонах ще до відправки.
 *
 * Варіантів кілька на вид, щоб п'ятеро клієнтів одного торгового, які
 * знайомі між собою, не отримали слово в слово однаковий текст. Вибір
 * стабільний у межах дня: відкривши картку двічі, торговий бачить той самий
 * текст, а «Інший варіант» перемикає руками.
 */

import { MAX_OFFER_CHARS, type OutreachKind } from "./types";

const NBSP = " ";

/* ---------- Назва клієнта й звертання ---------- */

/**
 * Назва клієнта для людини: без хвостів у дужках.
 *
 * У 1С назва — це ще й записник: «Будмаркет (Жовква, вул. Львівська)»,
 * «ФОП Петренко І.І. (борг, лише передоплата)». Торговому на екрані й у
 * тексті це заважає, а клієнт такий «підпис» про себе бачити не повинен.
 * «ФОП …» лишаємо: для клієнта це і є його назва.
 */
export function displayClientName(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  let out = clean;
  // Дужки знімаємо лише з кінця і лише цілі: «ТОВ (Будцентр) Захід» —
  // це вже частина назви, а не приписка.
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/\s*[([][^()[\]]*[)\]]\s*$/, "").trim();
    if (next === out) break;
    out = next;
  }
  out = out.replace(/[\s,;:–—-]+$/, "").trim();
  return out || clean;
}

/** Слово схоже на ім'я: лише літери, апостроф і дефіс, з великої. */
const NAME_WORD = /^[А-ЯҐЄІЇA-Z][а-яґєіїa-z'’ʼ-]{1,20}$/;
/** По батькові: «Іванович», «Петрівна», «Олексіївна». */
const PATRONYMIC = /(ович|евич|євич|йович|ївна|івна|овна|евна)$/i;

/**
 * Ім'я для звертання — або null, коли вгадувати небезпечно.
 *
 * Контактна особа в 1С записана як завгодно: «Іван», «Петренко Іван
 * Іванович», «Іван Іванович», «директор Олег 067…». Беремо ім'я лише там, де
 * воно однозначне: одне слово або слово перед по батькові. «Петренко Іван» без
 * по батькові — або прізвище й ім'я, або ім'я й прізвище; «Добрий день,
 * Петренко!» гірше за «Вітаю!», тож тоді не вгадуємо.
 *
 * Кличного відмінка не будуємо: «Олег → Олеже», «Ігор → Ігоре» ламаються на
 * першому ж нетиповому імені, а «Добрий день, Олег!» у месенджері звучить
 * природно.
 */
export function greetingName(contactPerson: string | null | undefined, clientName?: string | null): string | null {
  const fromPerson = firstNameOf(contactPerson);
  if (fromPerson) return fromPerson;

  // ФОП без контактної особи — сама людина: «ФОП Петренко Іван Іванович».
  const fop = (clientName ?? "").match(/^\s*ФОП\s+(.+)$/i);
  if (fop) {
    const words = displayClientName(fop[1]).split(" ").filter(Boolean);
    if (words.length === 3 && PATRONYMIC.test(words[2]) && NAME_WORD.test(words[1])) return words[1];
  }
  return null;
}

function firstNameOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Телефон чи посада поруч з іменем — не ім'я; ріжемо по першій цифрі.
  const head = raw.split(/[\d,;/(]/)[0].replace(/\s+/g, " ").trim();
  const words = head.split(" ").filter(Boolean);
  if (words.length === 0 || words.some((w) => !NAME_WORD.test(w))) return null;
  if (words.length === 1) return words[0];
  if (words.length === 2 && PATRONYMIC.test(words[1])) return words[0];
  if (words.length === 3 && PATRONYMIC.test(words[2])) return words[1];
  return null;
}

export function greetingFor(name: string | null): string {
  return name ? `Добрий день, ${name}!` : "Вітаю!";
}

/* ---------- Гроші й товари ---------- */

/**
 * «1 234 ₴», «12,50 ₴».
 *
 * Копійки не округлюємо: у розхідника опт буває 12,50, і «13 ₴» у
 * повідомленні — це вже інша ціна, ніж у накладній. Пробіли нерозривні:
 * Viber не переносить «₴» на новий рядок окремо від числа.
 */
export function formatUah(n: number): string {
  const cents = Math.round(Math.abs(n) * 100);
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const frac = cents % 100;
  return `${n < 0 && cents > 0 ? "-" : ""}${whole}${frac ? `,${String(frac).padStart(2, "0")}` : ""}${NBSP}₴`;
}

/**
 * Назва товару для повідомлення.
 *
 * «[4]» у кінці назви з 1С — кількість у ящику (див. pack-qty), клієнту це
 * шум. Довгу назву ріжемо по слову: у Viber рядок товару має вміщатися в
 * два рядки екрана.
 */
export function shortProductName(name: string, max = 56): string {
  const clean = name.replace(/\s*\[[^\]]*\]\s*$/, "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

export type OfferLineProduct = {
  name: string;
  wholesalePrice: number | null;
  /** Клієнт цей товар уже купував. Невідомо — вважаємо, що ні. */
  boughtBefore?: boolean;
};

/** «• Піна SOMA FIX 750 мл — 185 ₴ (опт)». Без опту ціну не називаємо. */
export function productLine(p: OfferLineProduct, maxName = 56): string {
  const price = p.wholesalePrice && p.wholesalePrice > 0 ? ` — ${formatUah(p.wholesalePrice)} (опт)` : "";
  return `• ${shortProductName(p.name, maxName)}${price}`;
}

/**
 * Чи брав клієнт товари зі списку: усі, жодного чи частину.
 *
 * Від цього залежить, що в тексті правда. «Є те, що ви у нас брали» над
 * кругом, якого клієнт ніколи не купував, — брехня, яку він помітить першою:
 * заміряно 14.09 на бойовій базі, коли клієнту без повторних покупок товари
 * добирали гачками помічника («беруть 13 ваших клієнтів, цей — ще ні»).
 */
export type ProductsOwnership = "ALL" | "NONE" | "MIXED";

export function ownershipOf(products: readonly OfferLineProduct[]): ProductsOwnership {
  const own = products.filter((p) => p.boughtBefore).length;
  if (products.length > 0 && own === products.length) return "ALL";
  return own === 0 ? "NONE" : "MIXED";
}

/* ---------- Заборонені слова ---------- */

/**
 * Те, чого сайт пообіцяти не може: знижка, акція, відсоток, подарунок.
 *
 * Ціни ставить 1С. Слово «знижка» в тексті, який склав сайт, означає
 * обіцянку, якої ніхто не давав, — тож дозволене воно лише в PROMO і лише
 * всередині умов, які вписала людина.
 */
const DISCOUNT_WORDS =
  // [а-яіїєґ] замість \w: у JS \w — лише латиниця, і «спеціальна ціна» проскакувала б.
  /(%|відсот|знижк|скидк|акці|розпродаж|дешевш|спецці|спеціальн[а-яіїєґ]*\s+цін|вигідн[а-яіїєґ]*\s+цін|безкоштовн|подарун|бонус|кешбек|промокод|\bsale\b)/i;

export function findInventedDiscount(text: string, kind: OutreachKind, promoText?: string | null): string | null {
  let rest = text;
  if (kind === "PROMO" && promoText) rest = rest.split(promoText.trim()).join(" ");
  // Посилання не перевіряємо: у ньому slug товару, а там буває що завгодно.
  rest = rest.replace(/https?:\/\/\S+/g, " ");
  const m = rest.match(DISCOUNT_WORDS);
  return m ? m[0] : null;
}

export class OfferTextError extends Error {}

export function assertNoInventedDiscount(text: string, kind: OutreachKind, promoText?: string | null): void {
  if (kind === "PROMO" && !promoText?.trim()) {
    throw new OfferTextError("Акцію без умов від офісу не складаємо");
  }
  const word = findInventedDiscount(text, kind, promoText);
  if (word) throw new OfferTextError(`У тексті «${word}» — сайт не може обіцяти знижок`);
}

/* ---------- Шаблони ---------- */

export type OfferVars = {
  counterpartyId: string;
  /** Ім'я для звертання або null («Вітаю!»). */
  greetingName: string | null;
  /** Ім'я торгового так, як воно в обліковці; null — лише «Budvik». */
  repName: string | null;
  products: OfferLineProduct[];
  /** Посилання на товар (з `to`) — або null, якщо без посилання. */
  link: string | null;
  /** Те саме посилання без `to` — коротше, ним заміняємо при нестачі місця. */
  shortLink?: string | null;
  /** Сальдо боргу для DEBT. */
  debtAmount?: number | null;
  /** Умови акції, вписані людиною, — лише для PROMO. */
  promoText?: string | null;
};

type IntroCtx = { has: boolean; own: ProductsOwnership };

type Template = {
  /** Перший рядок після привітання: зі списком товарів, без нього, і що про товари правда. */
  intro: (v: OfferVars, ctx: IntroCtx) => string;
  outro: string | null;
};

/**
 * Жодного дієслова минулого часу від першої особи й жодного «радий»:
 * серед торгових є жінки, і «хотів уточнити» від Дарини — помилка, яку
 * клієнт помітить першою.
 *
 * «Ви брали / берете регулярно» — лише коли own = ALL; «у вас ще немає» —
 * лише коли NONE. Решта формулювань правдива за будь-якого списку.
 */
const TEMPLATES: Record<OutreachKind, Template[]> = {
  WIN_BACK: [
    {
      intro: (_, { has, own }) =>
        !has
          ? "Давно не чулися, тож нагадаю про себе. Якщо щось потрібно з інструменту чи розхідників — пишіть."
          : own === "ALL"
            ? "Давно не чулися, тож нагадаю про себе. Зараз на складі є те, що ви у нас брали:"
            : "Давно не чулися, тож нагадаю про себе. Ось що зараз є на складі:",
      outro: "Якщо актуально — напишіть, підготую замовлення.",
    },
    {
      intro: (_, { has }) =>
        has
          ? "Давно вас не було в нас. Пишу підказати, що зараз у наявності:"
          : "Давно вас не було в нас. Підкажіть, чи можу чимось допомогти?",
      outro: "Скажіть, чи ставити в замовлення, — привеземо з найближчою доставкою.",
    },
    {
      intro: (_, { has, own }) =>
        !has
          ? "Пишу уточнити, чи все гаразд і чи можу чимось допомогти з поставками."
          : own === "ALL"
            ? "Пишу уточнити, чи все гаразд і чи можу чимось допомогти. З того, що ви брали, зараз є:"
            : "Пишу уточнити, чи все гаразд і чи можу чимось допомогти. Зараз у наявності:",
      outro: "Заздалегідь дякую за відповідь.",
    },
    {
      intro: (_, { has, own }) =>
        !has
          ? "Нагадую про себе: якщо знадобиться товар, пишіть — підберу й оформлю."
          : own === "ALL"
            ? "Якщо знову знадобляться ці позиції — вони є на складі:"
            : "Нагадую про себе — ось що зараз є на складі:",
      outro: "Напишіть кількість — усе оформлю.",
    },
  ],
  REPLENISH: [
    {
      intro: (_, { has, own }) =>
        !has
          ? "Пишу щодо поповнення: якщо щось закінчується, скажіть — перевірю наявність і оформлю."
          : own === "ALL"
            ? "Схоже, у вас уже закінчуються позиції, які ви берете регулярно. На складі є:"
            : "Пишу щодо поповнення. Зараз на складі є:",
      outro: "Якщо поповнюємо — напишіть кількість.",
    },
    {
      intro: (_, { has, own }) =>
        !has
          ? "Нагадую про поповнення — підкажіть, чого бракує?"
          : own === "ALL"
            ? "Нагадую про поповнення — за вашим звичним графіком саме час. У наявності:"
            : "Нагадую про поповнення. У наявності:",
      outro: "Скажіть, скільки ставити в замовлення.",
    },
    {
      intro: (_, { has, own }) =>
        !has
          ? "Пропоную поповнити запас — підкажіть, чого бракує."
          : own === "ALL"
            ? "Пропоную поповнити запас того, що ви берете постійно:"
            : "Пропоную поповнити запас — зараз є:",
      outro: "Можу оформити вже сьогодні.",
    },
  ],
  ARRIVALS: [
    {
      intro: (_, { has, own }) =>
        !has
          ? "На склад приїхала свіжа поставка."
          : own === "ALL"
            ? "На склад приїхало те, що ви у нас брали:"
            : "На склад приїхала свіжа поставка:",
      outro: "Якщо потрібно — напишіть, оформлю замовлення.",
    },
    {
      intro: (_, { has, own }) =>
        !has ? "Прийшла свіжа поставка." : own === "ALL" ? "Знову є в наявності позиції, які ви замовляли:" : "Знову є в наявності:",
      outro: "Напишіть, чи ставити в замовлення.",
    },
    {
      intro: (_, { has, own }) =>
        !has ? "Прийшла поставка." : own === "ALL" ? "Прийшла поставка, і серед неї ваші позиції:" : "Прийшла поставка, зокрема:",
      outro: "Скажіть кількість — підготую замовлення.",
    },
  ],
  DEVELOP: [
    {
      intro: (_, { has, own }) =>
        !has
          ? "Хочу запропонувати розширити асортимент — підкажіть, що зараз добре йде у вас, підберу схоже."
          : own === "NONE"
            ? "Хочу запропонувати позиції, які добре беруть магазини, схожі на ваш:"
            : "Хочу запропонувати кілька позицій, які зараз є на складі:",
      outro: "Якщо цікаво — розповім детальніше або покажу при зустрічі.",
    },
    {
      intro: (_, { has, own }) =>
        !has
          ? "Можливо, вам буде цікаво розширити асортимент — можу підібрати, що зараз беруть інші наші клієнти."
          : own === "NONE"
            ? "Можливо, вам буде цікаво розширити асортимент. Ці товари зараз беруть інші наші клієнти:"
            : "Можливо, вам буде цікаво розширити асортимент. Зараз у наявності:",
      outro: "Напишіть, якщо щось підходить.",
    },
    {
      intro: (_, { has, own }) =>
        !has
          ? "Є кілька позицій, які добре продаються в інших магазинах, — можу розповісти."
          : own === "NONE"
            ? "Є кілька позицій, яких у вас ще немає, а в інших магазинах вони добре продаються:"
            : "Є кілька позицій, які варто мати в асортименті:",
      outro: "Можу підготувати невелику пробну партію — скажіть, що цікаво.",
    },
  ],
  PROMO: [
    {
      intro: (v) => `Коротко про актуальну пропозицію: ${v.promoText?.trim() ?? ""}`,
      outro: "Якщо цікаво — напишіть, розповім деталі.",
    },
    {
      intro: (v) => `Хочу поділитися пропозицією: ${v.promoText?.trim() ?? ""}`,
      outro: "Питання — пишіть, усе підкажу.",
    },
    {
      intro: (v) => v.promoText?.trim() ?? "",
      outro: "Деталі — у мене, пишіть.",
    },
  ],
  DEBT: [
    {
      intro: (v) =>
        `Нагадую про оплату: за нашими даними, сума до сплати — ${formatUah(v.debtAmount ?? 0)}. Якщо платіж уже пройшов, дякую і вибачте за турботу.`,
      outro: "Якщо потрібна виписка по документах — надішлю.",
    },
    {
      intro: (v) =>
        `Підкажіть, будь ласка, коли плануєте оплату? За нашими даними, сума до сплати — ${formatUah(v.debtAmount ?? 0)}.`,
      outro: "Можу надіслати виписку по документах.",
    },
    {
      intro: (v) =>
        `Невелике нагадування щодо розрахунків: за нашими даними, заборгованість — ${formatUah(v.debtAmount ?? 0)}.`,
      outro: "Якщо оплата вже в дорозі — дякую, не зважайте на це повідомлення.",
    },
  ],
  CUSTOM: [{ intro: () => "", outro: null }],
};

/** Скільки варіантів тексту в цього виду. */
export function variantCount(kind: OutreachKind): number {
  return TEMPLATES[kind].length;
}

/** FNV-1a: стабільний і однаковий у Node та браузері, на відміну від crypto. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Варіант за замовчуванням: той самий для клієнта протягом київського дня.
 *
 * Не випадковий — інакше торговий, повернувшись на картку, бачив би інший
 * текст і не розумів, що з цього він уже відправив. Не завжди перший — інакше
 * сусідні магазини отримували б однакові повідомлення.
 */
export function defaultVariant(kind: OutreachKind, counterpartyId: string, kyivDay: string): number {
  return hash32(`${counterpartyId}:${kyivDay}`) % variantCount(kind);
}

/** Які види взагалі показують товари. Борг, акція й «своїми словами» — ні. */
export function kindShowsProducts(kind: OutreachKind): boolean {
  return kind === "WIN_BACK" || kind === "REPLENISH" || kind === "ARRIVALS" || kind === "DEVELOP";
}

/** Чи йде в текст посилання на каталог. Борг — не привід вести в магазин. */
export function kindHasLink(kind: OutreachKind): boolean {
  return kind !== "DEBT" && kind !== "CUSTOM";
}

/* ---------- Складання й уміщення ---------- */

export type OfferParts = {
  greeting: string;
  /** Коротке привітання — без імені. */
  shortGreeting: string;
  intro: string;
  products: OfferLineProduct[];
  productNameMax: number;
  outro: string | null;
  link: string | null;
  shortLink: string | null;
  signature: string;
};

export function assembleOffer(p: OfferParts): string {
  const lines = [p.greeting];
  if (p.intro) lines.push(p.intro);
  for (const prod of p.products) lines.push(productLine(prod, p.productNameMax));
  if (p.outro) lines.push(p.outro);
  // Посилання окремим рядком і без підпису на кшталт «Каталог:»: Telegram
  // однаково ставить його першим, і підпис лишився б висіти порожнім.
  if (p.link) lines.push(p.link);
  return `${lines.join("\n")}\n\n${p.signature}`;
}

export type ClampStep =
  | "drop-3rd-product"
  | "short-link"
  | "drop-2nd-product"
  | "short-greeting"
  | "short-names"
  | "drop-outro"
  | "cut-intro";

/**
 * Вмістити текст у MAX_OFFER_CHARS, нічого не поламавши.
 *
 * Порядок — від найменш цінного. Третій товар першим: два конкретні товари
 * вже дають привід для розмови. Далі посилання на товар стає посиланням на
 * каталог: другий товар у тексті корисніший за глибоке посилання, а токен
 * «клієнт відкрив» лишається тим самим. Потім другий товар, ім'я в
 * привітанні, довжина назв, завершальна фраза. Посилання не ріжемо ніколи:
 * обрізане, воно веде на 404 і втрачає токен.
 *
 * Вступ обрано до вміщення, і він лишається правдою: якщо «ви це брали»
 * правда для трьох товарів, то й для двох перших.
 */
export function clampOffer(parts: OfferParts, max = MAX_OFFER_CHARS): { parts: OfferParts; text: string; steps: ClampStep[] } {
  let p = { ...parts, products: [...parts.products] };
  const steps: ClampStep[] = [];
  const fits = () => assembleOffer(p).length <= max;

  const tryStep = (step: ClampStep, applies: () => boolean, apply: () => void) => {
    if (fits() || !applies()) return;
    apply();
    steps.push(step);
  };

  tryStep("drop-3rd-product", () => p.products.length >= 3, () => (p.products = p.products.slice(0, 2)));
  tryStep("short-link", () => !!p.shortLink && p.link !== p.shortLink, () => (p.link = p.shortLink));
  tryStep("drop-2nd-product", () => p.products.length >= 2, () => (p.products = p.products.slice(0, 1)));
  tryStep("short-greeting", () => p.greeting !== p.shortGreeting, () => (p.greeting = p.shortGreeting));
  tryStep("short-names", () => p.products.length > 0 && p.productNameMax > 36, () => (p.productNameMax = 36));
  tryStep("drop-outro", () => !!p.outro, () => (p.outro = null));
  tryStep(
    "cut-intro",
    () => p.intro.length > 0,
    () => {
      const over = assembleOffer(p).length - max;
      const keep = Math.max(0, p.intro.length - over - 1);
      p = { ...p, intro: keep > 0 ? `${p.intro.slice(0, keep).trimEnd()}…` : "" };
    }
  );

  return { parts: p, text: assembleOffer(p), steps };
}

export function signatureFor(repName: string | null): string {
  const name = (repName ?? "").replace(/\s+/g, " ").trim();
  return name ? `${name}, Budvik` : "Budvik";
}

export type RenderedOffer = {
  text: string;
  chars: number;
  variant: number;
  variants: number;
  /** Скільки товарів із переданих увійшло в текст — решту відкинуло вміщення. */
  productCount: number;
  /** Посилання, яке реально стоїть у тексті. */
  link: string | null;
  steps: ClampStep[];
};

export function renderOffer(kind: OutreachKind, variant: number, vars: OfferVars): RenderedOffer {
  const list = TEMPLATES[kind];
  const n = list.length;
  const v = ((Math.trunc(variant) % n) + n) % n;
  const tpl = list[v];

  const products = kindShowsProducts(kind) ? vars.products.slice(0, 3) : [];
  const link = kindHasLink(kind) ? (vars.link ?? vars.shortLink ?? null) : null;

  const parts: OfferParts = {
    greeting: greetingFor(vars.greetingName),
    shortGreeting: greetingFor(null),
    intro: tpl.intro(vars, { has: products.length > 0, own: ownershipOf(products) }),
    products,
    productNameMax: 56,
    outro: tpl.outro,
    link,
    shortLink: link ? (vars.shortLink ?? null) : null,
    signature: signatureFor(vars.repName),
  };

  const { parts: fitted, text, steps } = clampOffer(parts);
  return {
    text,
    chars: text.length,
    variant: v,
    variants: n,
    productCount: fitted.products.length,
    link: fitted.link,
    steps,
  };
}
