/**
 * Перевірка пропозицій клієнту без бази: тексти, вміщення, посилання, ввід.
 *
 *   npx tsx scripts/check-outreach.mts
 *
 * Падає (код 1), якщо хоч один рядок ✗. Живий прогін по клієнту —
 * scripts/outreach-dry.mts.
 *
 * Головне, що тут стережеться: жоден шаблон не обіцяє знижок (сайт не може
 * змінити ціну 1С), жоден не вилазить за 400 знаків і жодне вміщення не ріже
 * посилання — обрізане, воно веде на 404 і втрачає токен «клієнт відкрив».
 */
import {
  assembleOffer,
  assertNoInventedDiscount,
  clampOffer,
  defaultVariant,
  displayClientName,
  findInventedDiscount,
  formatUah,
  greetingName,
  kindHasLink,
  ownershipOf,
  renderOffer,
  shortProductName,
  variantCount,
  type OfferParts,
  type OfferVars,
} from "../src/lib/outreach/templates";
import { MAX_OFFER_CHARS, OUTREACH_KINDS, outreachPhone, refusesMessages, type OutreachKind } from "../src/lib/outreach/types";
import {
  buildOfferLink,
  isLinkToken,
  isPreviewAgent,
  newLinkToken,
  safeCatalogTarget,
} from "../src/lib/outreach/links";
import { OutreachError, validateOutreachInput } from "../src/lib/outreach/index";
import { availableKinds, defaultKind, offerWarnings, resolveKind } from "../src/lib/outreach/compose";
import type { ClientOutreachFacts } from "../src/lib/outreach/client-facts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

const KINDS = OUTREACH_KINDS.map((k) => k.key) as OutreachKind[];
const token = newLinkToken();
const base = "https://www.budvik27.com";
const longSlug = "shlifmashyna-kutova-akumuliatorna-dnipro-m-cg-201sab-bez-akb-ta-zariadnoho-prystroiu";
const link = buildOfferLink({ base, refCode: "ABCDEFGH", slug: longSlug, token });
const shortLink = buildOfferLink({ base, refCode: "ABCDEFGH", token });

const LONG = [
  "Шліфмашина кутова акумуляторна DNIPRO-M CG-201SAB (без АКБ та ЗП) 125 мм, 20 В, безщіткова, з регулюванням обертів [4]",
  "Піна монтажна професійна SOMA FIX MEGA 70 зимова 870 мл, вихід до 70 літрів, для роботи до -10 °C, під пістолет [12]",
  "Круг відрізний по металу Grösser 125 x 1,0 x 22,2 мм, серія PRO, для нержавіючої сталі та кольорових металів [50]",
];

const vars = (over: Partial<OfferVars> = {}): OfferVars => ({
  counterpartyId: "cp_test_1",
  greetingName: "Олександра",
  repName: "Калашник-Передрій Дарья Олександрівна",
  products: LONG.map((name, i) => ({ name, wholesalePrice: [12345.67, 185, 12.5][i], boughtBefore: true })),
  link,
  shortLink,
  debtAmount: 123456.78,
  promoText:
    "до 30.09 при замовленні від 5 ящиків піни SOMA FIX — знижка 5% і доставка за наш рахунок по всій Львівській області, умови вже в 1С у типі цін акції",
  ...over,
});

/* ---------- Кожен вид × варіант ---------- */

