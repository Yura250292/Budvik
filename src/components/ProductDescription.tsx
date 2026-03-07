"use client";

// Known characteristic keys to detect in plain text descriptions
const CHAR_KEYS = [
  "Розмір", "Зріст", "Окружність", "Ширина", "Довжина", "Висота",
  "Колір", "Матеріал", "Грамаж", "Вага", "Маса", "Потужність",
  "Напруга", "Діаметр", "Тип", "Модель", "Бренд", "Марка",
  "Країна", "Виробник", "Гарантія", "Комплектація", "Комплект",
  "Об'єм", "Ємність", "Швидкість", "Обороти", "Крутний момент",
  "Глибина", "Хід", "Патрон", "Розмір патрона", "Артикул",
  "Кількість", "Штук", "Серія", "Клас", "Захист", "Стандарт",
  "Максимальний", "Мінімальний", "Робочий тиск", "Тиск",
  "Довжина кабелю", "Рівень шуму", "Частота", "Амперметр",
];

function isHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

function formatPlainText(text: string): string {
  // Build regex to match characteristic key-value pairs
  const keysPattern = CHAR_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const charRegex = new RegExp(`(${keysPattern})\\s*[:：]?\\s*`, "gi");

  // Split text into segments by characteristic keys
  const lines = text.split(/\n/).filter((l) => l.trim());

  if (lines.length <= 1) {
    // Single block of text — try to detect characteristic pairs
    // Pattern: "Key value Key value..." without newlines
    const parts: string[] = [];
    let remaining = text;
    let lastIndex = 0;

    const matches = [...text.matchAll(new RegExp(`(?:^|\\s)(${keysPattern})\\s`, "gi"))];

    if (matches.length >= 3) {
      // Multiple characteristics found — format as table
      let specs: { key: string; value: string }[] = [];
      let descriptionPart = "";

      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const start = match.index! + (match[0].startsWith(" ") ? 1 : 0);

        // Text before first match is intro
        if (i === 0 && start > 0) {
          descriptionPart = text.slice(0, start).trim();
        }

        const key = match[1];
        const nextStart = i < matches.length - 1 ? matches[i + 1].index! : text.length;
        let value = text.slice(start + key.length, nextStart).trim();

        // Check if value contains a sentence (description part after specs)
        const sentenceBreak = value.search(/[.!?]\s+[А-ЯІЇЄҐA-Z]/);
        if (sentenceBreak > 0 && i === matches.length - 1) {
          descriptionPart += " " + value.slice(sentenceBreak + 1).trim();
          value = value.slice(0, sentenceBreak + 1).trim();
        }

        specs.push({ key, value: value.replace(/^\s*[:：]\s*/, "") });
      }

      let html = "";
      if (specs.length > 0) {
        html += '<div class="product-specs">';
        html += '<table class="specs-table">';
        for (const { key, value } of specs) {
          html += `<tr><td class="spec-key">${key}</td><td class="spec-value">${value}</td></tr>`;
        }
        html += "</table></div>";
      }
      if (descriptionPart) {
        html += `<div class="product-text">${descriptionPart}</div>`;
      }
      return html;
    }
  }

  // Multi-line text or no clear specs — format paragraphs
  let html = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Bold characteristic key if found
    let formatted = trimmed;
    for (const key of CHAR_KEYS) {
      const regex = new RegExp(`^(${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[:：]?\\s*(.+)`, "i");
      const m = formatted.match(regex);
      if (m) {
        formatted = `<strong>${m[1]}:</strong> ${m[2]}`;
        break;
      }
    }
    html += `<p>${formatted}</p>`;
  }
  return html;
}

interface Props {
  description: string;
}

export default function ProductDescription({ description }: Props) {
  if (!description || !description.trim()) {
    return null;
  }

  const hasHtml = isHtml(description);

  if (hasHtml) {
    return (
      <div
        className="product-description text-gray-600 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: description }}
      />
    );
  }

  // Plain text — auto-format
  const formatted = formatPlainText(description);

  return (
    <div
      className="product-description text-gray-600 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: formatted }}
    />
  );
}
