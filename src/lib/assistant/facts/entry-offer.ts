/**
 * З чим заходити до клієнта: гачок, причіп і що розпрацювати.
 *
 * Так працює жива торгівля будматеріалами, і саме цього бракувало в
 * цифрах. Торговий заходить у магазин не з генератором за 40 тисяч, а з
 * піною, дротом чи кругами: маржа на них копійчана, зате беруть їх усі й
 * постійно, і саме вони дають привід зайти й солодку ціну, від якої не
 * відмовляються. Заробіток — не на гачку, а на тому, що їде поруч, і на
 * тому, що клієнт після цього починає брати ширше.
 *
 * Три частини відповіді:
 *   ГАЧОК       — розхідник, який бере вся база; або те, що клієнт і сам
 *                 бере регулярно й у нього саме зараз закінчується.
 *   ПРИЧІП      — те, що статистично їде в одній накладній із гачком, має
 *                 нормальну маржу, є на складі, і чого клієнт давно не брав.
 *   РОЗПРАЦЮВАТИ— мертвий залишок того ж бренду: якщо вже говоримо про
 *                 цей бренд, є нагода зрушити те, що лежить.
 *
 * Ціни. Гачок дають дешево навмисно, але не нижче собівартості: у
 * відповіді є «ціна_підлога» = остання собівартість + 5%. Підлога — це
 * оцінка (собівартість з останньої реалізації), тож остаточну знижку
 * однаково затверджує керівник, і модель зобов'язана це сказати.
 */

import { prisma } from "@/lib/prisma";
import {
  ATTACH_MIN_LIFT,
  ATTACH_MIN_TOGETHER,
  ATTACH_NOT_BOUGHT_DAYS,
  ATTACH_PER_HOOK,
  CONSUMABLE_NAME_RE,
  CONSUMABLE_SECTIONS,
  CONSUMABLE_TYPE_KEYS,
  DEAD_STOCK_DAYS,
  HOOK_MIN_CLIENTS,
  HOOK_MIN_MARGIN,
  HOOK_PEER_MIN,
  HOOK_WINDOW_DAYS,
  OVERDUE_HOOK_MIN,
} from "@/lib/assistant/config";
import {
  marginPct,
  percentile,
  priceMarginPct,
  productStats,
  type ProductStat,
} from "@/lib/assistant/facts/product-stats";
import { deadStockItems } from "@/lib/assistant/facts/product-facts";
import { myClientsCte } from "@/lib/assistant/facts/sql";
import { clientProductRhythm, days as daysWord, times as timesWord } from "@/lib/analytics/clientOrder";
import { agingByCounterparty } from "@/lib/analytics/money-facts";
import { payerVerdicts, verdictLabel } from "@/lib/assistant/facts/discipline-cache";
import { pct, uah } from "@/lib/assistant/format";

/** Чи це розхідник — за класифікатором, розділом або назвою. */
export function isConsumable(p: {
  typeKey: string | null;
  sectionId: string | null;
  name: string;
}): boolean {
  if (p.typeKey && (CONSUMABLE_TYPE_KEYS as readonly string[]).includes(p.typeKey)) return true;
  if (p.sectionId && (CONSUMABLE_SECTIONS as readonly string[]).includes(p.sectionId)) return true;
  return CONSUMABLE_NAME_RE.test(p.name);
}

/** Підлога ціни: нижче неї «солодка ціна» стає збитком. */
export function priceFloor(lastCost: number | null): number | null {
  if (!lastCost || lastCost <= 0) return null;
  return Math.ceil(lastCost * (1 + HOOK_MIN_MARGIN) * 100) / 100;
}

type PairRow = {
  hook: string;
  attach: string;
  together: number;
  hookDocs: number;
  attachDocs: number;
  totalDocs: number;
};

