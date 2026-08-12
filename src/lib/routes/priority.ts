/**
 * Наскільки важливо потрапити до цього клієнта саме сьогодні й раніше.
 *
 * Чотири сигнали, і кожен відповідає на своє питання:
 *
 *   борг     — чи є що забирати і чи горить (каса ввечері закривається,
 *              а протермінований борг гасне швидше за свіжий);
 *   оборот   — чи вартий клієнт того, щоб його не проґавити;
 *   стан     — чи він від нас іде (SLIPPING/DORMANT треба рятувати);
 *   доставка — скільки грошей у цій конкретній накладній.
 *
 * Оцінка нормована в 0..1, щоб зважування було зрозумілим: жоден сигнал
 * не може «перекричати» решту просто тому, що вимірюється в гривнях, а
 * не в днях. Ваги — свідомий компроміс, який видно з одного погляду і
 * який можна змінити, не переписуючи математику.
 *
 * ЩО ЦЕ НЕ РОБИТЬ: не переставляє точки саме по собі. Оцінка лише каже
 * оптимізатору, за кого варто платити гаком, а рішення про порядок
 * ухвалює optimize.ts, дивлячись на реальні кілометри.
 */

import type { ClientState } from "@/lib/analytics/clients";

export type PriorityInput = {
  /** Загальне сальдо клієнта, ₴ */
  receivable: number;
  /** Прострочена частина боргу, ₴ — те, що горить */
  overdue: number;
  /** Оборот за останні місяці, ₴ */
  turnover: number;
  /** Сума накладних, які веземо саме сьогодні, ₴ */
  deliveryAmount: number;
  /** Стан клієнта на сьогодні */
  state: ClientState | null;
};

/**
 * Ваги сигналів. Сума = 1, тому підсумок теж лишається в 0..1.
 *
 * Борг важить найбільше, бо це єдиний сигнал про ГРОШІ В РУКИ сьогодні:
 * все інше — про потенціал, а він не зникає, якщо приїхати завтра.
 */
export const WEIGHTS = {
  debt: 0.4,
  turnover: 0.2,
  state: 0.2,
  delivery: 0.2,
} as const;

/**
 * Стани клієнта як терміновість візиту.
 *
 * SLIPPING найвище не помилково: це клієнт, який ЩЕ купує, але вже рідше
 * — його можна втримати. LOST уже втрачений, і рятувати його з машини,
 * повної чужого товару, пізно; ним має займатися торговий, а не водій.
 */
const STATE_URGENCY: Record<ClientState, number> = {
  SLIPPING: 1,
  DORMANT: 0.8,
  NEW: 0.6,
  ACTIVE: 0.3,
  LOST: 0.2,
};

/**
 * Стискає гроші в 0..1 без стелі.
 *
 * Лінійна нормалізація «поділити на максимум» дала б дику чутливість до
 * одного великого клієнта: якщо в маршруті є борг на 200 тис., то всі
 * борги по 3–8 тис. злипаються біля нуля і перестають розрізнятися.
 * Логарифм лишає різницю між 1 500 і 7 800 помітною.
 */
function softScale(value: number, half: number): number {
  if (value <= 0) return 0;
  return Math.log1p(value) / Math.log1p(value + half);
}

/** Оцінка пріоритету клієнта, 0..1. */
export function scoreClient(input: PriorityInput): number {
  // Протермінований борг важить удвічі: свіжий борг у межах відстрочки —
  // це нормальна робота, а не привід міняти маршрут.
  const debtWeighted = input.receivable + input.overdue;
  const debt = softScale(debtWeighted, 5_000);

  const turnover = softScale(input.turnover, 50_000);
  const delivery = softScale(input.deliveryAmount, 10_000);
  const state = input.state ? STATE_URGENCY[input.state] : 0.3;

  return (
    debt * WEIGHTS.debt +
    turnover * WEIGHTS.turnover +
    state * WEIGHTS.state +
    delivery * WEIGHTS.delivery
  );
}

/** Людською мовою: чому ця точка вгорі. Для підказки в UI. */
export function explainScore(input: PriorityInput): string {
  const parts: string[] = [];
  if (input.overdue > 0) parts.push(`прострочено ${Math.round(input.overdue)} ₴`);
  else if (input.receivable > 0) parts.push(`борг ${Math.round(input.receivable)} ₴`);
  if (input.state === "SLIPPING") parts.push("клієнт іде");
  else if (input.state === "DORMANT") parts.push("давно мовчить");
  else if (input.state === "NEW") parts.push("новий");
  if (input.deliveryAmount >= 10_000) parts.push(`велика доставка ${Math.round(input.deliveryAmount)} ₴`);
  return parts.length ? parts.join(", ") : "звичайна точка";
}
