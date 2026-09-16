/**
 * Скласти пропозицію: вид, товари, посилання, текст і що торговому варто знати.
 *
 * Нічого не записує в ClientOutreach. Токен посилання народжується тут, але
 * стає справжнім лише тоді, коли торговий натиснув «Viber» чи «Скопіювати» і
 * POST зберіг рядок: відкрита й закрита картка не повинна лишати по собі
 * «надіслані» пропозиції. Єдиний можливий запис — ensureRefCode, який ліниво
 * видає торговому код для /r/ (так само, як /api/sales/ref-code).
 *
 * Посилання — лише на прохання (withLink). Текст називає оптову ціну, а будь-яка
 * сторінка вітрини, і картка товару, і корінь каталогу, показує роздрібну —
 * вищу на націнку. Клієнт 1С прочитав би це як подорожчання (правило цін:
 * роздріб завжди дорожчий за опт). Тому за замовчуванням без посилання й без
 * токена, а торговий ставить його свідомо, коли клієнту потрібні фото.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { ensureRefCode } from "@/lib/ref-code";
import { clientOutreachFacts, type ClientOutreachFacts } from "./client-facts";
import { buildOfferLink, newLinkToken, outreachBaseUrl } from "./links";
import { arrivalCandidates, pickOfferProducts, type OfferCandidate } from "./products";
import {
  assertNoInventedDiscount,
  defaultVariant,
  formatUah,
  kindHasLink,
  kindShowsProducts,
  renderOffer,
  variantCount,
} from "./templates";
import {
  MARKETING_CAP,
  OUTREACH_CHANNELS,
  OUTREACH_KINDS,
  PREFERRED_CHANNELS,
  isOutreachKind,
  labelOf,
  refusesMessages,
  type ComposedOffer,
  type OutreachKind,
} from "./types";

/** Умови акції вписує людина; довше — вже не повідомлення, а лист. */
export const PROMO_TEXT_MAX = 200;

export type KindOption = {
  key: OutreachKind;
  label: string;
  hint: string;
  available: boolean;
  reason?: string;
};

export type ComposeContext = {
  facts: ClientOutreachFacts;
  arrivals: OfferCandidate[];
};

/** Факти й прихід — те, від чого залежить, які види взагалі доступні. */
export async function prepareCompose(counterpartyId: string, now: Date = new Date()): Promise<ComposeContext | null> {
  const [facts, arrivals] = await Promise.all([
    clientOutreachFacts(counterpartyId, now),
    arrivalCandidates(counterpartyId, now),
  ]);
  return facts ? { facts, arrivals } : null;
}

export function normalizePromoText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, PROMO_TEXT_MAX) : null;
}

/**
 * Які види пропозиції має сенс складати цьому клієнту.
 *
 * Недоступний вид не ховаємо, а показуємо сірим із причиною: торговий, який
 * не бачить «Борг», інакше вирішить, що кнопку прибрали, а не що боргу немає.
 */
export function availableKinds(
  facts: Pick<ClientOutreachFacts, "state" | "receivable">,
  ctx: { hasArrivals: boolean; promoText?: string | null }
): KindOption[] {
  const noHistory = facts.state === null ? "клієнт ще нічого не купував" : undefined;
  const reasons: Record<OutreachKind, string | undefined> = {
    WIN_BACK: noHistory,
    REPLENISH: noHistory,
    ARRIVALS: ctx.hasArrivals ? undefined : "за тиждень не приїхало нічого з того, що він брав",
    DEVELOP: undefined,
    PROMO: ctx.promoText ? undefined : "потрібні умови акції, які офіс проставив у 1С",
    DEBT: facts.receivable > 0 ? undefined : "боргу немає",
    CUSTOM: undefined,
  };
  return OUTREACH_KINDS.map((k) => ({
    key: k.key,
    label: k.label,
    hint: k.hint,
    available: !reasons[k.key],
    ...(reasons[k.key] ? { reason: reasons[k.key] } : {}),
  }));
}

/**
 * Вид за замовчуванням — з того, що про клієнта відомо.
 *
 * Той, хто мовчить довше за свій ритм, отримує «Повернути»; активний, у якого
 * щось приїхало, — «Приїхало ваше»; без історії — «Розширити асортимент».
 * Борг за замовчуванням не пропонуємо: картку відкривають, щоб продати, а
 * про борг попередження й так стоїть над текстом.
 */