export async function entryOffer(counterpartyId: string, repId: string, maxHooks = 4) {
  const client = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true, name: true },
  });
  if (!client) return null;

  const stats = await productStats();
  const byId = new Map(stats.map((s) => [s.productId, s]));

  // Пороги маржі рахуються серед МАСОВИХ товарів: у рідкісних позицій
  // маржа стрибає від однієї накладної, і нижня третина заповнилася б
  // випадковими рядками.
  const mass = stats.filter((s) => s.clients >= HOOK_MIN_CLIENTS && marginPct(s) != null);
  const margins = mass.map((s) => marginPct(s)!);
  const p33 = percentile(margins, 0.33);
  const medMargin = percentile(margins, 0.5);

  const hookPool = stats.filter((s) => {
    if (s.free <= 0 || s.price <= 0) return false;
    if (s.clients < HOOK_MIN_CLIENTS) return false;
    const m = marginPct(s);
    return isConsumable(s) || (m != null && m <= p33);
  });
  const hookIds = hookPool.map((s) => s.productId);
  const hookSet = new Set(hookIds);

  const [rhythm, peers, boughtRecently, boughtInWindow, aging, discipline] = await Promise.all([
    clientProductRhythm(counterpartyId),
    peerHooks(counterpartyId, repId, hookIds),
    clientBoughtSince(counterpartyId, ATTACH_NOT_BOUGHT_DAYS),
    clientBoughtSince(counterpartyId, HOOK_WINDOW_DAYS),
    agingByCounterparty([counterpartyId]),
    payerVerdicts(),
  ]);

  /* ── Гачки, які клієнт бере й сам ─────────────────────────────────── */
  type Candidate = {
    stat: ProductStat;
    reason: string;
    urgency: number;
    weight: number;
  };

  const own: Candidate[] = [];
  for (const r of rhythm) {
    if (!hookSet.has(r.productId) || !r.cycleDays) continue;
    const stat = byId.get(r.productId);
    if (!stat) continue;
    const urgency = r.daysSince / r.cycleDays;
    const since = Math.round(r.daysSince);
    const cycle = Math.round(r.cycleDays);
    own.push({
      stat,
      reason:
        urgency >= OVERDUE_HOOK_MIN
          ? `бере ${timesWord(r.times)}, ~раз на ${daysWord(cycle)}, минуло вже ${daysWord(since)} — пора`
          : `бере ${timesWord(r.times)}, ~раз на ${daysWord(cycle)}, останній раз ${daysWord(since)} тому`,
      urgency: Math.round(urgency * 10) / 10,
      // Розхідник важить більше за таку саму позицію з іншого розділу:
      // саме з ним заходять, а дорогий інструмент — це вже окрема розмова,
      // навіть коли він теж «низькомаржинальний і час міняти».
      weight:
        Math.log1p(Math.max(0, r.amount)) *
        Math.min(urgency, 3) *
        (isConsumable(stat) ? 1.5 : 1),
    });
  }
  own.sort((a, b) => b.weight - a.weight);

  /* ── Гачки, які беруть інші клієнти цього торгового ────────────────── */
  // Відсіюємо за фактом покупки, а не за ритмом: ритм вимагає двох різних
  // днів із покупками, і товар, узятий одного разу, інакше потрапляв би в
  // «цей — ще ні» — просто в очі торговому.
  const fresh: Candidate[] = [];
  for (const p of peers) {
    if (boughtInWindow.has(p.productId)) continue;
    const stat = byId.get(p.productId);
    if (!stat) continue;
    fresh.push({
      stat,
      reason: `беруть ${p.buyers} ваших клієнтів, цей — ще ні`,
      urgency: 0,
      weight: p.buyers,
    });
  }
  fresh.sort((a, b) => b.weight - a.weight);

  // Спершу своє (клієнт це вже бере — розмова коротка), потім нове.
  // Одне місце завжди лишаємо новому: інакше клієнт із багатою історією
  // назавжди застрягає на тому самому асортименті.
  const keepOwn = fresh.length > 0 ? maxHooks - 1 : maxHooks;
  const chosen = [...own.slice(0, keepOwn), ...fresh.slice(0, maxHooks - Math.min(own.length, keepOwn))];

  if (chosen.length === 0) {
    return emptyOffer(client, aging.get(counterpartyId), discipline, counterpartyId);
  }

  const chosenIds = chosen.map((c) => c.stat.productId);
  const [pairs, dead] = await Promise.all([
    basketPairs(chosenIds),
    deadStockItems({ repId, minDays: DEAD_STOCK_DAYS, limit: 200 }),
  ]);

  const attachByHook = new Map<string, Array<{ stat: ProductStat; together: number; share: number }>>();
  for (const row of pairs) {
    const stat = byId.get(row.attach);
    if (!stat || stat.free <= 0 || stat.price <= 0) continue;
    if (boughtRecently.has(row.attach)) continue;
    const m = marginPct(stat);
    if (m == null || m < medMargin) continue;

    const lift = (row.together * row.totalDocs) / (row.hookDocs * row.attachDocs);
    if (lift < ATTACH_MIN_LIFT) continue;

    const list = attachByHook.get(row.hook) ?? [];
    list.push({ stat, together: row.together, share: (row.together / row.hookDocs) * 100 });
    attachByHook.set(row.hook, list);
  }

  const debt = aging.get(counterpartyId);

  return {
    клієнт: { клієнт_id: client.id, назва: client.name },
    борг: {
      всього: uah(debt?.debt ?? 0),
      прострочено: uah(debt?.overdue ?? 0),
      вердикт: verdictLabel(discipline.verdicts.get(counterpartyId)) ?? "оцінки немає",
    },
    політика: {
      мін_маржа_гачка_відсотків: Math.round(HOOK_MIN_MARGIN * 100),
      примітка:
        "ціна_підлога = остання собівартість + 5%. Нижче — збиток. Будь-яка ціна нижча за прайс — це пропозиція, остаточну знижку затверджує керівник.",
    },
    гачки: chosen.map((c) => {
      const s = c.stat;
      const attaches = (attachByHook.get(s.productId) ?? [])
        .sort((a, b) => b.together - a.together)
        .slice(0, ATTACH_PER_HOOK);

      return {
        товар_id: s.productId,
        назва: s.name,
        артикул: s.sku,
        бренд: s.brandName,
        // Вид міняє саму розмову: з розхідником заходять («привіз кругів
        // за доброю ціною»), а дорога позиція з низькою маржею — це
        // нагадування «час міняти», і плутати їх не можна.
        вид: isConsumable(s) ? "розхідник" : "постійна позиція з низькою маржею",
        ціна: uah(s.price),
        опт_ціна: s.wholesalePrice ? uah(s.wholesalePrice) : null,
        собівартість: s.lastCost ? Math.round(s.lastCost * 100) / 100 : null,
        маржа_прайсова_відсотків: pct(priceMarginPct(s.price, s.lastCost)),
        // Фактична майже завжди нижча за прайсову — саме тому це й гачок:
        // його вже зараз продають зі знижкою, і різниця між двома числами
        // показує, скільки місця для торгу лишилось до підлоги.
        маржа_фактична_відсотків: marginPct(s) == null ? null : pct(marginPct(s)),
        ціна_підлога: priceFloor(s.lastCost),
        залишок: s.free,
        беруть_клієнтів_180д: s.clients,
        підстава: c.reason,
        терміновість: c.urgency || null,
        причіп: attaches.map((a) => ({
          товар_id: a.stat.productId,
          назва: a.stat.name,
          артикул: a.stat.sku,
          бренд: a.stat.brandName,
          ціна: uah(a.stat.price),
          собівартість: a.stat.lastCost ? Math.round(a.stat.lastCost * 100) / 100 : null,
          маржа_прайсова_відсотків: pct(priceMarginPct(a.stat.price, a.stat.lastCost)),
          маржа_фактична_відсотків:
            marginPct(a.stat) == null ? null : pct(marginPct(a.stat)),
          залишок: a.stat.free,
          підстава: `у ${Math.round(a.share)} % накладних із цим гачком (${a.together} разів)`,
        })),
        розпрацювати: pickDead(dead, s, boughtInWindow).map((d) => ({
          товар_id: d.productId,
          назва: d.name,
          артикул: d.sku,
          залишок: d.free,
          днів_без_продажу: d.lastSale
            ? Math.round((Date.now() - d.lastSale.getTime()) / 86_400_000)
            : null,
          жодного_продажу: d.lastSale ? undefined : true,
          ціна: uah(d.price),
          маржа_прайсова_відсотків: pct(priceMarginPct(d.price, d.lastCost)),
          підстава:
            d.brand && s.brandName && d.brand === s.brandName
              ? `той самий бренд (${d.brand}), лежить без руху`
              : "той самий розділ, лежить без руху",
        })),
      };
    }),
    примітки: [
      "собівартість — з останньої реалізації, це оцінка, а не факт закупівлі",
      `гачок — розхідник або нижня третина за маржею серед товарів, які беруть щонайменше ${HOOK_MIN_CLIENTS} клієнтів за ${HOOK_WINDOW_DAYS} днів`,
      "залишок — вільний, з несервісних складів",
      "маржа_прайсова — від прайсу; маржа_фактична — те, з якою маржею товар реально продавали за 180 днів",
    ],
  };
}

