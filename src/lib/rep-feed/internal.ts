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

/**
 * Позначки в дужках, якими 1С підписує своїх. «(системний адмін)» знайшовся
 * прогоном приходу 13.09: «Рудько Роман (системний адмін)» стояв серед
 * покупців піни.
 */
const MARKERS = ["(співробітник)", "(торговий)", "(водій)", "(склад)", "(системний адмін)", "(адмін)"];

/** Чиста перевірка: staffKeys — ключі nameKey повних імен персоналу. */
export function isInternalCounterparty(name: string, staffKeys: ReadonlySet<string>): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  if (n === "співробітники" || n.startsWith("склад ") || n.startsWith("склад(")) return true;
  if (MARKERS.some((m) => n.includes(m))) return true;
  return staffKeys.has(nameKey(name));
}

/**
 * Усе, що треба знати, щоб відсіяти своїх: ручна ознака Counterparty.isInternal
 * (її ставить людина — ловить «ФОП Кулик Дмитро Михайлович», якого назва не
 * видає) і евристика за назвою (ловить щойно заведені в 1С картки, які ще
 * ніхто не позначив).
 */
export type InternalContext = {
  staffKeys: ReadonlySet<string>;
  /** Позначені «свій». */
  ids: ReadonlySet<string>;
  /**
   * Людина явно зняла ознаку: isInternal = false, але internalSetAt стоїть.
   * Без цього картку, яку назва видає за свою («Кулик Дмитро» — і торговий,
   * і реальний клієнт-однофамілець), неможливо було б повернути в клієнти:
   * евристика за назвою перекривала б рішення людини.
   */
  clientIds: ReadonlySet<string>;
};

export async function loadInternalContext(): Promise<InternalContext> {
  const [staffKeys, decided] = await Promise.all([
    loadStaffNames(),
    prisma.counterparty.findMany({
      where: { OR: [{ isInternal: true }, { internalSetAt: { not: null } }] },
      select: { id: true, isInternal: true },
    }),
  ]);
  return {
    staffKeys,
    ids: new Set(decided.filter((d) => d.isInternal).map((d) => d.id)),
    clientIds: new Set(decided.filter((d) => !d.isInternal).map((d) => d.id)),
  };
}

/**
 * Чиста перевірка за контекстом. Рішення людини важить більше за назву:
 * явно знята ознака — клієнт, поставлена — свій; евристика лише для карток,
 * про які ще ніхто не вирішував.
 */
export function isInternalClient(
  client: { id?: string | null; name: string },
  ctx: InternalContext
): boolean {
  if (client.id && ctx.clientIds.has(client.id)) return false;
  if (client.id && ctx.ids.has(client.id)) return true;
  return isInternalCounterparty(client.name, ctx.staffKeys);
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