for (const kind of KINDS) {
  const n = variantCount(kind);
  check(`${kind}: є варіанти (${n})`, n >= (kind === "CUSTOM" ? 1 : 3));
  for (let v = 0; v < n; v++) {
    for (const withProducts of [true, false]) {
      // За замовчуванням посилання немає (на вітрині роздріб, у тексті опт);
      // галочкою торговий його додає — обидва шляхи мусять уміщатися.
      for (const withLink of [false, true]) {
        const r = renderOffer(
          kind,
          v,
          vars({ ...(withProducts ? {} : { products: [] }), ...(withLink ? {} : { link: null, shortLink: null }) })
        );
        const tag = `${kind}#${v}${withProducts ? "" : " без товарів"}${withLink ? " з посиланням" : ""}`;
        check(`${tag}: ≤ ${MAX_OFFER_CHARS} знаків (${r.chars})`, r.chars <= MAX_OFFER_CHARS, r.text);
        check(`${tag}: chars = довжина тексту`, r.chars === r.text.length);
        if (kind !== "PROMO") {
          check(`${tag}: без знижок і відсотків`, findInventedDiscount(r.text, kind) === null, findInventedDiscount(r.text, kind));
        }
        if (withLink && kindHasLink(kind)) {
          const lines = r.text.split("\n");
          check(`${tag}: посилання цілим рядком`, !!r.link && lines.includes(r.link), r.text);
          check(`${tag}: посилання — одне з двох справжніх`, r.link === link || r.link === shortLink, r.link);
        } else {
          check(`${tag}: без посилання`, r.link === null && !r.text.includes("http"), r.text);
        }
        check(`${tag}: підпис торгового в кінці`, r.text.endsWith("Калашник-Передрій Дарья Олександрівна, Budvik"));
        check(`${tag}: без «хотів/радий/вдячний»`, !/(хотів|хотіла|радий|рада |вдячний|вдячна)/i.test(r.text), r.text);
        check(`${tag}: не більше 3 товарів`, r.productCount <= 3);
      }
      if (withProducts && kindHasLink(kind)) {
        const plain = renderOffer(kind, v, vars({ link: null, shortLink: null }));
        const linked = renderOffer(kind, v, vars());
        check(`${kind}#${v}: без посилання товарів не менше`, plain.productCount >= linked.productCount, [plain.productCount, linked.productCount]);
      }
    }
  }
}

/* ---------- Окремі види ---------- */

const debt = renderOffer("DEBT", 0, vars());
check("DEBT: сума з копійками", debt.text.includes("123\u00A0456,78\u00A0₴"), debt.text);
check("DEBT: без товарів", debt.productCount === 0 && !debt.text.includes("•"));

const custom = renderOffer("CUSTOM", 0, vars());
check("CUSTOM: лише привітання й підпис", custom.text === "Добрий день, Олександра!\n\nКалашник-Передрій Дарья Олександрівна, Budvik", custom.text);

const promo = renderOffer("PROMO", 1, vars());
check("PROMO: умови з тексту людини дозволені", findInventedDiscount(promo.text, "PROMO", vars().promoText) === null, promo.text);
let threw = false;
try {
  assertNoInventedDiscount(promo.text, "PROMO", null);
} catch {
  threw = true;
}
check("PROMO без умов — помилка", threw);
threw = false;
try {
  assertNoInventedDiscount("Добрий день! У нас знижка 10% на все", "WIN_BACK");
} catch {
  threw = true;
}
check("WIN_BACK зі «знижкою» — помилка", threw);
check("«спеціальна ціна» ловиться (кирилиця, не \\w)", findInventedDiscount("для вас спеціальна ціна", "DEVELOP") !== null);
check("посилання зі slug «akcia» не ловиться", findInventedDiscount(`див. ${base}/r/X?to=/catalog/akciya-sale`, "DEVELOP") === null);

const winBack = renderOffer("WIN_BACK", 0, vars());
check("опт лише з ціною: є «(опт)»", winBack.text.includes("(опт)"), winBack.text);
const noPrice = renderOffer("WIN_BACK", 0, vars({ products: [{ name: "Кельма", wholesalePrice: null }] }));
check("без опту — ні ціни, ні «опт»", !noPrice.text.includes("опт") && noPrice.text.includes("• Кельма\n"), noPrice.text);
/* ---------- Правда про товари: «ви брали» лише про те, що брав ---------- */