function emptyOffer(
  client: { id: string; name: string },
  debt: { debt: number; overdue: number } | undefined,
  discipline: Awaited<ReturnType<typeof payerVerdicts>>,
  counterpartyId: string
) {
  return {
    клієнт: { клієнт_id: client.id, назва: client.name },
    борг: {
      всього: uah(debt?.debt ?? 0),
      прострочено: uah(debt?.overdue ?? 0),
      вердикт: verdictLabel(discipline.verdicts.get(counterpartyId)) ?? "оцінки немає",
    },
    гачки: [],
    примітки: [
      "гачків не знайшлося: у клієнта немає історії закупівель розхідників, а серед клієнтів торгового немає спільного розхідника з залишком на складі",
    ],
  };
}

/** Мертвий залишок того ж бренду (або хоча б розділу), якого клієнт не брав. */
function pickDead(
  dead: Awaited<ReturnType<typeof deadStockItems>>,
  hook: ProductStat,
  bought: Set<string>
) {
  const sameBrand = dead.filter(
    (d) => d.brand && hook.brandName && d.brand === hook.brandName && !bought.has(d.productId)
  );
  const pool = sameBrand.length
    ? sameBrand
    : dead.filter((d) => d.sectionId && d.sectionId === hook.sectionId && !bought.has(d.productId));
  return pool.slice(0, 2);
}

