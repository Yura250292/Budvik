/**
 * Звірка формату грошей між сайтом і застосунком.
 *
 * Запуск:  npx tsx scripts/check-money-format.ts
 *
 * Заради чого. formatUAH у застосунку — копія правила formatPrice із сайту, бо
 * спільного коду між ними немає. Розбіжність не падає й не світиться в логах:
 * той самий борг того самого клієнта просто виглядає по-різному на двох
 * екранах, які людина відкриває один за одним. Читається це не як різниця у
 * форматі, а як різниця в даних — і саме тому звіряємо машинно.
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { formatUAH } from "../src/theme";

const HERE = dirname(fileURLToPath(import.meta.url));

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

async function main() {
  const site = await import(join(HERE, "../../src/lib/utils.ts"));

  /** Суми, на яких правила й розходилися: половинні, дрібні копійки, від'ємні. */
  const VALUES = [0, 1, 7, 50, 100, 999, 1000, 1234, 12345, 1234.5, 1234.07, 1234.56, 0.5, 0.05, -50, -1234.5];

  for (const v of VALUES) {
    const a = site.formatPrice(v);
    const b = formatUAH(v);
    check(`${v}`, a === b, { сайт: a, застосунок: b });
  }

  /** Нерозривні пробіли обов'язкові: інакше «₴» переноситься окремо від числа. */
  const sample = formatUAH(12345.5);
  check("тисячі через нерозривний пробіл", sample.includes(" "), sample);
  check("символ гривні через нерозривний пробіл", / ₴$/.test(sample), sample);

  console.log(failed === 0 ? "\nФормати збігаються." : `\nРозбіжностей: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
