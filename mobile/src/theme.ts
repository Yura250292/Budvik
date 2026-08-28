/**
 * Кольори й розміри застосунку.
 *
 * Значення взяті з вітрини, а не вигадані заново: жовтий і чорний — ті самі,
 * що в public/manifest.json сайту (theme_color / background_color). Людина, яка
 * ходила на сайт, має впізнати застосунок з першого екрана.
 */

export const colors = {
  /** Фірмовий жовтий. Кнопки дії, акценти, активна вкладка. */
  brand: "#FFD600",
  /** Чорний шапки й підвалу. */
  ink: "#0A0A0A",

  bg: "#FFFFFF",
  surface: "#F5F5F5",

  text: "#111111",
  textMuted: "#6B7280",
  border: "#E5E7EB",

  /** Ціна акції та мітка «немає в наявності». */
  sale: "#DC2626",
  ok: "#16A34A",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radius = { sm: 8, md: 12, lg: 16 } as const;

/**
 * Ціна українською: 1 234,50 ₴, ціле — без копійок.
 *
 * Та сама логіка, що у formatUAH на сайті (src/lib/seo/site.ts): підсумок у
 * кошику застосунку не має відрізнятися від того, що людина бачила в браузері.
 */
/**
 * Гроші — тим самим правилом, що й на сайті (src/lib/utils.ts formatPrice).
 *
 * Раніше тут було своє: `toLocaleString` із двома знаками завжди. Різниця
 * вилазила рівно на половинних сумах — 1234,5 сайт показував як «1 234,5 ₴», а
 * застосунок як «1 234,50 ₴». Той самий борг того самого клієнта виглядав
 * по-різному на двох екранах, які людина відкриває один за одним, і це
 * читається як розбіжність у даних, а не у форматі.
 *
 * Правило: копійки показуємо лише коли вони є, кінцевий нуль прибираємо,
 * тисячі відділяємо нерозривним пробілом, символ гривні теж через нерозривний
 * — інакше він переноситься на новий рядок окремо від числа.
 */
export function formatUAH(value: number): string {
  const NBSP = "\u00A0";
  const v = Number.isFinite(value) ? value : 0;
  const cents = Math.round(Math.abs(v) * 100);

  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const frac = cents % 100;
  // 0 → без дробової частини, 50 → «,5», 7 → «,07»
  const tail = frac === 0 ? "" : `,${String(frac).padStart(2, "0").replace(/0$/, "")}`;

  return `${v < 0 && cents > 0 ? "-" : ""}${whole}${tail}${NBSP}\u20B4`;
}


/**
 * «1 532 позиції», а не «1532 позицій».
 *
 * Форму слова рахуємо, а не пишемо однією на всі числа: застосунок писав
 * «позицій» скрізь, і на кожній другій картці стояло «1224 позицій». Та сама
 * логіка, що у formatCount на сайті (src/lib/utils.ts).
 */
export function formatPositions(n: number): string {
  const value = Math.abs(Math.trunc(n));
  const tens = value % 100;
  const ones = value % 10;
  const form =
    tens > 10 && tens < 20 ? "позицій"
    : ones === 1 ? "позиція"
    : ones >= 2 && ones <= 4 ? "позиції"
    : "позицій";
  return `${value.toLocaleString("uk-UA")} ${form}`;
}
