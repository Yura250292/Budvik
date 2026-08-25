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
export function formatUAH(value: number): string {
  const n = Number.isInteger(value)
    ? value.toLocaleString("uk-UA")
    : value.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ₴`;
}