/** Що клієнт брав за останні N днів — щоб не радити те, що він і так узяв. */
async function clientBoughtSince(counterpartyId: string, days: number): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ productId: string }[]>`
    SELECT DISTINCT i."productId"
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
      AND s."docType" = 'REALIZATION'
      AND s."counterpartyId" = ${counterpartyId}
      AND s."createdAt" >= NOW() - (${days} * INTERVAL '1 day')
  `;
  return new Set(rows.map((r) => r.productId));
}

/**
 * Гачки, які беруть ІНШІ клієнти цього торгового.
 *
 * Портфель, а не вся компанія: у торгового своя географія й свій тип
 * точок, і «беруть у Львові» нічого не каже про магазин у Бродах.
 */
async function peerHooks(
  counterpartyId: string,
  repId: string,
  hookIds: string[]
): Promise<Array<{ productId: string; buyers: number }>> {
  if (hookIds.length === 0) return [];

  return prisma.$queryRaw<Array<{ productId: string; buyers: number }>>`
    WITH ${myClientsCte(repId)}
    SELECT i."productId", COUNT(DISTINCT s."counterpartyId")::int AS buyers
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
      AND s."docType" = 'REALIZATION'
      AND s."counterpartyId" IN (SELECT id FROM my_clients)
      AND s."counterpartyId" <> ${counterpartyId}
      AND s."createdAt" >= NOW() - (${HOOK_WINDOW_DAYS} * INTERVAL '1 day')
      AND i."productId" = ANY(${hookIds}::text[])
    GROUP BY 1
    HAVING COUNT(DISTINCT s."counterpartyId") >= ${HOOK_PEER_MIN}
    ORDER BY buyers DESC
    LIMIT 40
  `;
}

/**
 * Що їде в одній накладній із гачком.
 *
 * Ті самі пороги, що в basket.ts (5 спільних накладних, lift 1.5), але
 * запит вужчий: самоз'єднання по всьому асортименту тут не потрібне —
 * питання завжди про конкретні кілька гачків.
 *
 * Експортована, бо тим самим запитом відповідається й «що беруть разом із
 * цим товаром» — питання не про клієнта, а про сам товар.
 */
export async function basketPairs(hookIds: string[]): Promise<PairRow[]> {
  if (hookIds.length === 0) return [];

  return prisma.$queryRaw<PairRow[]>`
    WITH doc_items AS (
      SELECT DISTINCT s.id AS doc, i."productId" AS pid
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."createdAt" >= NOW() - (${HOOK_WINDOW_DAYS} * INTERVAL '1 day')
    ),
    total AS (SELECT COUNT(DISTINCT doc)::int AS n FROM doc_items),
    product_docs AS (SELECT pid, COUNT(*)::int AS docs FROM doc_items GROUP BY pid),
    pairs AS (
      SELECT a.pid AS hook, b.pid AS attach, COUNT(*)::int AS together
      FROM doc_items a
      JOIN doc_items b ON b.doc = a.doc AND b.pid <> a.pid
      WHERE a.pid = ANY(${hookIds}::text[])
      GROUP BY 1, 2
      HAVING COUNT(*) >= ${ATTACH_MIN_TOGETHER}
    )
    SELECT pr.hook, pr.attach, pr.together,
           da.docs AS "hookDocs", db.docs AS "attachDocs", t.n AS "totalDocs"
    FROM pairs pr
    JOIN product_docs da ON da.pid = pr.hook
    JOIN product_docs db ON db.pid = pr.attach
    CROSS JOIN total t
  `;
}
