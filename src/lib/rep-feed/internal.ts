/**
 * Внутрішні контрагенти — не клієнти, і підказки про них шкідливі.
 *
 * У 1С поруч зі справжніми клієнтами живуть «Склад ( Дубляни)», «Пац
 * Валентин (торговий)», «Джумага Ігор (співробітник)», «Співробітники»,
 * а також картки на повне ім'я торгового («Кулик Дмитро»). У них є документи
 * й борги, тож будь-який підрахунок «кому подзвонити» ставить їх у топ, а
 * ранкове завантаження на складі перетворилося б на «Ви у Склад: борг
 * 39 381 ₴». Окремої ознаки в моделі немає — упізнаємо за назвою.
 *
 * Точний збіг з ім'ям співробітника беремо лише для імен із двох і більше
 * слів: одне слово («Олександр») — і клієнт, і обліковка, і відсіяти його
 * означало б загубити справжнього покупця.
 */

import { prisma } from "@/lib/prisma";

const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES", "DRIVER", "WAREHOUSE"] as const;

export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Ключ для збігу з персоналом: слова без дужок, відсортовані.
 * «Скуратов Юрій (Львів)» і обліковка «Юрій Скуратов» — одна людина, хоч
 * порядок слів і місто в дужках різні.
 */
export function nameKey(name: string): string {
  return normalizeName(name.replace(/\([^)]*\)/g, " "))
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

const MARKERS = ["(співробітник)", "(торговий)", "(водій)", "(склад)"];

/** Чиста перевірка: staffKeys — ключі nameKey повних імен персоналу. */
export function isInternalCounterparty(name: string, staffKeys: ReadonlySet<string>): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  if (n === "співробітники" || n.startsWith("склад ") || n.startsWith("склад(")) return true;
  if (MARKERS.some((m) => n.includes(m))) return true;
  return staffKeys.has(nameKey(name));
}

/** Ключі повних (≥2 слова) імен персоналу. */
export async function loadStaffNames(): Promise<Set<string>> {
  const users = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    select: { name: true },
  });
  const out = new Set<string>();
  for (const u of users) {
    const key = nameKey(u.name);
    if (key.split(" ").length >= 2) out.add(key);
  }
  return out;
}
