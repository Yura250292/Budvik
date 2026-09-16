/**
 * Контакти з регістру 1С «КонтактнаяИнформация»: що це за рядок і який із
 * них головний.
 *
 * Чистий модуль, без Prisma: ним користуються обмін (sync-ingest/apply-contacts.ts)
 * і перевірки, а правило має бути одне на всіх — інакше обмін вважатиме
 * головним один номер, а картка покаже інший.
 *
 * Чому вид виводить сервер, а не агент. Агент лише переказує, що стоїть у 1С
 * (`ПРЕДСТАВЛЕНИЕ(Вид)`, `ПРЕДСТАВЛЕНИЕ(Тип)`, значення). Розрізнити мобільний
 * і міський, факс і телефон — уже семантика сайту, і правити її в PowerShell
 * на сервері, до якого ходять через RDP, було б дорого.
 *
 * Звідки назви. Проба probe-contacts.ps1 (25.08.2026) дала чотири типи —
 * «Адрес», «Телефон», «E-Mail», «Другое» — і п'ятнадцять видів: крім
 * очікуваних телефонів і адрес там є «Факс контрагента», «Факс организации»,
 * «Контактный телефон кандидата» і «Географическая широта/долгота».
 */

import { createHash } from "node:crypto";
import { firstValidE164, parsePhones, primaryMobileE164 } from "@/lib/phone";

export type ContactKind = "PHONE" | "MOBILE" | "EMAIL" | "ADDRESS" | "OTHER";

/** Куди контакт лягає на картці: телефон (мобільний чи міський), пошта, адреса. */
export type ContactClass = "PHONE" | "EMAIL" | "ADDRESS";

/**
 * Порядок, у якому телефон стає головним.
 *
 * Той самий, що в одноразовому експортері agent/ps/export-contacts.ps1: саме
 * ним заповнювались Counterparty.phone 25.08, і інший порядок тут означав би,
 * що перший же прогін обміну «виправить» номери, які ніхто не міняв.
 */
export const PHONE_KIND_PRIORITY = [
  "Телефон контрагента",
  "Мобильный телефон контактного лица контрагента",
  "Телефон физ.лица служебный",
  "Телефон физ.лица домашний",
] as const;

export const EMAIL_KIND_PRIORITY = [
  "Адрес электронной почты контрагента для обмена электронными документами",
] as const;

/**
 * Адреса доставки першою не випадково: це місце, куди їде товар, а
 * юридична адреса фірми часто в іншому місті — геокодування не тієї ставить
 * пін клієнта на інший кінець області.
 */
export const ADDRESS_KIND_PRIORITY = [
  "Адрес доставки",
  "Фактический адрес контрагента",
  "Юридический адрес контрагента",
  "Фактический адрес организации",
  "Юридический адрес организации",
] as const;

/**
 * Назва виду для порівняння. У базі трапляються «физ.лица» і «физ. лица»,
 * регістр і «ё» теж плавають — для людини це той самий вид.
 */
function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\.\s+/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

/** Вид за назвою — коли тип не приїхав або він незнайомий. */
function kindFromName(k: string): ContactKind | null {
  if (!k) return null;
  // Пошта раніше за адресу: «Адрес электронной почты» містить слово «адрес».
  if (k.includes("почт") || k.includes("пошт") || k.includes("e-mail") || k.includes("email")) {
    return "EMAIL";
  }
  // Факс раніше за телефон: тип у нього «Телефон», але ні подзвонити, ні
  // написати у Viber на нього не вийде.
  if (k.includes("факс")) return "OTHER";
  if (k.includes("телефон") || k.includes("моб")) return "PHONE";
  if (k.includes("адрес")) return "ADDRESS";
  if (k.includes("широта") || k.includes("долгота") || k.includes("довгота")) return "OTHER";
  return null;
}

/**
 * PHONE | MOBILE | EMAIL | ADDRESS | OTHER для рядка регістру.
 *
 * Спершу тип (перелічення 1С, у нього чотири значення і воно не
 * перейменовується), потім назва виду (довідник, його правлять люди), і
 * лише коли немає ні того, ні іншого — саме значення. Телефон, у якому є
 * український мобільний, стає MOBILE: саме на нього можна писати.
 */
export function classifyContactKind(
  kind1C: string | null | undefined,
  type1C: string | null | undefined,
  value?: string | null
): ContactKind {
  const t = norm(type1C);
  const k = norm(kind1C);

  let base: ContactKind | null = null;
  if (t) {
    if (t.includes("mail") || t.includes("почт") || t.includes("пошт")) base = "EMAIL";
    else if (t.includes("телефон")) base = k.includes("факс") ? "OTHER" : "PHONE";
    else if (t.includes("адрес")) base = "ADDRESS";
    else if (t.includes("друг") || t.includes("інш") || t.includes("веб") || t.includes("skype")) {
      base = "OTHER";
    }
  }
  if (!base) base = kindFromName(k);
  if (!base && !t && !k && value) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) base = "EMAIL";
    else if (firstValidE164(value)) base = "PHONE";
  }
  if (!base) base = "OTHER";

  if (base === "PHONE" && primaryMobileE164(value)) return "MOBILE";
  return base;
}

