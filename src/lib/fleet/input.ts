/**
 * Перевірка полів форм автопарку. Кидає FleetInputError з текстом для людини —
 * роут віддає його як 400.
 */

export class FleetInputError extends Error {}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function optText(raw: unknown, field: string, max = 300): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") throw new FleetInputError(`Поле «${field}» має бути текстом`);
  const v = raw.trim();
  if (v.length > max) throw new FleetInputError(`Поле «${field}» задовге (до ${max} символів)`);
  return v || null;
}

export function reqText(raw: unknown, field: string, max = 300): string {
  const v = optText(raw, field, max);
  if (!v) throw new FleetInputError(`Заповніть поле «${field}»`);
  return v;
}

export function optNum(raw: unknown, field: string, opts: { min?: number; max?: number; int?: boolean } = {}): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) throw new FleetInputError(`Поле «${field}» має бути числом`);
  if (opts.int && !Number.isInteger(n)) throw new FleetInputError(`Поле «${field}» має бути цілим числом`);
  if (opts.min != null && n < opts.min) throw new FleetInputError(`Поле «${field}» не може бути менше ${opts.min}`);
  if (opts.max != null && n > opts.max) throw new FleetInputError(`Поле «${field}» не може бути більше ${opts.max}`);
  return n;
}

export function optDay(raw: unknown, field: string, today: string): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !DAY_RE.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new FleetInputError(`Поле «${field}»: дата у форматі РРРР-ММ-ДД`);
  }
  if (raw > today) throw new FleetInputError(`Поле «${field}»: дата не може бути в майбутньому`);
  return raw;
}

export function reqDay(raw: unknown, field: string, today: string): string {
  const v = optDay(raw, field, today);
  if (!v) throw new FleetInputError(`Вкажіть дату в полі «${field}»`);
  return v;
}

/** «вс 1234 ак» → «ВС1234АК»: латинські двійники літер — у кирилицю, як на табличці. */
export function normalizePlate(raw: string): string {
  const LAT_TO_CYR: Record<string, string> = {
    A: "А", B: "В", C: "С", E: "Е", H: "Н", I: "І", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х",
  };
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[ABCEHIKMOPTX]/g, (ch) => LAT_TO_CYR[ch] ?? ch);
}
