/**
 * Що зробити в календарі, щоб він збігся з бажаним станом.
 *
 * Конектор не слухає зміни в базі, а раз на дві хвилини звіряє вікно
 * найближчих днів: `StaffTask` і `DeliveryRoute` пишуться з десятків місць
 * (роути ERP, планувальник дня, воркер нарад, скрипти), і забуте місце
 * дало б тихий розсинхрон, якого ніхто не помітить місяцями. Звірення ж
 * не можна забути — воно дивиться на результат, а не на подію запису.
 *
 * Дифф — чиста функція: ні бази, ні мережі, ні часу з системи. Саме тому
 * найдорожче місце конектора можна закріпити пробою (scripts/check-calendar-diff.mts).
 *
 * Модуль без next/* — його збирає воркер.
 */

import { contentHash } from "@/lib/calendar/render";
import type { CalendarEntity, DesiredEvent } from "@/lib/calendar/types";

/** Рядок мапінгу «наш запис ↔ подія Google», як він лежить у базі. */
export type LinkRow = {
  entity: CalendarEntity;
  entityId: string;
  googleEventId: string;
  contentHash: string;
  state: string;
  nextAttemptAt: Date | null;
};

export type Action =
  | { kind: "insert"; entity: CalendarEntity; entityId: string; event: DesiredEvent }
  | { kind: "patch"; entity: CalendarEntity; entityId: string; event: DesiredEvent; googleEventId: string }
  | { kind: "delete"; entity: CalendarEntity; entityId: string; googleEventId: string };

const keyOf = (entity: string, entityId: string) => `${entity}:${entityId}`;

/** Рядок чекає на наступну спробу — цього тіку не чіпаємо. */
function backingOff(link: LinkRow, now: Date): boolean {
  return link.nextAttemptAt !== null && link.nextAttemptAt.getTime() > now.getTime();
}

/**
 * Бажаний стан + наявні лінки → перелік дій, не довший за стелю.
 *
 * Прибирання йде першим: подія, якої вже не має бути, — це неправда в
 * календарі людини, і вона шкідливіша за відсутність нової. Стеля тримає
 * перше підключення (коли порожній календар треба наповнити цілком) у
 * межах кількох тіків замість сплеску запитів до Google.
 */
export function planChanges(
  desired: DesiredEvent[],
  links: LinkRow[],
  now: Date,
  cap: number
): Action[] {
  const byKey = new Map(links.map((l) => [keyOf(l.entity, l.entityId), l]));
  const wanted = new Set(desired.map((e) => keyOf(e.entity, e.entityId)));

  const removals: Action[] = [];
  for (const link of links) {
    if (wanted.has(keyOf(link.entity, link.entityId))) continue;
    if (backingOff(link, now)) continue;
    if (!link.googleEventId) continue; // події так і не було — лінк прибере сам рушій
    removals.push({
      kind: "delete",
      entity: link.entity,
      entityId: link.entityId,
      googleEventId: link.googleEventId,
    });
  }

  const writes: Action[] = [];
  for (const event of desired) {
    const link = byKey.get(keyOf(event.entity, event.entityId));
    if (link && backingOff(link, now)) continue;

    if (!link || !link.googleEventId) {
      writes.push({ kind: "insert", entity: event.entity, entityId: event.entityId, event });
      continue;
    }
    if (link.contentHash !== contentHash(event)) {
      writes.push({
        kind: "patch",
        entity: event.entity,
        entityId: event.entityId,
        event,
        googleEventId: link.googleEventId,
      });
    }
  }

  return [...removals, ...writes].slice(0, cap);
}
