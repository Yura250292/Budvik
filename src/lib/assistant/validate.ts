/**
 * Перевірка аргументів, які прислала модель.
 *
 * Своє, а не zod: у проєкті його немає, а тягнути залежність заради
 * десятка полів — зайве. Головна вимога інша: помилка мусить повертатися
 * МОДЕЛІ українським текстом, а не падати 500-ю. Модель, отримавши
 * «день має бути у форматі 2026-09-04», виправляється з другої спроби;
 * від винятку користувач бачить лише порожній екран.
 */

/** Помилка аргументів — ловиться циклом і йде моделі як результат. */
export class ToolArgError extends Error {}

function fail(message: string): never {
  throw new ToolArgError(message);
}

export function str(
  raw: unknown,
  field: string,
  { min = 1, max = 500, required = true, fallback = "" } = {}
): string {
  if (raw === undefined || raw === null || raw === "") {
    if (required) fail(`Поле «${field}» обов'язкове`);
    return fallback;
  }
  if (typeof raw !== "string") fail(`Поле «${field}» має бути текстом`);
  const value = raw.trim();
  if (value.length < min) fail(`Поле «${field}» закоротке (мінімум ${min})`);
  return value.length > max ? value.slice(0, max) : value;
}

export function int(
  raw: unknown,
  field: string,
  { min = 0, max = 1000, fallback }: { min?: number; max?: number; fallback: number }
): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n)) fail(`Поле «${field}» має бути числом`);
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function bool(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).toLowerCase();
  if (s === "true" || s === "1" || s === "так") return true;
  if (s === "false" || s === "0" || s === "ні") return false;
  return fallback;
}

export function enumOf<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
  fallback: T | null = null
): T | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = String(raw).trim().toUpperCase();
  const hit = allowed.find((a) => a.toUpperCase() === value);
  if (!hit) fail(`Поле «${field}»: дозволено лише ${allowed.join(", ")}`);
  return hit;
}

/** YYYY-MM-DD і справді існуючий день. */
export function day(raw: unknown, field: string, fallback: string): string {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`Поле «${field}» має бути датою у форматі 2026-09-04`);
  }
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) fail(`Дата «${value}» не існує`);
  return value;
}

/**
 * Ідентифікатор із результату іншого інструмента.
 *
 * Перевіряємо форму, а не існування: неіснуючий id упаде в самому
 * інструменті зрозумілим «клієнта не знайдено», а вигаданий рядок на
 * кшталт «ТОВ Ромашка» треба відсікти одразу — інакше з нього вийде
 * запит із порожньою відповіддю, і модель вирішить, що клієнта немає.
 */
export function id(raw: unknown, field: string): string {
  const value = str(raw, field, { min: 6, max: 40 });
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(value)) {
    fail(`Поле «${field}» має бути ідентифікатором з попередньої відповіді, а не назвою`);
  }
  return value;
}
