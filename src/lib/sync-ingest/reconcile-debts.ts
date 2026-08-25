/**
 * Звірка дебіторки: борг, закритий у 1С, має зникнути й на сайті.
 *
 * Канал `debt` читає регістр взаєморозрахунків, а віртуальна таблиця
 * `Остатки` віддає ЛИШЕ ненульові сальдо (агент ще й відсіює копійчаний
 * пил, extract.ps1). Тому клієнт, який розрахувався повністю, не приходить
 * із нулем — він просто зникає з вивантаження. `applyDebts` оновлює тільки
 * тих, кого приніс батч, тож без цієї звірки останнє ненульове сальдо
 * лишалося б у базі назавжди: 25.08.2026 1С слала 434 рядки, а на сайті
 * висіло 540 контрагентів із боргом — понад сотня торгових бачили гроші,
 * які клієнт давно віддав.
 *
 * Ознака «є в 1С» — свіжість `balanceSyncedAt`: її проставляє один запит на
 * початку кожного батча боргів (і лише він, інших авторів у коді немає).
 * Усе, що старше за початок цього прогону, у зрізі 1С відсутнє.
 *
 * Робити це на боці агента (`fullSnapshotIds`, як для товарів) було б
 * природніше, але вимагало б викладки PowerShell на сервер 1С через RDP.
 * Сайт має для звірки всі дані, і працює вона однаково для обох шляхів —
 * воркера на Railway і запасних маршрутів Vercel.
 */

import { prisma } from "@/lib/prisma";
import { ApplyContext } from "./context";
import { alertDebtReconcileSkipped } from "./alerts";
import { channelDelivered, CLOCK_SKEW_GUARD_MS } from "./stale";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";

/**
 * Скільки контрагентів обнулити за раз — і в абсолюті, і часткою зрізу.
 *
 * Обидва пороги охороняють від обірваного вивантаження: якщо 1С віддала
 * половину регістру, «зниклими» виглядатиме друга половина, і звірка
 * стерла б живий борг усім одразу. Разова чистка накопиченого (близько
 * сотні записів на 25.08) в обидва пороги вкладається, а масове зникнення —
 * ні, і воно приїде в Telegram замість того, щоб тихо застосуватись.
 */
const STALE_ABSOLUTE_LIMIT = 200;
const STALE_RATIO_LIMIT = 0.5;

/** Копійчаний пил не вважаємо боргом — той самий поріг, що в агента. */
const DUST = 0.01;


const CHUNK = 500;

/**
 * Обнуляє сальдо контрагентів, яких немає в зрізі боргів цього прогону.
 *
 * Повертає кількість обнулених. Викликається із закриття прогону; помилку
 * ловить викликач — звірка не має права завалити завершення обміну.
 */
export async function reconcileDebts(ctx: ApplyContext): Promise<number> {
  // Канал боргів іде через тротл (раз на годину), тому throttled: true —
  // без цього звірка спрацювала б на прогоні, який борги навіть не чіпав.
  const delivered = await channelDelivered(ctx, "debt", { throttled: true });
  if (!delivered) return 0;

  const { seen, firstBatchAt } = delivered;
  const cutoff = new Date(firstBatchAt.getTime() - CLOCK_SKEW_GUARD_MS);

  // Від'ємні сальдо (аванси клієнтів, борг постачальникам) зникають із
  // регістру після взаємозаліку так само, як додатні, — і так само мусять
  // обнулятись: їх показує розділ авансів у бухзвіті.
  const stale = await prisma.counterparty.findMany({
    where: {
      externalId: { not: null },
      OR: [{ receivableBalance: { gte: DUST } }, { receivableBalance: { lte: -DUST } }],
      // Контрагенти без мітки взагалі — теж кандидати: сальдо їм колись
      // проставили, а канал боргів їх відтоді жодного разу не бачив.
      AND: [{ OR: [{ balanceSyncedAt: null }, { balanceSyncedAt: { lt: cutoff } }] }],
    },
    select: { id: true, code: true, externalId: true, name: true, receivableBalance: true },
  });

  if (stale.length === 0) return 0;

  if (stale.length > STALE_ABSOLUTE_LIMIT || stale.length > STALE_RATIO_LIMIT * (stale.length + seen)) {
    console.error(
      `sync-ingest: звірку боргів пропущено — забагато зниклих (${stale.length} проти ${seen} у зрізі)`
    );
    await alertDebtReconcileSkipped(ctx.runId, stale.length, seen);
    return 0;
  }

  const ids = stale.map((c) => c.id);
  const day = kyivDayStart(kyivDate(new Date()));

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);

    await prisma.counterparty.updateMany({
      where: { id: { in: slice } },
      data: {
        receivableBalance: 0,
        balanceSyncedAt: new Date(),
        debtCurrent: null,
        debtOverdue30: null,
        debtOverdue60: null,
        debtOverdue90: null,
        debtOverdue90Plus: null,
      },
    });

    // Нульовий знімок обов'язковий: приріст боргу за період рахується як
    // різниця двох знімків із протягуванням останнього вперед. Без нуля
    // старе сальдо тягнулося б у звіти й далі, вже після обнулення.
    await prisma.debtSnapshot.createMany({
      data: slice.map((counterpartyId) => ({ counterpartyId, day, balance: 0 })),
      skipDuplicates: true,
    });
    await prisma.debtSnapshot.updateMany({
      where: { counterpartyId: { in: slice }, day },
      data: {
        balance: 0,
        current: null,
        overdue30: null,
        overdue60: null,
        overdue90: null,
        overdue90Plus: null,
      },
    });
  }

  // Слід у журналі розбіжностей: видно, кому й коли закрили борг, і на яку
  // суму. Мовчазне обнулення чужих грошей — не те, що можна залишити без
  // сліду, надто коли на дебіторці зав'язана мотивація торгових.
  for (const cp of stale) {
    ctx.discrepancy({
      entityType: "counterparty",
      entityRef: cp.code || cp.externalId!,
      entityName: cp.name,
      field: "receivableBalance",
      value1C: "0.00",
      valueBudvik: (cp.receivableBalance ?? 0).toFixed(2),
    });
  }

  ctx.updated += stale.length;
  return stale.length;
}
