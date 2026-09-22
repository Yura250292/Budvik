/**
 * Звідки прийшов покупець.
 *
 * Окремий файл із чистими функціями — з двох причин. По-перше, правила
 * («мітка важливіша за реферер», «прямий захід не перетирає Hotline»)
 * перевіряються скриптом без браузера й без бази: scripts/check-source.mts.
 * По-друге, той самий розбір потрібен і трекеру вебаналітики, і оформленню
 * замовлення, а дві копії розійшлися б рівно там, де ціна помилки — гроші
 * за кліки.
 *
 * Пам'ять живе в localStorage, а не в куці: кука на сторінках каталогу
 * вимикає ISR, і на цьому вже одного разу виріс рахунок Vercel.
 */

export type Attribution = {
  /** 'hotline', 'google', 'ek.ua', 'direct' — нижній регістр, до 40 символів. */
  source: string;
  /** 'cpc' | 'organic' | 'social' | 'referral' | 'none' */
  medium: string;
  campaign: string | null;
};

export const SOURCE_MEMORY_KEY = "bv_src";

/** Скільки днів пам'ятаємо майданчик, з якого прийшла людина. */
export const SOURCE_MEMORY_DAYS = 30;

export const DIRECT: Attribution = { source: "direct", medium: "none", campaign: null };

/**
 * Реферери, у яких є звичне ім'я.
 *
 * Без цього списку у звіті стояли б голі хости, причому кілька рядків на
 * одне джерело: google.com, google.com.ua і www.google.de — це той самий
 * пошук, а не три різні майданчики.
 */
const KNOWN: Array<{ re: RegExp; source: string; medium: string }> = [
  { re: /(^|\.)hotline\.ua$/, source: "hotline", medium: "cpc" },
  { re: /(^|\.)google\./, source: "google", medium: "organic" },
  { re: /(^|\.)bing\.com$/, source: "bing", medium: "organic" },
  { re: /(^|\.)duckduckgo\.com$/, source: "duckduckgo", medium: "organic" },
  { re: /(^|\.)facebook\.com$/, source: "facebook", medium: "social" },
  { re: /(^|\.)instagram\.com$/, source: "instagram", medium: "social" },
  { re: /(^|\.)t\.me$/, source: "telegram", medium: "social" },
];

/**
 * Дозволені символи мітки. Крапка тут навмисно: джерелом буває хост
 * («ek.ua»), і без неї він не пережив би ані запису в базу, ані пам'яті.
 */
const TAG = /^[a-z0-9._-]+$/;

/**
 * Мітка з адреси або з пам'яті: нижній регістр, до 40 символів.
 *
 * Значення приходить із браузера, тобто ним керує хто завгодно. Усе, що не
 * схоже на мітку, стає null — у базу не має потрапити ані розмітка, ані
 * лапки, ані пробіли, бо це значення потім друкується у звіті.
 */
export function sourceTag(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.trim().toLowerCase().slice(0, 40);
  return clean && TAG.test(clean) ? clean : null;
}

/** Хост реферера без www; побита адреса — не привід валити сторінку. */
function refererHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Джерело візиту.
 *
 * Порядок навмисний: мітка з фіду точніша за реферер. Реферер губиться на
 * редиректах, у застосунках-браузерах і за суворою політикою приватності,
 * тому покладатися лише на нього не можна — а мітку ми ставимо самі.
 */
export function resolveSource(
  search: string,
  referrer: string | null,
  ownHost: string
): Attribution {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const utm = sourceTag(params.get("utm_source"));
  if (utm) {
    return {
      source: utm,
      // Без utm_medium вважаємо це переходом із чужого ресурсу: мітка в
      // адресі сама по собі означає, що людина прийшла не з нашого сайту.
      medium: sourceTag(params.get("utm_medium")) ?? "referral",
      campaign: sourceTag(params.get("utm_campaign")),
    };
  }

  const from = refererHost(referrer);
  const own = ownHost.replace(/^www\./, "").toLowerCase();
  if (!from || from === own) return DIRECT;

  const known = KNOWN.find((k) => k.re.test(from));
  if (known) return { source: known.source, medium: known.medium, campaign: null };

  return { source: from.slice(0, 40), medium: "referral", campaign: null };
}

/** Рядок для localStorage. Короткі ключі: сховище ділимо з кошиком і порівняннями. */
export function packSource(a: Attribution, now: number): string {
  return JSON.stringify({ s: a.source, m: a.medium, c: a.campaign, t: now });
}

/**
 * Назад із localStorage — якщо запис не старший за 30 днів.
 *
 * Мітку часу вимагаємо обов'язково: запис без неї неможливо протермінувати,
 * і одного разу зайшовши з Hotline, людина рахувалася б «з Hotline» вічно.
 */
export function unpackSource(raw: string | null, now: number): Attribution | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { s?: unknown; m?: unknown; c?: unknown; t?: unknown };
    const source = sourceTag(typeof v.s === "string" ? v.s : null);
    const at = typeof v.t === "number" ? v.t : 0;
    if (!source || !at) return null;
    if (now - at > SOURCE_MEMORY_DAYS * 86_400_000) return null;
    return {
      source,
      medium: sourceTag(typeof v.m === "string" ? v.m : null) ?? "referral",
      campaign: sourceTag(typeof v.c === "string" ? v.c : null),
    };
  } catch {
    return null;
  }
}