const strangers = vars().products.map((p) => ({ ...p, boughtBefore: false }));
const mixed = vars().products.map((p, i) => ({ ...p, boughtBefore: i === 0 }));
check("ownershipOf: усі / жодного / частина", ownershipOf(vars().products) === "ALL" && ownershipOf(strangers) === "NONE" && ownershipOf(mixed) === "MIXED");
check("ownershipOf: порожній список — NONE", ownershipOf([]) === "NONE");
const OWN_CLAIM = /(ви у нас брали|ви брали|ви берете|ваші позиції|ви замовляли|звичним графіком)/i;
const NEW_CLAIM = /(у вас ще немає|схожі на ваш|беруть інші наші клієнти)/i;
for (const kind of ["WIN_BACK", "REPLENISH", "ARRIVALS", "DEVELOP"] as OutreachKind[]) {
  for (let v = 0; v < variantCount(kind); v++) {
    for (const [label, list] of [["не брав", strangers], ["частково", mixed]] as const) {
      const t = renderOffer(kind, v, vars({ products: list })).text;
      check(`${kind}#${v} ${label}: не каже «ви брали»`, !OWN_CLAIM.test(t), t);
    }
    for (const [label, list] of [["брав усе", vars().products], ["частково", mixed]] as const) {
      const t = renderOffer(kind, v, vars({ products: list })).text;
      check(`${kind}#${v} ${label}: не каже «у вас ще немає»`, !NEW_CLAIM.test(t), t);
    }
  }
}

const noName = renderOffer("REPLENISH", 0, vars({ greetingName: null, repName: null }));
check("без імені — «Вітаю!», підпис «Budvik»", noName.text.startsWith("Вітаю!\n") && noName.text.endsWith("\n\nBudvik"), noName.text);

/* ---------- Вміщення ---------- */

const parts = (over: Partial<OfferParts> = {}): OfferParts => ({
  greeting: "Добрий день, Олександра!",
  shortGreeting: "Вітаю!",
  intro: "Давно не чулися, тож нагадаю про себе. Зараз на складі є те, що ви у нас брали:",
  products: LONG.map((name) => ({ name, wholesalePrice: 1234 })),
  productNameMax: 56,
  outro: "Якщо актуально — напишіть, підготую замовлення.",
  link,
  shortLink,
  signature: "Калашник-Передрій Дарья Олександрівна, Budvik",
  ...over,
});

const full = clampOffer(parts(), 10_000);
check("вміщення: влазить — нічого не міняє", full.steps.length === 0 && full.text === assembleOffer(parts()));

const order = clampOffer(parts(), 60).steps;
check(
  "вміщення: порядок кроків",
  JSON.stringify(order) ===
    JSON.stringify(["drop-3rd-product", "short-link", "drop-2nd-product", "short-greeting", "short-names", "drop-outro", "cut-intro"]),
  order
);
const tiny = clampOffer(parts(), 60);
check("вміщення: навіть у крайньому разі посилання ціле", tiny.text.split("\n").includes(shortLink), tiny.text);

const midLen = assembleOffer(parts({ products: parts().products.slice(0, 2), link: shortLink })).length;
const mid = clampOffer(parts(), midLen);
check("вміщення: третій товар і довге посилання — першими", JSON.stringify(mid.steps) === JSON.stringify(["drop-3rd-product", "short-link"]) && mid.parts.products.length === 2, mid.steps);

/* ---------- Назви, звертання, гроші ---------- */

const names: Array<[string, string]> = [
  ["Будмаркет (Жовква, вул. Львівська)", "Будмаркет"],
  ["ФОП Петренко Іван Іванович (Броди) (борг)", "ФОП Петренко Іван Іванович"],
  ["ТОВ \"Будцентр\"", "ТОВ \"Будцентр\""],
  ["  Майстер   [опт] ", "Майстер"],
  ["(Склад)", "(Склад)"],
  ["ТОВ (Будцентр) Захід", "ТОВ (Будцентр) Захід"],
];
for (const [input, want] of names) check(`displayClientName «${input}» → «${want}»`, displayClientName(input) === want, displayClientName(input));

const greet: Array<[string | null, string | null, string | null]> = [
  ["Іван", null, "Іван"],
  ["Петренко Іван Іванович", null, "Іван"],
  ["Олена Петрівна", null, "Олена"],
  ["Петренко Іван", null, null],
  ["директор Олег", null, null],
  ["Олег 067 123 45 67", null, "Олег"],
  [null, "ФОП Коваль Марія Степанівна", "Марія"],
  [null, "ФОП Коваль М.С.", null],
  [null, "Будмаркет", null],
];
for (const [person, client, want] of greet) {
  check(`greetingName(${person}, ${client}) → ${want}`, greetingName(person, client) === want, greetingName(person, client));
}

