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
  const full =
    digits.length === 10 && digits.startsWith("0")
      ? `38${digits}`
      : digits.length === 9
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