export function defaultKind(facts: Pick<ClientOutreachFacts, "state">, kinds: KindOption[]): OutreachKind {
  const ok = (k: OutreachKind) => kinds.find((x) => x.key === k)?.available;
  if ((facts.state === "SLIPPING" || facts.state === "DORMANT" || facts.state === "LOST") && ok("WIN_BACK")) {
    return "WIN_BACK";
  }
  if (ok("ARRIVALS")) return "ARRIVALS";
  if ((facts.state === "ACTIVE" || facts.state === "NEW") && ok("REPLENISH")) return "REPLENISH";
  return "DEVELOP";
}

/** Запитаний вид, якщо він доступний, інакше — за замовчуванням. */
export function resolveKind(requested: unknown, facts: Pick<ClientOutreachFacts, "state">, kinds: KindOption[]): OutreachKind {
  if (isOutreachKind(requested) && kinds.find((k) => k.key === requested)?.available) return requested;
  return defaultKind(facts, kinds);
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m100 = n % 100;
  const m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
};
const daysWord = (n: number) => `${n} ${plural(n, "день", "дні", "днів")}`;

function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit" });
}

/**
 * Що торговому варто знати перед відправкою.
 *
 * Попередження, а не заборони: повідомлення від торгового — особисте, згоди на
 * розсилку воно не потребує, і вирішує людина, яка клієнта знає. Але вирішувати
 * вона має, бачачи, що клієнт просив не писати чи що йому вже двічі писали.
 */
export function offerWarnings(facts: ClientOutreachFacts, kind: OutreachKind): string[] {
  const out: string[] = [];
  const marketing = kind !== "DEBT";

  if (facts.isInternal) out.push("Це внутрішній контрагент (склад, співробітник), а не клієнт.");
  if (!facts.phone.e164) {
    out.push(
      facts.phone.raw
        ? "Мобільного номера не знайдено — Viber і SMS можуть не дійти; текст можна скопіювати."
        : "Телефону немає — лишається скопіювати текст або передати особисто."
    );
  }
  // Те саме правило, за яким воркер не ставить клієнта в тижневий список:
  // «не турбувати» як канал — теж відмова, а не просто вподобання.
  if (marketing && refusesMessages(facts)) {
    out.push(
      `Клієнт просив не писати${facts.marketingOptOutAt ? ` (з ${dayMonth(facts.marketingOptOutAt)})` : ""} — рекламне повідомлення краще не надсилати.`
    );
  }
  if (facts.preferredChannel && facts.preferredChannel !== "NONE") {
    out.push(`Клієнт просить писати: ${labelOf(PREFERRED_CHANNELS, facts.preferredChannel)}.`);
  }
  if (marketing && facts.capReached) {
    out.push(
      `За ${MARKETING_CAP.days} днів клієнту вже писали ${facts.marketingRecent} ${plural(facts.marketingRecent, "раз", "рази", "разів")} — ще одне рекламне повідомлення читатиметься як спам.`
    );
  }
  const last = facts.lastOutreach;
  if (last && last.daysAgo < 30) {
    const when = last.daysAgo === 0 ? "сьогодні" : `${daysWord(last.daysAgo)} тому`;
    out.push(
      `Уже писали ${when}: ${labelOf(OUTREACH_CHANNELS, last.channel)}${last.repName ? `, ${last.repName}` : ""}.`
    );
  }
  if (kind !== "DEBT" && facts.overdue > 0) {
    out.push(`Прострочено ${formatUah(facts.overdue)} — можливо, спершу про борг.`);
  }
  return out;
}

/** Причина одним рядком — торговому, не клієнту. */
function reasonFor(kind: OutreachKind, facts: ClientOutreachFacts, productCount: number, arrivals: number): string {
  switch (kind) {
    case "WIN_BACK":
      return facts.daysSinceLast != null
        ? facts.avgIntervalDays >= 1
          ? `Не брав ${daysWord(facts.daysSinceLast)} при звичному ритмі раз на ${daysWord(facts.avgIntervalDays)}`
          : `Не брав ${daysWord(facts.daysSinceLast)}`
        : "Нагадати про себе";
    case "REPLENISH":
      return productCount > 0 ? "Товари, які бере регулярно й мав би вже поповнити" : "Нагадати про поповнення";
    case "ARRIVALS":
      return `Приїхало ${arrivals} ${plural(arrivals, "позиція", "позиції", "позицій")} з того, що він брав за пів року`;
    case "DEVELOP":
      return productCount > 0 ? "Те, що беруть схожі клієнти, а цей — ще ні" : "Розширити асортимент";
    case "PROMO":
      return "Умови акції від офісу";
    case "DEBT":
      return facts.overdue > 0
        ? `Борг ${formatUah(facts.receivable)}, прострочено ${formatUah(facts.overdue)}`
        : `Борг ${formatUah(facts.receivable)}, у межах відстрочки`;
    case "CUSTOM":
      return "Текст пишете самі";
  }
}

