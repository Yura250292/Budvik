/**
 * Що торговий вимкнув у стрічці — і що взагалі можна вимкнути.
 *
 * Чистий модуль: його читає і воркер (щоб не слати), і сторінка профілю
 * (щоб намалювати перемикачі). Джерело правди — `User.notificationPrefs`,
 * JSON виду `{ mutedTypes: ["REP_PAYMENT"], othersDocs: false }`; NULL
 * означає «усе ввімкнено, крім чужих накладних».
 *
 * У тому ж JSON живуть поля керівника (`adminTypes`, `feedSeenAt`, див.
 * нижче). Тому писати його лише злиттям (`savePrefs` у prefs-store.ts), а не заміною:
 * інакше збереження одного перемикача стирало б решту.
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
  { type: REP_FEED_TYPES.ROUTE, label: "У маршруті", hint: "накладна потрапила в маршрутний лист: на який день і хто везе" },
  { type: REP_FEED_TYPES.DOC_DELIVERED, label: "Доставлено", hint: "водій відмітив доставку" },
  { type: REP_FEED_TYPES.RETURN, label: "Повернення", hint: "проведено повернення від вашого клієнта" },
  { type: REP_FEED_TYPES.VISIT, label: "Картка перед візитом", hint: "коли машина зупинилась біля клієнта: борг і що поповнити" },
  { type: REP_FEED_TYPES.CALL_LIST, label: "Кому подзвонити", hint: "щодня об 11:00, до п'яти клієнтів" },
  { type: REP_FEED_TYPES.OUTREACH_LIST, label: "Кому написати", hint: "у вівторок о 14:00: до п'яти сплячих клієнтів із мобільним" },
  { type: REP_FEED_TYPES.OUTREACH_RESULT, label: "Пропозиції спрацювали", hint: "клієнт купив протягом 14 днів після вашого повідомлення" },
  { type: REP_FEED_TYPES.ARRIVAL, label: "Прихід товару", hint: "о 10:00, лише те, що беруть ваші клієнти" },
  { type: REP_FEED_TYPES.WATCH, label: "Товар під запит", hint: "приїхало те, на що ви натиснули «Коли буде»" },
  { type: REP_FEED_TYPES.PRICE_UP, label: "Подорожчання", hint: "зранку, від 3%, лише те, що беруть ваші клієнти" },
  { type: REP_FEED_TYPES.REQUEST_DONE, label: "Відповідь на заявку", hint: "офіс виконав або відхилив вашу заявку" },
  { type: REP_FEED_TYPES.TASK, label: "Задачі від офісу", hint: "керівник доручив задачу — з наради або вручну" },
  { type: REP_FEED_TYPES.WEEK, label: "Підсумок тижня", hint: "у п'ятницю: продажі, зібране, місце в команді" },
];

const KNOWN = new Set<string>(PUSH_CATEGORIES.map((c) => c.type));

/**
 * Події про накладну: проведено, зібрано, у маршруті, доставлено, повернення.
 *
 * Пушем про них торговий дізнається лише тоді, коли він сам «Ответственный»
 * документа в 1С, тобто накладну пробивав він. Про накладні свого клієнта,
 * які виписав хтось інший (офіс, колега), — лише рядок у стрічці, поки
 * торговий сам не ввімкне `othersDocs`. Вимога власника 23.09.2026: «пуш
 * кожне проведення — це дуже багато».
 */
export const DOC_EVENT_TYPES: readonly RepFeedType[] = [
  REP_FEED_TYPES.DOC_POSTED,
  REP_FEED_TYPES.DOC_PICKED,
  REP_FEED_TYPES.ROUTE,
  REP_FEED_TYPES.DOC_DELIVERED,
  REP_FEED_TYPES.RETURN,
];

export type PushPrefs = {
  mutedTypes: RepFeedType[];
  /** Пуш і про накладні своїх клієнтів, які пробивав не він. Типово — ні. */
  othersDocs: boolean;
};

