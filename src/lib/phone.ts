/**
 * Український мобільний телефон: одна нормалізація на сайт.
 *
 * Люди диктують і набирають номер шістьма способами — «0671234567»,
 * «+38 067 123 45 67», «38(067)123-45-67». У базі має лежати один вигляд,
 * інакше пошук замовлення за телефоном у менеджера не працює.
 */

/** Канонічний вигляд: +380XXXXXXXXX. null, якщо номер не схожий на український. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");

  // 0671234567 → 380671234567
  // Дев'ять цифр — «без нуля», лише коли нуля справді немає. «(095497739)» —
  // це десятизначний номер, що загубив цифру, а не «95 497 73 9»: без цієї
  // умови він ставав «+380095497739», неіснуючим міським, і в полі клієнта
  // з 1С таких було п'ять із шістнадцяти «лише міських».
  const full =
    digits.length === 10 && digits.startsWith("0")
      ? `38${digits}`
      : digits.length === 9 && !digits.startsWith("0")
        ? `380${digits}` // без нуля, як інколи диктують: «67 123 45 67»
        : digits;

  if (full.length !== 12 || !full.startsWith("380")) return null;
  return `+${full}`;
}

export function isValidUaPhone(raw: string | null | undefined): boolean {
  return normalizePhone(raw) !== null;
}

/**
 * Маска для поля вводу: «+380 67 123 45 67».
 *
 * Показуємо на кожному натисканні, тому працює і з неповним номером —
 * форматувати лише готовий номер означало б поле, що стрибає в кінці.
 */
export function formatPhoneInput(raw: string): string {
  let digits = raw.replace(/\D/g, "");

  // Що б людина не вставила, тримаємо префікс 380 незмінним: набір з «0»
  // (звичка з мобільного) інакше давав би «+3800...».
  if (digits.startsWith("380")) digits = digits.slice(3);
  else if (digits.startsWith("38")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  digits = digits.slice(0, 9);

  const parts = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)];
  return `+380 ${parts.filter(Boolean).join(" ")}`.trimEnd();
}

/** Для посилання tel: — без пробілів. */
export function phoneHref(raw: string | null | undefined): string | null {
  return normalizePhone(raw);
}

/**
 * Коди мобільних операторів після +380.
 *
 * Потрібні, щоб відрізнити мобільний від міського: Viber і SMS на «(032)
 * 245-12-34» не дійдуть, а в полі телефону клієнта з 1С вони лежать упереміш.
 */
const UA_MOBILE_CODES = new Set([
  "39", "50", "63", "66", "67", "68", "73", "75", "77",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

export function isUaMobile(e164: string | null | undefined): boolean {
  if (!e164 || !/^\+380\d{9}$/.test(e164)) return false;
  return UA_MOBILE_CODES.has(e164.slice(4, 6));
}

export type ParsedPhone = {
  /** Шматок рядка, як він стояв у полі. */
  raw: string;
  /** +380XXXXXXXXX або null, якщо номер не український чи неповний. */
  e164: string | null;
  mobile: boolean;
};

/** «доб. 12», «вн.3», «ext 5» — внутрішній номер, не частина телефону. */
const EXTENSION = /(?:^|[\s(,])(?:доб|дод|вн|ext)\.?\s*\d{1,5}\)?/gi;

/**
 * Поле телефону з 1С — не номер, а рядок, як його набрали: «067-123-45-67,
 * 050 111 22 33», «0671234567/0501112233», «(032) 245-12-34 доб. 12».
 * Розбиває його на окремі номери.
 */
export function splitPhones(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const cleaned = raw.replace(EXTENSION, " ");
  const parts = cleaned
    .split(/[,;/|\\\n]|\s(?:або|или|чи)\s/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const part of parts) {
    const digits = part.replace(/\D/g, "");
    // Кілька номерів без роздільника: «0671234567 0501112233», «380671234567
    // 0501112233», «098 6267 213 Василь 063 3491 021 Василь адмін». Цифр більше,
    // ніж вміщує один номер, тож шматок розрізається за відомими початками.
    if (digits.length > 12) {
      const run = splitDigitRun(digits);
      if (run) {
        out.push(...run);
        continue;
      }
    }
    out.push(part);
  }
  return out;
}

/**
 * Жадібне розрізання суцільних цифр на номери: «380…» — 12 цифр, «80…» —
 * 11 (старий міжміський префікс), «0…» — 10. Якщо хвіст не розкладається
 * без решти, повертає null: краще лишити шматок нерозпізнаним, ніж вигадати
 * номер із двох половин різних телефонів.
 */
function splitDigitRun(d: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < d.length) {
    if (d.startsWith("380", i) && i + 12 <= d.length) {
      out.push(d.slice(i, i + 12));
      i += 12;
    } else if (d.startsWith("80", i) && i + 11 <= d.length) {
      out.push(d.slice(i, i + 11));
      i += 11;
    } else if (d[i] === "0" && i + 10 <= d.length) {
      out.push(d.slice(i, i + 10));
      i += 10;
    } else {
      return null;
    }
  }
  return out.length >= 2 ? out : null;
}

export function parsePhones(raw: string | null | undefined): ParsedPhone[] {
  return splitPhones(raw).map((part) => {
    const digits = part.replace(/\D/g, "");
    // «80671234567» — старий міжміський префікс без трійки.
    const e164 = normalizePhone(digits.length === 11 && digits.startsWith("80") ? `3${digits}` : part);
    return { raw: part, e164, mobile: isUaMobile(e164) };
  });
}

/** Номер для Viber/SMS: перший мобільний у полі, інакше null. */
export function primaryMobileE164(raw: string | null | undefined): string | null {
  return parsePhones(raw).find((p) => p.mobile)?.e164 ?? null;
}

/** Перший валідний український номер — мобільний чи міський. */
export function firstValidE164(raw: string | null | undefined): string | null {
  return parsePhones(raw).find((p) => p.e164)?.e164 ?? null;
}
