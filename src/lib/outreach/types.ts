/**
 * Пропозиції клієнтам — спільні константи й типи.
 *
 * Чистий модуль: без Prisma і без next/*. Його імпортують воркер, роути й
 * екрани кабінету, тож нічого серверного сюди класти не можна (type-імпорти
 * стираються при збірці і не тягнуть за собою базу).
 *
 * Навіщо все це. Торгові працюють із вузьким колом клієнтів, а 152 клієнти,
 * які не купували понад 90 днів, дали 5,4 млн обороту 2026 року. Сайт не має
 * жодного каналу до клієнта, зате в торгового є телефон, Viber і знайомство.
 * Пропозиція — підготовлений текст, який торговий відправляє зі свого
 * планшета, а ClientOutreach фіксує, що і кому пішло, і чим закінчилось.
 */

import type { ClientState } from "@/lib/analytics/clients";
import type { ActionKind } from "@/lib/analytics/company/rep-actions";
import { primaryMobileE164 } from "@/lib/phone";

export const OUTREACH_KINDS = [
  { key: "WIN_BACK", label: "Повернути", hint: "давно не брав — нагадати про себе й дати привід" },
  { key: "REPLENISH", label: "Пора поповнити", hint: "товари, які клієнт бере регулярно і яким вийшов строк" },
  { key: "ARRIVALS", label: "Приїхало ваше", hint: "прихід товару, який клієнт брав" },
  { key: "DEVELOP", label: "Розширити асортимент", hint: "бренди, які беруть схожі клієнти" },
  { key: "PROMO", label: "Акція", hint: "лише умови, які офіс уже проставив у 1С" },
  { key: "DEBT", label: "Борг", hint: "нагадати про оплату" },
  { key: "CUSTOM", label: "Своїми словами", hint: "текст пише торговий" },
] as const;

export type OutreachKind = (typeof OUTREACH_KINDS)[number]["key"];

export const OUTREACH_CHANNELS = [
  { key: "VIBER", label: "Viber" },
  { key: "TELEGRAM", label: "Telegram" },
  { key: "SMS", label: "SMS" },
  { key: "CALL", label: "Дзвінок" },
  { key: "IN_PERSON", label: "Особисто" },
  { key: "COPY", label: "Скопійовано" },
] as const;

export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number]["key"];

export const OUTREACH_OUTCOMES = [
  { key: "PENDING", label: "Чекаємо" },
  { key: "ORDERED", label: "Замовив" },
  { key: "REPLIED", label: "Відповів" },
  { key: "REFUSED", label: "Відмовився" },
  { key: "NO_ANSWER", label: "Без відповіді" },
  { key: "OPT_OUT", label: "Просить не писати" },
] as const;

export type OutreachOutcome = (typeof OUTREACH_OUTCOMES)[number]["key"];

export const OUTREACH_SOURCES = ["REP", "CAMPAIGN", "SYSTEM"] as const;
export type OutreachSource = (typeof OUTREACH_SOURCES)[number];

export const OUTREACH_PURPOSES = ["MARKETING", "SERVICE"] as const;
export type OutreachPurpose = (typeof OUTREACH_PURPOSES)[number];

export const MARKETING_CONSENTS = [
  { key: "UNKNOWN", label: "Не питали" },
  { key: "GRANTED", label: "Згоден на повідомлення" },
  { key: "REFUSED", label: "Не писати" },
] as const;
export type MarketingConsent = (typeof MARKETING_CONSENTS)[number]["key"];

/**
 * Хто зафіксував згоду. OFFICE — внесли в адмінці без названого каналу:
 * жодне інше значення цього не описує чесно (REP приписав би згоду
 * торговому, SITE/BOT — самому клієнтові, IMPORT — масовому завантаженню).
 */
