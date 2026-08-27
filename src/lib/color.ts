/**
 * Кольори банерів — в одному місці, бо їх рахують і сервер, і клієнт.
 *
 * Банер завжди будується з одного поля color: другий тон градієнта і колір
 * напису на ньому виводяться, а не зберігаються. Вимагати від адміністратора
 * «колір-компаньйон» і «колір тексту» означало б отримати або порожні поля,
 * або випадкове поєднання.
 */

/** Правильний шестизначний #RRGGBB — усе інше вважаємо не кольором. */
const HEX = /^#[0-9a-f]{6}$/i;

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Чи світлий колір — за сприйнятою яскравістю.
 *
 * Око значно чутливіше до зеленого, ніж до синього, тож середнє арифметичне
 * каналів тут бреше: #FFD600 воно вважає удвічі темнішим, ніж він є.
 */
export function isLight(hex: string): boolean {
  if (!HEX.test(hex)) return true;
  const [r, g, b] = channels(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
}

/**
 * Другий тон градієнта — той самий колір, притемнений.
 */
export function shade(hex: string): string {
  if (!HEX.test(hex)) return hex;
  const mix = (c: number) => Math.max(0, Math.round(c * 0.78));
  return `#${channels(hex).map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Відносна яскравість за WCAG — не те саме, що сприйнята вище. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Коефіцієнт контрасту двох кольорів за WCAG: від 1 (однакові) до 21. */
export function contrastRatio(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 1;
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const INK_DARK = "#0A0A0A";
export const INK_LIGHT = "#FFFFFF";

/**
 * Чорний напис чи білий — за фактичним контрастом, а не за «на око».
 *
 * isLight вище відповідає на інше питання (чи спрацює mix-blend-multiply) і на
 * межі помиляється в бік нечитабельного: для глибокого помаранчу #E85D04 він
 * каже «темний» і просить білий напис — а той дає 3,5:1, тобто нижче норми,
 * тоді як чорний на тому самому тлі дає 6:1. Тут рахуємо обидва варіанти й
 * беремо кращий, тому банер не може вийти з нечитабельним написом навіть із
 * невдалим фірмовим кольором.
 */
export function inkOn(hex: string): string {
  if (!HEX.test(hex)) return INK_DARK;
  return contrastRatio(hex, INK_DARK) >= contrastRatio(hex, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

/**
 * Сірий за замовчуванням, який стоїть у 352 брендів із 359.
 *
 * Формально колір є в усіх, але в переважної більшості він однаковий — тобто
 * його немає.
 */
const DEFAULT_GREY = "#9e9e9e";

/**
 * Палітра для брендів без власного кольору. Глибокі приглушені тони, а не
 * веселка: знак має виглядати як фірмовий колір, а не як випадкова мітка.
 *
 * Та сама, що в застосунку (mobile/src/components/BrandTile.tsx), і хеш той
 * самий — інакше бренд мав би різні кольори на сайті й у телефоні.
 */
const PALETTE = [
  "#1F3A93", "#B03A2E", "#1E824C", "#6C3483", "#B9770E",
  "#17657D", "#7D3C98", "#935116", "#1A5276", "#7B241C",
];

/** Колір бренда: власний, якщо він справжній, інакше стабільний за назвою. */
export function brandAccent(name: string, color?: string | null): string {
  const own = color?.toLowerCase();
  if (own && HEX.test(own) && own !== DEFAULT_GREY) return own;

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
