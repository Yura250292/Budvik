/**
 * Скільки чисел у відповідях моделі не знайшлося в даних.
 *
 * Лічильник, а не окрема таблиця: питання тут одне — «чи вигадує вона
 * взагалі, і як часто», — і відповідь на нього дають чотири числа на
 * день. Заводити під це таблицю з рядком на кожну відповідь означало б
 * зберігати назавжди те, що читають раз на тиждень.
 *
 * Живе в SyncState поруч із рештою службового стану обміну. Зберігаємо
 * два тижні: довша історія цікава лише тоді, коли щось зламали, а тоді
 * дивляться в журнал, а не в лічильник.
 */

import { prisma } from "@/lib/prisma";
import type { NumberCheck } from "@/lib/assistant/guards";

const STATE_KEY = "assistant:numberGuard";
const KEEP_DAYS = 14;

export type GuardDay = {
  /** Скільки відповідей моделі перевірено. */
  answers: number;
  /** Скільки чисел у них звірено з даними. */
  checked: number;
  /** Скільки не знайшлося. */
  unverified: number;
  /** Приклади — щоб було з чим іти в журнал. */
  samples: number[];
};

export type GuardLog = Record<string, GuardDay>;

export async function recordNumberCheck(day: string, check: NumberCheck): Promise<void> {
  try {
    const log = await readLog();
    const acc = log[day] ?? { answers: 0, checked: 0, unverified: 0, samples: [] };

    acc.answers += 1;
    acc.checked += check.checked;
    acc.unverified += check.unverified.length;
    if (check.unverified.length > 0 && acc.samples.length < 10) {
      acc.samples.push(...check.unverified.slice(0, 3));
    }
    log[day] = acc;

    for (const key of Object.keys(log)) {
      if (Object.keys(log).length <= KEEP_DAYS) break;
      if (key < day) delete log[key];
    }

    const value = JSON.stringify(log);
    await prisma.syncState.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value },
      update: { value },
    });
  } catch {
    // Лічильник не має права зламати відповідь: він про якість, а не про роботу.
  }
}

export async function readLog(): Promise<GuardLog> {
  const row = await prisma.syncState.findUnique({ where: { key: STATE_KEY } });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as GuardLog;
  } catch {
    return {};
  }
}
