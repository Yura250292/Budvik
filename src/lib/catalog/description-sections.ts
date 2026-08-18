/**
 * Розбір опису товару на секції.
 *
 * Описи в базі згенеровані за одним шаблоном: вступ, «Переваги:»,
 * «Особливості конструкції:», «Комплектація:», «Характеристики:» — і
 * кожен пункт з «•». Проза й факти злиті в один текст, тому на картці
 * товару виходило 26 абзаців поспіль, а ліва колонка під фото стояла
 * порожня.
 *
 * Тут витягуємо саме факти (характеристики й комплектацію), щоб показати
 * їх карткою під фото, а прозу лишити обтікати праворуч. Розбір свідомо
 * обережний: якщо структури немає (а це більшість із 6,7 тис. товарів),
 * повертаємо опис незайманим.
 */

/** Рядок характеристики. Порожній key — пункт без «ключ: значення». */
export type Spec = { key: string; value: string };

export type DescriptionSections = {
  specs: Spec[];
  kit: string[];
  /** Опис без витягнутих секцій — те, що піде звичайним текстом. */
  rest: string;
};

/** Заголовок секції: короткий рядок, що закінчується двокрапкою. */
function headingOf(line: string): string | null {
  const t = line.trim();
  if (!t.endsWith(":") || t.length > 40 || t.startsWith("•")) return null;
  return t.slice(0, -1).trim().toLowerCase();
}

function isBullet(line: string): boolean {
  return /^\s*[•·‣▪–—-]\s+/.test(line);
}

function bulletText(line: string): string {
  return line.replace(/^\s*[•·‣▪–—-]\s+/, "").trim();
}

/**
 * Мінімум пунктів, щоб секцію виносити. Характеристиці з одного рядка
 * картка не потрібна — краще лишити рядок у тексті. Комплектація з
 * одного пункту, навпаки, звична («шланг 20 м, без з'єднань») і корисна.
 */
const MIN_ITEMS = { specs: 2, kit: 1 } as const;

export function splitDescription(description: string): DescriptionSections {
  const empty: DescriptionSections = { specs: [], kit: [], rest: description };
  if (!description || !description.includes("•")) return empty;

  const lines = description.split("\n");
  const rest: string[] = [];
  const specs: Spec[] = [];
  const kit: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = headingOf(lines[i]);
    const target =
      heading && /^характеристик/.test(heading)
        ? "specs"
        : heading && /^комплектац/.test(heading)
          ? "kit"
          : null;

    if (!target) {
      rest.push(lines[i]);
      continue;
    }

    // Збираємо пункти до першого рядка, який не пункт і не порожній:
    // саме там секція закінчується (далі зазвичай наступний заголовок
    // або підсумковий абзац).
    const items: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (!isBullet(lines[j])) break;
      items.push(bulletText(lines[j]));
    }

    if (items.length < MIN_ITEMS[target]) {
      rest.push(lines[i]);
      continue;
    }

    if (target === "kit") {
      kit.push(...items);
    } else {
      for (const item of items) {
        const m = item.match(/^([^:]{1,40}):\s*(.+)$/);
        specs.push(m ? { key: m[1].trim(), value: m[2].trim() } : { key: "", value: item });
      }
    }

    i = j - 1; // заголовок і пункти з'їли — далі з рядка, що обірвав секцію
  }

  if (!specs.length && !kit.length) return empty;

  return {
    specs,
    kit,
    rest: rest.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}