check("formatUah 1234 → «1 234 ₴» (нерозривні пробіли)", formatUah(1234) === "1\u00A0234\u00A0₴", formatUah(1234));
check("formatUah 12.5 → «12,50 ₴»", formatUah(12.5) === "12,50\u00A0₴", formatUah(12.5));
check("shortProductName знімає [N] і ріже по слову", shortProductName(LONG[0], 40).endsWith("…") && !shortProductName(LONG[0]).includes("[4]"));

const phones: Array<[{ primaryPhoneE164?: string | null; phone?: string | null }, string | null]> = [
  [{ primaryPhoneE164: "+380671112233", phone: "050 000 00 00" }, "+380671112233"],
  [{ phone: "(032) 245-12-34, 067-123-45-67" }, "+380671234567"],
  [{ phone: "(032) 245-12-34" }, null],
  [{ phone: null }, null],
];
for (const [input, want] of phones) check(`outreachPhone ${JSON.stringify(input)} → ${want}`, outreachPhone(input) === want);

/* ---------- Посилання й редірект ---------- */

check("посилання: формат з товаром", link === `${base}/r/ABCDEFGH?to=/catalog/${longSlug}&o=${token}`, link);
check("посилання: без товару", shortLink === `${base}/r/ABCDEFGH?o=${token}`, shortLink);
check("токен: 16 знаків base64url", isLinkToken(token) && token.length === 16, token);
const targets: Array<[string | null, string]> = [
  [null, "/catalog"],
  ["/catalog", "/catalog"],
  ["/catalog/pina-soma-fix-750", "/catalog/pina-soma-fix-750"],
  ["//evil.example", "/catalog"],
  ["https://evil.example", "/catalog"],
  ["/catalog/../admin", "/catalog"],
  ["/catalog/a/b", "/catalog"],
  ["/admin", "/catalog"],
];
for (const [to, want] of targets) check(`to=${to} → ${want}`, safeCatalogTarget(to) === want);
check("прев'ю Telegram — бот", isPreviewAgent("TelegramBot (like TwitterBot)"));
check("порожній агент — бот", isPreviewAgent(null));
check("Chrome на Android — людина", !isPreviewAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36"));

/* ---------- Варіант за замовчуванням ---------- */

const d1 = defaultVariant("WIN_BACK", "cp_1", "2026-09-14");
check("варіант стабільний у межах дня", d1 === defaultVariant("WIN_BACK", "cp_1", "2026-09-14"));
check("варіант у межах", d1 >= 0 && d1 < variantCount("WIN_BACK"));
const spread = new Set(Array.from({ length: 40 }, (_, i) => defaultVariant("WIN_BACK", `cp_${i}`, "2026-09-14")));
check("сусідні клієнти отримують різні варіанти", spread.size > 1);

/* ---------- Ввід відправки ---------- */

const ok = validateOutreachInput({
  counterpartyId: "cp_1",
  kind: "WIN_BACK",
  channel: "VIBER",
  text: `Вітаю!\n${link}`,
  productIds: ["p1", "p1", "p2", 5],
  linkToken: token,
});
check("ввід: токен лишається, коли він у тексті", ok.linkToken === token);
check("ввід: товари без дублів і сміття", JSON.stringify(ok.productIds) === '["p1","p2"]', ok.productIds);
const stripped = validateOutreachInput({ counterpartyId: "cp_1", kind: "WIN_BACK", channel: "VIBER", text: "Вітаю, без посилання", linkToken: token });
check("ввід: посилання стерли — токена немає", stripped.linkToken === null);
const call = validateOutreachInput({ counterpartyId: "cp_1", kind: "DEBT", channel: "CALL", text: "", linkToken: token });
check("ввід: дзвінок без тексту й без токена", call.text === "" && call.linkToken === null);
const bad = (input: unknown) => {
  try {
    validateOutreachInput(input);
    return false;
  } catch (e) {
    return e instanceof OutreachError;
  }
};
check("ввід: невідомий вид — помилка", bad({ counterpartyId: "cp_1", kind: "SPAM", channel: "VIBER", text: "текст" }));
check("ввід: порожній текст у Viber — помилка", bad({ counterpartyId: "cp_1", kind: "WIN_BACK", channel: "VIBER", text: " " }));
check("ввід: без клієнта — помилка", bad({ kind: "WIN_BACK", channel: "VIBER", text: "текст" }));

/* ---------- Доступні види й попередження ---------- */

const facts = (over: Partial<ClientOutreachFacts> = {}): ClientOutreachFacts => ({
  id: "cp_1",
  name: "Будмаркет (Жовква)",
  displayName: "Будмаркет",
  code: null,
  contactPerson: null,
  address: null,
  greetingName: null,
  greeting: "Вітаю!",
  phone: { raw: "067 123 45 67", e164: "+380671234567" },
  state: "DORMANT",
  daysSinceLast: 75,
  avgIntervalDays: 14,
  lastDocAt: null,
  receivable: 0,
  overdue: 0,
  marketingConsent: "UNKNOWN",
  marketingConsentAt: null,
  marketingOptOutAt: null,
  preferredChannel: null,
  isInternal: false,
  lastOutreach: null,
  marketingRecent: 0,
  capReached: false,
  ...over,
});

const k1 = availableKinds(facts(), { hasArrivals: false });
const avail = (list: typeof k1, key: string) => list.find((k) => k.key === key)?.available;
check("види: борг недоступний без боргу", avail(k1, "DEBT") === false);
check("види: акція недоступна без умов", avail(k1, "PROMO") === false);
check("види: «Приїхало» недоступне без приходу", avail(k1, "ARRIVALS") === false);
check("види: сплячому за замовчуванням — «Повернути»", defaultKind(facts(), k1) === "WIN_BACK");
const k2 = availableKinds(facts({ state: null, receivable: 500 }), { hasArrivals: true, promoText: "умови" });
check("види: без історії «Повернути» недоступне", avail(k2, "WIN_BACK") === false && avail(k2, "DEBT") === true && avail(k2, "PROMO") === true);
check("види: недоступний запит → за замовчуванням", resolveKind("WIN_BACK", facts({ state: null }), k2) === "ARRIVALS");

const w = offerWarnings(
  facts({
    phone: { raw: "(032) 245-12-34", e164: null },
    marketingOptOutAt: "2026-09-01T10:00:00.000Z",
    marketingConsent: "REFUSED",
    capReached: true,
    marketingRecent: 2,
    overdue: 5000,
    isInternal: true,
    lastOutreach: { at: "2026-09-10T10:00:00.000Z", daysAgo: 4, kind: "WIN_BACK", channel: "VIBER", outcome: "PENDING", repId: null, repName: "Кулик Дмитро" },
  }),
  "WIN_BACK"
);
check("попередження: немає мобільного", w.some((x) => x.includes("Мобільного номера не знайдено")), w);
check("попередження: просив не писати", w.some((x) => x.includes("просив не писати")), w);
check("попередження: стеля", w.some((x) => x.includes("вже писали 2 рази")), w);
check("попередження: писали 4 дні тому", w.some((x) => x.includes("4 дні тому")), w);
check("попередження: прострочка", w.some((x) => x.includes("Прострочено")), w);
check("попередження: внутрішній", w.some((x) => x.includes("внутрішній")), w);
const wDebt = offerWarnings(facts({ marketingConsent: "REFUSED", capReached: true, marketingRecent: 3, overdue: 5000 }), "DEBT");
check("борг: відписка й стеля його не стосуються", !wDebt.some((x) => x.includes("не писати") || x.includes("спам") || x.includes("Прострочено")), wDebt);

const wNone = offerWarnings(facts({ preferredChannel: "NONE" }), "WIN_BACK");
check("попередження: «не турбувати» як канал = просив не писати", wNone.some((x) => x.includes("просив не писати")), wNone);
check(
  "refusesMessages: дата, відмова або «не турбувати»",
  refusesMessages({ marketingOptOutAt: new Date() }) &&
    refusesMessages({ marketingOptOutAt: "2026-09-01T00:00:00.000Z" }) &&
    refusesMessages({ marketingConsent: "REFUSED" }) &&
    refusesMessages({ preferredChannel: "NONE" }) &&
    !refusesMessages({ marketingConsent: "GRANTED", preferredChannel: "VIBER", marketingOptOutAt: null }) &&
    !refusesMessages({})
);

console.log(failed ? `\n✗ Провалено: ${failed}` : "\n✓ Усе гаразд");
process.exit(failed ? 1 : 0);
