/**
 * Чи доходять фонові події від системи до застосунку.
 *
 * Навіщо окремий шар. Є стан, у якому брешуть геть усі поля пульсу: служба в
 * передньому плані, дозвіл «Завжди», приймач дає фікси, застосунок вважає, що
 * пише, — а трек не пишеться тижнями. Диспетчер фонових завдань expo віддає
 * події екземпляру модуля, на який JS не підписаний (у процесі їх може бути
 * кілька), і вони назавжди лягають у його чергу в пам'яті.
 *
 * Доказ — рівно два лічильники нативного маяка поруч: скільки подій диспетчер
 * віддав і скільки з них JS закрив. 17–22.09.2026 у планшета Передрія вони
 * стояли на 8619 і 0, і жоден інший показник цього не показував.
 *
 * Лічильники шле track-guard із будильника, без участі JS, тож вони є й тоді,
 * коли сам застосунок мовчить. Читають це три поверхні — пульт, карта й сигнал
 * у Telegram, — тому розбір лежить тут, а не в одній із них.
 */

import { prisma } from "@/lib/prisma";
import { mainDispatchApp, modules, type NativeBeaconBody } from "@/lib/track/native-diag";

export type DispatchView = {
  at: string;
  minutesAgo: number;
  /** Подій віддано контексту JS за життя процесу. */
  direct: number;
  /** Скільки з них JS закрив. Нуль при ненульовому `direct` — події в порожнечу. */
  finished: number;
  /** Живих екземплярів модуля / з них слухає JS. Лише з APK 1.6.7, інакше null. */
  modules: { live: number; observed: number } | null;
  deaf: boolean;
};

/**
 * Скільки відданих подій робить нуль закритих доказом.
 *
 * Наш патч утримання лишає ПЕРШУ подію кожного контексту незакритою назавжди
 * (інакше диспетчер стирає реєстрацію живого контексту), тож здоровий процес
 * відстає щонайбільше на дві події. П'ять відданих при нулі закритих не бувають.
 */
const DEAF_DIRECT_MIN = 5;

const minutesSince = (d: Date, now: number) => Math.max(0, Math.round((now - d.getTime()) / 60_000));

/** Ключ, під яким лежить останній нативний знімок планшета. */
export const nativeKey = (userId: string) => `app:staff:native:${userId}`;

export function readDispatch(
  value: string | null | undefined,
  at: Date | null | undefined,
  now: number
): DispatchView | null {
  if (!value || !at) return null;
  try {
    const body = JSON.parse(value) as NativeBeaconBody;
    const ts = body.snapshot?.taskService;
    if (!ts || typeof ts !== "object") return null;
    const direct = ts.execDirect ?? 0;
    const finished = ts.finished ?? 0;
    const list = modules(ts);
    const app = mainDispatchApp(ts);
    return {
      at: at.toISOString(),
      minutesAgo: minutesSince(at, now),
      direct,
      finished,
      modules: list.length
        ? { live: list.length, observed: list.filter((m) => m.observed).length }
        : null,
      /**
       * `activeObserved` каже це прямо (APK 1.6.7+); на старших збірках
       * лишаються лічильники, і вони теж не залишають місця для тлумачень.
       */
      deaf: app?.activeObserved === false || (direct >= DEAF_DIRECT_MIN && finished === 0),
    };
  } catch {
    // Знімок пошкоджений — решта діагностики від нього не залежить.
    return null;
  }
}

/** Стан диспетчера на кожного з названих планшетів, одним запитом. */
export async function loadDispatch(
  userIds: string[],
  now = Date.now()
): Promise<Map<string, DispatchView>> {
  const out = new Map<string, DispatchView>();
  if (userIds.length === 0) return out;
  const rows = await prisma.syncState.findMany({
    where: { key: { in: userIds.map(nativeKey) } },
    select: { key: true, value: true, updatedAt: true },
  });
  for (const row of rows) {
    const view = readDispatch(row.value, row.updatedAt, now);
    if (view) out.set(row.key.replace("app:staff:native:", ""), view);
  }
  return out;
}