export type ComposeOptions = {
  variant?: number;
  now?: Date;
  promoText?: string | null;
  /** Уже пораховані факти й прихід — щоб роут не тягнув їх двічі. */
  context?: ComposeContext;
  /**
   * Код торгового для /r/. undefined — видати через ensureRefCode (може
   * записати User.refCode); рядок чи null — узяти як є, без запису. Скрипт
   * сухого прогону по бойовій базі передає його сам.
   */
  refCode?: string | null;
  /** Ім'я в підписі; undefined — прочитати з User. */
  repName?: string | null;
  /**
   * Додати посилання на каталог (і токен «клієнт відкрив»). За замовчуванням
   * ні: на вітрині роздрібні ціни, вищі за опт із тексту.
   */
  withLink?: boolean;
};

export async function composeOffer(
  counterpartyId: string,
  repId: string,
  kind: OutreachKind,
  opts: ComposeOptions = {}
): Promise<ComposedOffer | null> {
  const now = opts.now ?? new Date();
  const ctx = opts.context ?? (await prepareCompose(counterpartyId, now));
  if (!ctx) return null;
  const { facts } = ctx;
  const promoText = normalizePromoText(opts.promoText);
  const wantsLink = opts.withLink === true && kindHasLink(kind);

  const [products, repName, refCode] = await Promise.all([
    kindShowsProducts(kind)
      ? pickOfferProducts(counterpartyId, repId, kind, now, { arrivals: ctx.arrivals })
      : Promise.resolve([]),
    opts.repName !== undefined
      ? Promise.resolve(opts.repName)
      : prisma.user.findUnique({ where: { id: repId }, select: { name: true } }).then((u) => u?.name ?? null),
    // Без посилання код торгового не потрібен — і ensureRefCode нічого не пише.
    !wantsLink
      ? Promise.resolve(null)
      : opts.refCode !== undefined
        ? Promise.resolve(opts.refCode)
        : ensureRefCode(repId),
  ]);

  const base = outreachBaseUrl();
  const token = wantsLink && refCode && base ? newLinkToken() : null;
  const link = token ? buildOfferLink({ base, refCode: refCode!, slug: products[0]?.slug, token }) : null;
  const shortLink = token ? buildOfferLink({ base, refCode: refCode!, token }) : null;

  const variants = variantCount(kind);
  const variant =
    opts.variant != null && Number.isFinite(opts.variant)
      ? ((Math.trunc(opts.variant) % variants) + variants) % variants
      : defaultVariant(kind, counterpartyId, kyivDate(now));

  const rendered = renderOffer(kind, variant, {
    counterpartyId,
    greetingName: facts.greetingName,
    repName,
    products,
    link,
    shortLink,
    debtAmount: facts.receivable,
    promoText,
  });

  // Запобіжник для самих шаблонів: якщо хтось допише «вигідну ціну» в
  // текст, пропозиція впаде тут, а не піде клієнту.
  assertNoInventedDiscount(rendered.text, kind, promoText);

  const included = products.slice(0, rendered.productCount);
  const warnings = offerWarnings(facts, kind);
  if (kindShowsProducts(kind) && included.length === 0) {
    warnings.push("Товарів у вільному залишку під цю пропозицію не знайшлося — текст без списку.");
  }

  return {
    counterpartyId,
    kind,
    variant: rendered.variant,
    variants: rendered.variants,
    text: rendered.text,
    chars: rendered.chars,
    products: included,
    link: rendered.link,
    linkToken: rendered.link ? token : null,
    reason: reasonFor(kind, facts, included.length, ctx.arrivals.length),
    state: facts.state,
    daysSinceLast: facts.daysSinceLast,
    phone: facts.phone,
    warnings,
  };
}
