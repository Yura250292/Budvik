/**
 * Прибирання за обміном: журнали не мусять рости вічно.
 *
 * Обмін пише три журнали, і жоден із них досі не мав терміну життя. Заміряно
 * 08.09.2026: `SyncBatch` — 184 тис. рядків і 40 МБ, накопичені за місяць по
 * шість тисяч на добу; `SyncDiscrepancy` — 214 тис. рядків і 89 МБ, із них
 * 196 тис. уже розв'язані; `SyncJob` — з березня. Усе це щодня потрапляє в
 * бекап і сидить у сторінковому кеші бази, тобто коштує грошей рівно за те,
 * що його ніхто не читає.
 *
 * Що лишається:
 * - `SyncBatch` — 3 дні. Це технічний слід «який батч уже приймали». Читають
 *   його рівно в одному місці (`channelDelivered`) і рівно по `runId` поточного
 *   прогону, а прогін живе секунди; більше ніде історія батчів не потрібна.
 *   Спершу тут стояло 30 днів — і це не працювало взагалі: при прирості 6 500
 *   рядків на добу за тридцять днів набігає рівно стільки ж, скільки вже є,
 *   тож таблиця вічно тримала б 190 тисяч рядків і 42 МБ. Три доби лишають
 *   близько 19 тисяч рядків і 4 МБ, і це все ще з великим запасом на повтори
 *   агента після обриву звʼязку.
 * - розв'язані `SyncDiscrepancy` — 30 днів. Нерозв'язані не чіпаємо НІКОЛИ:
 *   це список того, що людина ще має подивитись.
 * - `SyncJob` — 90 днів, і тільки ті, за якими не висить нерозв'язаних
 *   розбіжностей (видалення прогону зносить їх каскадом).
 *
 * Чому чанками: одна `DELETE` на двісті тисяч рядків — це довга транзакція і
 * купа WAL за раз. Тисяча за крок робить те саме непомітно для обміну, який
 * тим часом пише в ті самі таблиці.
 *
 * Файл навмисно без жодного імпорту з `next/*` — його виконує воркер.
 */

import { prisma } from "@/lib/prisma";

/** Скільки днів тримаємо кожен журнал. */
const BATCH_DAYS = 3;
const RESOLVED_DISCREPANCY_DAYS = 30;
const JOB_DAYS = 90;

/** Рядків за крок і скільки кроків максимум — щоб прибирання не йшло годинами. */
const CHUNK = 1_000;
const MAX_CHUNKS = 500;

export type PruneResult = {
  batches: number;
  discrepancies: number;
  jobs: number;
};

/** Видаляє чанками, поки є що видаляти або поки не вичерпаємо ліміт кроків. */
async function deleteInChunks(run: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    const removed = await run();
    total += removed;
    if (removed < CHUNK) break;
  }
  return total;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600_000);
}

/**
 * Одне прибирання. Повертає, скільки чого прибрано — воркер це запише в журнал.
 *
 * Порядок важливий: спершу розбіжності, потім прогони. Інакше каскад від
 * прогонів зніс би частину розбіжностей раніше, ніж ми їх порахуємо, і
 * цифри у звіті брехали б.
 */
export async function pruneSyncJournals(): Promise<PruneResult> {
  const batches = await deleteInChunks(async () =>
    prisma.$executeRaw`
      DELETE FROM "SyncBatch"
      WHERE id IN (
        SELECT id FROM "SyncBatch"
        WHERE "createdAt" < ${daysAgo(BATCH_DAYS)}
        LIMIT ${CHUNK}
      )`
  );

  const discrepancies = await deleteInChunks(async () =>
    prisma.$executeRaw`
      DELETE FROM "SyncDiscrepancy"
      WHERE id IN (
        SELECT id FROM "SyncDiscrepancy"
        WHERE resolved AND "createdAt" < ${daysAgo(RESOLVED_DISCREPANCY_DAYS)}
        LIMIT ${CHUNK}
      )`
  );

  const jobs = await deleteInChunks(async () =>
    prisma.$executeRaw`
      DELETE FROM "SyncJob"
      WHERE id IN (
        SELECT j.id FROM "SyncJob" j
        WHERE j."createdAt" < ${daysAgo(JOB_DAYS)}
          AND NOT EXISTS (
            SELECT 1 FROM "SyncDiscrepancy" d
            WHERE d."syncJobId" = j.id AND NOT d.resolved
          )
        LIMIT ${CHUNK}
      )`
  );

  return { batches, discrepancies, jobs };
}
