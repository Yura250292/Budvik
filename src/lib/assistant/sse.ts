/**
 * Події ходу в форматі server-sent events.
 *
 * Перший стрім у цьому репозиторії, тому кодування тримаємо тут, а не
 * розмазуємо по роуту: додати нову подію має бути одним рядком у типі
 * TurnEvent, а не правкою в трьох місцях.
 */

import type { TurnEvent } from "@/lib/assistant/types";

const encoder = new TextEncoder();

export function encodeEvent(event: TurnEvent): Uint8Array {
  return encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

/**
 * Коментар-пульс.
 *
 * Поки працюють інструменти, у потік не йде жодного байта, і проміжний
 * проксі може вирішити, що з'єднання мертве. Рядок, що починається з
 * двокрапки, — коментар SSE: клієнт його ігнорує, а з'єднання живе.
 */
export function keepAlive(): Uint8Array {
  return encoder.encode(": ping\n\n");
}
