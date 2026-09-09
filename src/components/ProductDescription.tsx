"use client";

/**
 * Опис товару.
 *
 * Опис приходить або готовим HTML (розбір каталогів постачальників), або
 * простим текстом із переносами рядків — таких у каталозі 1 498 із 6 486.
 * Саме простий текст і виглядав погано: кожен рядок ставав окремим абзацом
 * однакової ваги, тож на картці круга ATAMAN виходило
 *
 *     Склад
 *     95% - оксид алюмінію
 *     5% - цирконій
 *     Застосовується для різання
 *     вуглецевих, конструкційних і легованих типів сталі
 *     Переваги
 *     • мінімальна вартість одного різу в Україні
 *
 * — тобто заголовки не відрізнялись від тексту, речення було розірване
 * навпіл між двома абзацами, а перелік не був переліком.
 *
 * Тут це складається назад: рядки-продовження зшиваються в речення, короткі
 * рядки без крапки стають заголовками, пункти з «•» — списком.
 */

/** Відомі ключі характеристик — щоб виділити «Ключ: значення» в рядку. */
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const BULLET = /^\s*[•·‣▪]\s*/;

function isBullet(line: string): boolean {
  return BULLET.test(line);
}

/**
 * Рядок схожий на заголовок секції: «Склад», «Переваги», «Комплектація».
 *
 * Самої лише короткості замало. За першою версією заголовками ставали й
 * «95% - оксид алюмінію» та «5% - цирконій» — короткі, без крапки в кінці,
 * але це вміст, а не назва розділу. Тому три обмеження: не починається з
 * цифри, не має тире-роздільника й не довший за чотири слова.
 */
function isHeading(line: string, next: string | undefined): boolean {
  if (!next) return false;
  const t = line.trim();
  if (t.length === 0 || t.length > 44) return false;
  if (isBullet(t)) return false;
  if (/[.,;!?]$/.test(t)) return false;
  // «Ключ: значення» — характеристика, а не заголовок
  if (/^[^:]{1,40}:\s*\S/.test(t)) return false;
  // «95% - оксид алюмінію», «12 В», «2,5 мм» — значення
  if (/^\d/.test(t)) return false;
  // Тире між частинами рядка — теж пара «щось — щось», не назва розділу
  if (/\s[-–—]\s/.test(t)) return false;
  if (t.split(/\s+/).length > 4) return false;
  return true;
}

/**
 * Зшиває рядки, розірвані переносом посеред речення.
 *
 * Ознака розриву: попередній рядок не закінчується розділовим знаком, а
 * наступний починається з малої літери. Саме так у базі лежить
 * «Застосовується для різання» + «вуглецевих, конструкційних і легованих
 * типів сталі» — одне речення у двох абзацах.
 */
function joinWrapped(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    const continues =
      prev !== undefined &&
      !isBullet(prev) &&
      !isBullet(line) &&
      !/[.:!?»)]$/.test(prev) &&
      /^[а-яґєії\p{Ll}]/u.test(line);
    if (continues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

/** Виділяє «Потужність 750 Вт» жирним ключем, якщо ключ відомий. */
function withBoldKey(line: string): string {
  for (const key of CHAR_KEYS) {
    const re = new RegExp(`^(${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*[:：]?\\s*(.+)$`, "i");
    const m = line.match(re);
    if (m) return `<strong>${escapeHtml(m[1])}:</strong> ${escapeHtml(m[2])}`;
  }
  return escapeHtml(line);
}

export function formatPlainText(text: string): string {
  const lines = joinWrapped(text.split(/\r?\n/));
  if (lines.length === 0) return "";

  const html: string[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    html.push(`<ul>${bullets.map((b) => `<li>${withBoldKey(b)}</li>`).join("")}</ul>`);
    bullets = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isBullet(line)) {
      bullets.push(line.replace(BULLET, "").trim());
      continue;
    }
    flushBullets();

    if (isHeading(line, lines[i + 1])) {
      html.push(`<h3>${escapeHtml(line)}</h3>`);
      continue;
    }

    html.push(`<p>${withBoldKey(line)}</p>`);
  }
  flushBullets();

  return html.join("");
}

interface Props {
  description: string;
}

export default function ProductDescription({ description }: Props) {
  if (!description || !description.trim()) return null;

  // Готовий HTML лишаємо як є — його вже почистив sanitizeDescription на
  // сервері (чужі картинки, скрипти, обробники подій).
  const html = isHtml(description) ? description : formatPlainText(description);

  return (
    <div
      className="product-description mt-5 text-g500 leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