export const CONSENT_SOURCES = ["REP", "OFFICE", "BOT", "SITE", "IMPORT"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const PREFERRED_CHANNELS = [
  { key: "VIBER", label: "Viber" },
  { key: "TELEGRAM", label: "Telegram" },
  { key: "SMS", label: "SMS" },
  { key: "EMAIL", label: "Пошта" },
  { key: "PHONE_CALL", label: "Дзвінок" },
  { key: "NONE", label: "Не турбувати" },
] as const;
export type PreferredChannel = (typeof PREFERRED_CHANNELS)[number]["key"];

/** Viber показує довгий текст згорнутим; 400 знаків — два екрани телефона. */
export const MAX_OFFER_CHARS = 400;

/** Реалізація протягом стількох днів після пропозиції — «замовив». */
export const ORDERED_WINDOW_DAYS = 14;

/** Без реалізації стільки днів — «без відповіді». */
export const NO_ANSWER_AFTER_DAYS = 21;

/** «Без пропозиції N днів» — фільтр списку і тижневий пуш. */
export const QUIET_AFTER_OUTREACH_DAYS = 30;

/**
 * Частотна стеля маркетингу на клієнта, незалежно від того, хто пише:
 * торговий чи майбутня кампанія. Третє рекламне повідомлення за місяць
 * клієнт читає як спам і просить не писати взагалі.
 */
export const MARKETING_CAP = { max: 2, days: 30 } as const;

/** Дія зі списку дзвінків → вид пропозиції. */
export const ACTION_TO_OUTREACH: Record<ActionKind, OutreachKind> = {
  COLLECT_DEBT: "DEBT",
  CHURN_RISK: "WIN_BACK",
  REACTIVATE: "WIN_BACK",
  DEVELOP: "DEVELOP",
  OFFER_BONUS: "DEVELOP",
};

export type OfferProduct = {
  id: string;
  name: string;
  sku: string | null;
  slug: string | null;
  /**
   * Оптова ціна 1С («4.ОПТ»). Клієнт 1С платить саме її; ціна вітрини
   * (Product.price) вища на націнку, і в повідомленні читалася б як
   * подорожчання. Немає опту — ціну не називаємо.
   */
  wholesalePrice: number | null;
  freeStock: number;
  /** Чому саме цей товар — для торгового, у текст клієнту не йде. */
  why: string;
};

export type ComposedOffer = {
  counterpartyId: string;
  kind: OutreachKind;
  variant: number;
  variants: number;
  text: string;
  chars: number;
  products: OfferProduct[];
  /** Посилання в тексті; null — без посилання. */
  link: string | null;
  /** Токен у посиланні — його треба передати при збереженні пропозиції. */
  linkToken: string | null;
  /** Причина одним рядком — для торгового. */
  reason: string;
  state: ClientState | null;
  daysSinceLast: number | null;
  phone: { raw: string | null; e164: string | null };
  /** Що торговому варто знати перед відправкою («немає мобільного», «борг»). */
  warnings: string[];
};

export type OutreachRow = {
  id: string;
  counterpartyId: string;
  counterpartyName: string | null;
  repId: string | null;
  repName: string | null;
  kind: string;
  channel: string;
  purpose: string;
  source: string;
  text: string;
  productIds: string[];
  stateAtSend: string | null;
  sentAt: string;
  clickedAt: string | null;
  outcome: string;
  outcomeAt: string | null;
  outcomeBy: string | null;
  outcomeDocId: string | null;
  outcomeAmount: number | null;
};

function keysOf<T extends readonly { key: string }[]>(list: T): Set<string> {
  return new Set(list.map((x) => x.key));
}

const KIND_KEYS = keysOf(OUTREACH_KINDS);
const CHANNEL_KEYS = keysOf(OUTREACH_CHANNELS);
const OUTCOME_KEYS = keysOf(OUTREACH_OUTCOMES);
const CONSENT_KEYS = keysOf(MARKETING_CONSENTS);
const PREFERRED_KEYS = keysOf(PREFERRED_CHANNELS);

export const isOutreachKind = (v: unknown): v is OutreachKind => typeof v === "string" && KIND_KEYS.has(v);
export const isOutreachChannel = (v: unknown): v is OutreachChannel =>
  typeof v === "string" && CHANNEL_KEYS.has(v);
export const isOutreachOutcome = (v: unknown): v is OutreachOutcome =>
  typeof v === "string" && OUTCOME_KEYS.has(v);
export const isMarketingConsent = (v: unknown): v is MarketingConsent =>
  typeof v === "string" && CONSENT_KEYS.has(v);
export const isPreferredChannel = (v: unknown): v is PreferredChannel =>
  typeof v === "string" && PREFERRED_KEYS.has(v);

export function labelOf(list: readonly { key: string; label: string }[], key: string | null | undefined): string {
  return list.find((x) => x.key === key)?.label ?? key ?? "";
}

/**
 * Номер для Viber/SMS: нормалізований основний мобільний з обміну контактів,
 * а до першого прогону обміну — перший мобільний із сирого поля phone.
 */
export function outreachPhone(cp: { primaryPhoneE164?: string | null; phone?: string | null }): string | null {
  return cp.primaryPhoneE164 ?? primaryMobileE164(cp.phone);
}

/**
 * Клієнт не хоче повідомлень — будь-яким із трьох способів: відписався (є
 * дата), відмовив у згоді або назвав бажаним каналом «Не турбувати».
 *
 * Одне правило на сайт: попередження на картці клієнта (outreach/compose.ts),
 * тижневий список воркера (rep-feed/outreach-list.ts) і майбутня кампанія
 * мають відсіювати тих самих людей. Дата — Date з бази або ISO-рядок із фактів.
 */
export function refusesMessages(info: {
  marketingOptOutAt?: Date | string | null;
  marketingConsent?: string | null;
  preferredChannel?: string | null;
}): boolean {
  return info.marketingOptOutAt != null || info.marketingConsent === "REFUSED" || info.preferredChannel === "NONE";
}
