/**
 * Що торговий вимкнув у стрічці — і що взагалі можна вимкнути.
 *
 * Чистий модуль: його читає і воркер (щоб не слати), і сторінка профілю
 * (щоб намалювати перемикачі). Джерело правди — `User.notificationPrefs`,
 * JSON виду `{ mutedTypes: ["REP_PAYMENT"] }`; NULL означає «усе ввімкнено».
 *
 * Вимкнена категорія не зникає зі стрічки на головній — зникає лише пуш.
 * Людина, яка вимкнула «оплати», все одно побачить їх, зайшовши сама.
 */

import { REP_FEED_TYPES, type RepFeedType } from "./types";

export type PushCategory = {
  type: RepFeedType;
  label: string;
  hint: string;
};

/** Порядок — той, у якому перемикачі стоять у профілі. */
export const PUSH_CATEGORIES: readonly PushCategory[] = [
  { type: REP_FEED_TYPES.PAYMENT, label: "Оплати клієнтів", hint: "«Химич заплатив 8 400 ₴»" },
  { type: REP_FEED_TYPES.DOC_POSTED, label: "Проведені накладні", hint: "офіс провів накладну за вашим замовленням" },
  { type: REP_FEED_TYPES.DOC_PICKED, label: "Зібрані накладні", hint: "склад зібрав накладну повністю" },
  { type: REP_FEED_TYPES.DOC_DELIVERED, label: "Доставлено", hint: "водій відмітив доставку" },
  { type: REP_FEED_TYPES.RETURN, label: "Повернення", hint: "проведено повернення від вашого клієнта" },
  { type: REP_FEED_TYPES.VISIT, label: "Картка перед візитом", hint: "коли машина зупинилась біля клієнта: борг і що поповнити" },
  { type: REP_FEED_TYPES.CALL_LIST, label: "Кому подзвонити", hint: "щодня об 11:00, до п'яти клієнтів" },
];

const KNOWN = new Set<string>(PUSH_CATEGORIES.map((c) => c.type));

export type PushPrefs = { mutedTypes: RepFeedType[] };

/** Розібрати JSON із бази або тіло запиту; невідоме мовчки відкидається. */
export function parsePushPrefs(raw: unknown): PushPrefs {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { mutedTypes?: unknown }).mutedTypes)
      ? ((raw as { mutedTypes: unknown[] }).mutedTypes as unknown[])
      : [];
  const muted = new Set<RepFeedType>();
  for (const item of list) {
    if (typeof item === "string" && KNOWN.has(item)) muted.add(item as RepFeedType);
  }
  return { mutedTypes: [...muted] };
}

export function isPushMuted(prefs: PushPrefs | null | undefined, type: RepFeedType): boolean {
  return prefs?.mutedTypes.includes(type) ?? false;
}
