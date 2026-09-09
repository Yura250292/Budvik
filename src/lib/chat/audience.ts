/**
 * Адреса повідомлення й ключ розмови — чиста логіка без бази.
 *
 * Цей модуль імпортують і роути, і клієнтські компоненти (вибір адресатів,
 * підписи розмов), тому тут немає ні Prisma, ні next-auth. Набори ролей
 * повторено з lib/app/identity.ts свідомо: той модуль тягне next/server і
 * сесію, а сторінці кабінету потрібні лише самі назви.
 *
 * Розмова — не сутність у базі, а ключ, який виводиться з адреси
 * повідомлення. Ключ лежить в адресі сторінки (/sales/chat/<key>) і в
 * пуші, тому в ньому лише [a-z0-9-]: білий список тапів у застосунку інших
 * символів не пропускає.
 */

import { defaultTargetFor } from "@/lib/app/role-target";

export const OFFICE = ["ADMIN", "MANAGER"] as const;
export const STAFF = ["ADMIN", "MANAGER", "SALES", "WAREHOUSE", "DRIVER"] as const;
/** Хто бачить «Журнал» — усі повідомлення підряд, включно з чужими особистими. */
export const JOURNAL_ROLES = ["ADMIN"] as const;

/** Ролі, у яких є своя групова розмова. Офіс — член кожної, своєї не має. */
export type GroupRole = "SALES" | "DRIVER" | "WAREHOUSE";
export const GROUP_ROLES: readonly GroupRole[] = ["SALES", "DRIVER", "WAREHOUSE"];

export type Section = "sales" | "driver" | "warehouse" | "admin";

export const GROUPS: ReadonlyArray<{ key: string; label: string; role: GroupRole | null }> = [
  { key: "all", label: "Усі", role: null },
  { key: "role-SALES", label: "Торгові", role: "SALES" },
  { key: "role-DRIVER", label: "Водії", role: "DRIVER" },
  { key: "role-WAREHOUSE", label: "Склад", role: "WAREHOUSE" },
];

export const GROUP_LABEL: Record<GroupRole, string> = {
  SALES: "Торгові",
  DRIVER: "Водії",
  WAREHOUSE: "Склад",
};

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Адміністратор",
  MANAGER: "Менеджер",
  SALES: "Торговий",
  DRIVER: "Водій",
  WAREHOUSE: "Склад",
};

export type ConversationKey =
  | { type: "all" }
  | { type: "role"; role: GroupRole }
  | { type: "dm"; a: string; b: string }
  | { type: "journal" };

export type Audience = {
  toAll: boolean;
  toRoles: GroupRole[];
  toUserId: string | null;
};

export type Me = { userId: string; role: string };

export const isOffice = (role: string) => (OFFICE as readonly string[]).includes(role);
export const isStaff = (role: string) => (STAFF as readonly string[]).includes(role);
export const isGroupRole = (role: string): role is GroupRole =>
  (GROUP_ROLES as readonly string[]).includes(role);
export const hasJournal = (role: string) => (JOURNAL_ROLES as readonly string[]).includes(role);

/** Ключ особистої розмови: id обох, відсортовані — один і той самий з обох боків. */
export function dmKey(a: string, b: string): string {
  return a < b ? `dm-${a}-${b}` : `dm-${b}-${a}`;
}

const DM_RE = /^dm-([a-z0-9]+)-([a-z0-9]+)$/;

export function parseKey(key: string): ConversationKey | null {
  if (key === "all") return { type: "all" };
  if (key === "journal") return { type: "journal" };
  if (key.startsWith("role-")) {
    const role = key.slice(5);
    return isGroupRole(role) ? { type: "role", role } : null;
  }
  const m = DM_RE.exec(key);
  if (m) {
    const [a, b] = m[1] < m[2] ? [m[1], m[2]] : [m[2], m[1]];
    if (a === b) return null;
    return { type: "dm", a, b };
  }
  return null;
}

export function formatKey(k: ConversationKey): string {
  switch (k.type) {
    case "all":
      return "all";
    case "journal":
      return "journal";
    case "role":
      return `role-${k.role}`;
    case "dm":
      return dmKey(k.a, k.b);
  }
}

/** У яких розмовах живе повідомлення (без журналу — його додає той, хто читає). */
export function keysOf(m: {
  toAll: boolean;
  toRoles: readonly string[];
  toUserId: string | null;
  authorId: string;
}): string[] {
  if (m.toUserId) return [dmKey(m.authorId, m.toUserId)];
  if (m.toAll) return ["all"];
  return m.toRoles.filter(isGroupRole).map((r) => `role-${r}`);
}

/** Групові розмови, які людина бачить у списку: офіс — усі, поле — «Усі» + своя. */
export function groupsFor(role: string): string[] {
  if (isOffice(role)) return GROUPS.map((g) => g.key);
  return GROUPS.filter((g) => g.role === null || g.role === role).map((g) => g.key);
}

export function canRead(me: Me, k: ConversationKey): boolean {
  if (!isStaff(me.role)) return false;
  switch (k.type) {
    case "all":
      return true;
    case "role":
      return isOffice(me.role) || me.role === k.role;
    case "dm":
      return me.userId === k.a || me.userId === k.b || hasJournal(me.role);
    case "journal":
      return hasJournal(me.role);
  }
}

/**
 * Куди людині можна писати.
 *
 * Офіс обирає групи галочками. Польова роль пише в «Усі», у свою групу
 * та особисто — у чужу групу ні: там її відповіді ніхто б не побачив, а
 * повідомлення без відповіді читається як проігнороване.
 */
export function canWriteAudience(me: Me, a: Audience): boolean {
  if (!isStaff(me.role)) return false;
  if (a.toUserId) return a.toUserId !== me.userId && !a.toAll && a.toRoles.length === 0;
  if (a.toAll) return true;
  if (a.toRoles.length === 0) return false;
  if (isOffice(me.role)) return true;
  return a.toRoles.every((r) => r === me.role);
}

/** Підпис адреси на повідомленні: «Усі», «Торгові, Водії», «Особисто». */
export function audienceLabel(m: { toAll: boolean; toRoles: readonly string[]; toUserId: string | null }): string {
  if (m.toUserId) return "Особисто";
  if (m.toAll) return "Усі";
  return m.toRoles.filter(isGroupRole).map((r) => GROUP_LABEL[r]).join(", ");
}

/** Розділ сайту, у якому людина відкриває чат: /sales, /driver, /warehouse, /admin. */
export function sectionFor(role: string): string {
  return defaultTargetFor(role);
}

/** Адреса розмови в кабінеті цієї ролі — для пуша й посилань. */
export function chatPathFor(role: string, key: string): string {
  return `${sectionFor(role)}/chat/${key}`;
}