function typeList(raw: unknown, key: string): RepFeedType[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>)[key])
      ? ((raw as Record<string, unknown[]>)[key] as unknown[])
      : [];
  const out = new Set<RepFeedType>();
  for (const item of list) {
    if (typeof item === "string" && KNOWN.has(item)) out.add(item as RepFeedType);
  }
  return [...out];
}

/** Розібрати JSON із бази або тіло запиту; невідоме мовчки відкидається. */
export function parsePushPrefs(raw: unknown): PushPrefs {
  const othersDocs =
    !!raw && typeof raw === "object" && (raw as { othersDocs?: unknown }).othersDocs === true;
  return { mutedTypes: typeList(raw, "mutedTypes"), othersDocs };
}

export function isPushMuted(prefs: PushPrefs | null | undefined, type: RepFeedType): boolean {
  return prefs?.mutedTypes.includes(type) ?? false;
}

/**
 * Чи слати торговому пуш про цю подію. `own === false` — накладну пробивав
 * не він (подія знає це з `salesRepId` документа); для решти подій `own`
 * немає, і вирішує лише категорія.
 */
export function wantsPush(
  prefs: PushPrefs | null | undefined,
  event: { type: RepFeedType; own?: boolean }
): boolean {
  if (isPushMuted(prefs, event.type)) return false;
  if (event.own === false && !(prefs?.othersDocs ?? false)) return false;
  return true;
}

// ---- керівник ----

/**
 * Налаштування керівника в тому самому `notificationPrefs`.
 *
 * `adminTypes` — про які події всієї команди слати пуш. Типово порожньо:
 * пушів керівник не отримує, поки сам не вибере (подій сотні на день).
 * `feedSeenAt` — коли він востаннє відкривав «Стрічку подій»; від нього
 * рахується цифра біля пункту меню.
 */
export type AdminFeedPrefs = { adminTypes: RepFeedType[]; feedSeenAt: string | null };

/**
 * Що керівник може отримувати пушем. Не всі категорії торгового: список
 * дзвінків, прихід чи подорожчання рахуються під конкретну людину, і
 * керівникові вони нічого не скажуть.
 */
export const ADMIN_PUSH_CATEGORIES: readonly PushCategory[] = [
  { type: REP_FEED_TYPES.PAYMENT, label: "Оплати клієнтів", hint: "хто з клієнтів заплатив і кому з торгових" },
  { type: REP_FEED_TYPES.DOC_POSTED, label: "Проведені накладні", hint: "офіс провів накладну" },
  { type: REP_FEED_TYPES.DOC_PICKED, label: "Зібрані накладні", hint: "склад зібрав накладну повністю" },
  { type: REP_FEED_TYPES.ROUTE, label: "У маршруті", hint: "накладна потрапила в маршрутний лист" },
  { type: REP_FEED_TYPES.DOC_DELIVERED, label: "Доставлено", hint: "водій відмітив доставку" },
  { type: REP_FEED_TYPES.RETURN, label: "Повернення", hint: "проведено повернення від клієнта" },
  { type: REP_FEED_TYPES.VISIT, label: "Візити", hint: "торговий зупинився біля клієнта" },
  { type: REP_FEED_TYPES.OUTREACH_RESULT, label: "Пропозиції спрацювали", hint: "клієнт купив після повідомлення торгового" },
  { type: REP_FEED_TYPES.WEEK, label: "Підсумок тижня", hint: "у п'ятницю, по кожному торговому" },
];

export function parseAdminFeedPrefs(raw: unknown): AdminFeedPrefs {
  const seen = raw && typeof raw === "object" ? (raw as { feedSeenAt?: unknown }).feedSeenAt : null;
  const feedSeenAt = typeof seen === "string" && !Number.isNaN(new Date(seen).getTime()) ? seen : null;
  return { adminTypes: typeList(raw, "adminTypes"), feedSeenAt };
}