export function contactClassOf(kind: string): ContactClass | null {
  if (kind === "PHONE" || kind === "MOBILE") return "PHONE";
  if (kind === "EMAIL") return "EMAIL";
  if (kind === "ADDRESS") return "ADDRESS";
  return null;
}

export function priorityFor(cls: ContactClass): readonly string[] {
  if (cls === "PHONE") return PHONE_KIND_PRIORITY;
  if (cls === "EMAIL") return EMAIL_KIND_PRIORITY;
  return ADDRESS_KIND_PRIORITY;
}

/**
 * Місце виду в списку пріоритету: точний збіг — його індекс, збіг
 * підрядком («Телефон контрагента (основной)») — одразу за ним, будь-який
 * інший вид того самого класу — у кінці. Невідомий вид не відкидається:
 * телефон «Телефон организации» кращий за відсутність телефону.
 */
export function kindRank(kind1C: string | null | undefined, priority: readonly string[]): number {
  const k = norm(kind1C);
  const names = priority.map(norm);
  const exact = names.indexOf(k);
  if (exact >= 0) return exact;
  if (k) {
    const partial = names.findIndex((n) => k.includes(n) || n.includes(k));
    if (partial >= 0) return partial + 0.5;
  }
  return names.length;
}

/**
 * Рядки одного класу в порядку «хто головний». Нічья — за ordinal, потім
 * за значенням: порядок має бути однаковим від прогону до прогону, інакше
 * головний номер «стрибав» би без жодної зміни в 1С.
 */
export function sortByPriority<
  T extends { kind1C?: string | null; ordinal?: number | null; value: string },
>(rows: readonly T[], priority: readonly string[]): T[] {
  return [...rows].sort(
    (a, b) =>
      kindRank(a.kind1C, priority) - kindRank(b.kind1C, priority) ||
      (a.ordinal ?? 0) - (b.ordinal ?? 0) ||
      a.value.localeCompare(b.value)
  );
}

/**
 * Значення для пошуку: +380XXXXXXXXX для телефонів (мобільний, якщо є, бо
 * за ним шукатимуть «хто написав у бот»), нижній регістр для пошти, null
 * для решти.
 */
export function normalizeContactValue(kind: string, value: string): string | null {
  if (kind === "PHONE" || kind === "MOBILE") {
    return primaryMobileE164(value) ?? firstValidE164(value);
  }
  if (kind === "EMAIL") {
    const v = value.trim().toLowerCase();
    return v.includes("@") ? v : null;
  }
  return null;
}

/**
 * Ключ, за яким значення порівнюються «чи це те саме».
 *
 * Потрібен, щоб відрізнити правку людини від перезапису формату: «067-123-45-67»
 * і «0671234567» — один номер, і картку через таку різницю не чіпаємо. Для
 * телефонів порівнюється набір номерів (порядок у полі не важить), для
 * адреси — текст без зайвих пробілів і регістру.
 */
export function contactCompareKey(cls: ContactClass, value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (cls === "PHONE") {
    const numbers = [
      ...new Set(parsePhones(v).map((p) => p.e164).filter((e): e is string => !!e)),
    ].sort();
    if (numbers.length) return numbers.join(",");
    const digits = v.replace(/\D/g, "");
    return digits || norm(v);
  }
  if (cls === "EMAIL") return v.toLowerCase();
  return norm(v).replace(/\s+([,.;])/g, "$1");
}

/**
 * Ключ ідемпотентності рядка з 1С: контрагент | особа | вид | хеш значення.
 *
 * Значення хешуємо, а не кладемо як є: адреса буває на кількасот символів,
 * а унікальний індекс на такому ключі — зайва вага на кожному записі.
 * Шістнадцять hex-символів sha1 (64 біти) у межах одного контрагента й
 * одного виду колізій не дають.
 *
 * Лише для сервера й скриптів (node:crypto) — у браузерний бандл цей модуль
 * не тягнути.
 */
export function contactExternalKey(
  counterpartyExternalId: string,
  personExternalId: string | null | undefined,
  kind1C: string | null | undefined,
  value: string
): string {
  const hash = createHash("sha1").update(value.trim()).digest("hex").slice(0, 16);
  return `${counterpartyExternalId}|${personExternalId ?? ""}|${norm(kind1C)}|${hash}`;
}
