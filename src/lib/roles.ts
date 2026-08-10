import type { Role } from "@prisma/client";

/**
 * Ролі користувачів: підписи, кольори і правила призначення.
 *
 * Єдине джерело для розділу «Користувачі» (/admin/users). Раніше
 * roleLabels/roleColors були продубльовані в кожній сторінці, і списки
 * ролей розходилися: у списку користувачів не було WAREHOUSE, у whitelist
 * PATCH — DRIVER, хоча водіїв очікують /admin/erp/delivery-routes і
 * /manager/routes.
 *
 * Enforcement лишається на сервері (api/admin/users/*), тут — шар UI.
 */

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Адмін",
  MANAGER: "Менеджер",
  SALES: "Торговий",
  WAREHOUSE: "Складовщик",
  DRIVER: "Водій",
  WHOLESALE: "Оптовик",
  CLIENT: "Клієнт",
};

export const ROLE_COLORS: Record<Role, string> = {
  ADMIN: "bg-bk text-primary",
  MANAGER: "bg-purple-100 text-purple-700",
  SALES: "bg-blue-100 text-blue-700",
  WAREHOUSE: "bg-orange-100 text-orange-700",
  DRIVER: "bg-teal-100 text-teal-700",
  WHOLESALE: "bg-primary/10 text-primary-dark",
  CLIENT: "bg-green-100 text-green-700",
};

/**
 * Ролі, які можна призначити через PATCH /api/admin/users/[id].
 *
 * ADMIN свідомо відсутній: роздача адмінських прав через випадаючий список —
 * шлях ескалації. Адміна заводять сідом або руками в базі.
 */
export const ASSIGNABLE_ROLES: Role[] = [
  "CLIENT",
  "WHOLESALE",
  "SALES",
  "WAREHOUSE",
  "DRIVER",
  "MANAGER",
];

/**
 * Ролі, які можна створити через POST /api/admin/users.
 * Без MANAGER: підняти до менеджера можна лише свідомою зміною ролі
 * наявного запису, а не створенням нового «мимохідь».
 */
export const CREATABLE_ROLES: Role[] = [
  "CLIENT",
  "WHOLESALE",
  "SALES",
  "WAREHOUSE",
  "DRIVER",
];

/** Ролі, чиї права не можна забрати побічним ефектом іншої дії. */
export const PROTECTED_ROLES: Role[] = ["ADMIN", "MANAGER"];

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

export function roleColor(role: string): string {
  return ROLE_COLORS[role as Role] ?? "bg-g100 text-g600";
}

/**
 * Наслідок пониження — щоб підтвердження називало його прямо, а не питало
 * абстрактне «Зняти роль?».
 */
export const ROLE_DEMOTION_WARNING: Partial<Record<Role, string>> = {
  SALES: "Втратить доступ до кабінету торгового. Регіони та закріплені клієнти залишаться.",
  WAREHOUSE: "Не зможе відкривати зміни й надсилати накладні через бота.",
  DRIVER: "Зникне зі списку водіїв у маршрутах доставки.",
  MANAGER: "Втратить доступ до адмінки.",
};

/**
 * Чи може `actor` призначити роль `next` користувачу з роллю `current`.
 * Дзеркалить серверні перевірки в api/admin/users/[id]/route.ts.
 */
export function canAssignRole(actorRole: string, currentRole: string, next: Role): boolean {
  // ADMIN не призначається і не знімається через список.
  if (next === "ADMIN" || currentRole === "ADMIN") return false;
  // MANAGER роздає лише адмін — інакше двоє менеджерів по черзі
  // зняли б один одного.
  if ((next === "MANAGER" || currentRole === "MANAGER") && actorRole !== "ADMIN") return false;
  return ASSIGNABLE_ROLES.includes(next);
}
