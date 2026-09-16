/**
 * Які 2–3 товари покласти в пропозицію.
 *
 * Не новий рушій порад: джерела вже є і перевірені на картці клієнта —
 * recommendations() (поповнення, «перестав брати», «беруть схожі клієнти») і
 * entryOffer() помічника. Тут лише вибір під вид пропозиції й три речі, яких
 * там немає:
 *
 *  1. Ціна — оптова (Product.wholesalePrice, тип цін 1С «4.ОПТ»).
 *     recommendations() віддає ціну вітрини з націнкою, а клієнт 1С платить
 *     опт. Назвати йому роздріб — пообіцяти подорожчання.
 *  2. Вільний залишок і службові категорії перевіряються ще раз уже по
 *     фінальному списку: порада могла порахуватися з кешу хвилину тому, а
 *     мерч (стенди, сувенірка) клієнту не продається взагалі.
 *  3. Чи брав клієнт кожен товар. Від цього залежить, чи може текст сказати
 *     «те, що ви у нас брали» (див. ownershipOf у templates.ts).
 */

import { prisma } from "@/lib/prisma";
import { FREE_STOCK, days, recommendations, times, type RecoReason } from "@/lib/analytics/clientOrder";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { entryOffer } from "@/lib/assistant/facts/entry-offer";
import { isHiddenCategory } from "@/lib/catalog/category-display";
import type { OfferProduct, OutreachKind } from "./types";

export const MAX_OFFER_PRODUCTS = 3;

/** «Приїхало» — прихід за тиждень: давніший уже не новина. */
export const ARRIVAL_DAYS = 7;
/** «Він це бере» — покупки за пів року, як у стрічці приходу (arrivals.ts). */
const BUYER_WINDOW_DAYS = 180;
const DAY_MS = 86_400_000;

/** Кандидат до перевірки залишку: id або (для порад по бренду) артикул і назва. */
export type OfferCandidate = {
  productId?: string;
  sku?: string | null;
  name?: string;
  why: string;
};

/** Товар пропозиції плюс те, чи клієнт його вже купував. */
export type PickedProduct = OfferProduct & { boughtBefore: boolean };

function dayMonth(d: Date): string {
  return d.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit" });
}

/**
 * Прихід за тиждень, який цей клієнт брав за пів року.
 *
 * Той самий зміст, що arrivalsForRep, але від клієнта, а не від торгового:
 * там запит проходить увесь портфель і все, що приїхало, — для однієї картки
 * це в десятки разів більше роботи, ніж треба. Починаємо з покупок одного
 * клієнта: їх сотні рядків, а не сотні тисяч.
 */
export async function arrivalCandidates(counterpartyId: string, now: Date = new Date()): Promise<OfferCandidate[]> {
  const since = new Date(now.getTime() - ARRIVAL_DAYS * DAY_MS);
  const buyersSince = new Date(now.getTime() - BUYER_WINDOW_DAYS * DAY_MS);

  const rows = await prisma.$queryRaw<
    Array<{ productId: string; qty: number; arrivedAt: Date; lastAt: Date; docs: number }>
  >`
    WITH bought AS (
      SELECT i."productId", MAX(s."createdAt") AS "lastAt", COUNT(DISTINCT s.id)::int AS docs
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE ${SOURCE_FILTER}
        AND s."docType" = 'REALIZATION'
        AND s."counterpartyId" = ${counterpartyId}
        AND s."createdAt" >= ${buyersSince}
      GROUP BY 1
    ),
    arrived AS (
      SELECT poi."productId", SUM(poi.quantity)::int AS qty,
             MAX(COALESCE(po."confirmedAt", po."createdAt")) AS "arrivedAt"
      FROM "PurchaseOrderItem" poi
      JOIN "PurchaseOrder" po ON po.id = poi."purchaseOrderId"
      WHERE po.status = 'CONFIRMED'
        AND po."externalId" IS NOT NULL
        AND COALESCE(po."confirmedAt", po."createdAt") >= ${since}
        AND poi."productId" IN (SELECT "productId" FROM bought)
      GROUP BY 1
    )
    SELECT a."productId", a.qty, a."arrivedAt", b."lastAt", b.docs
    FROM arrived a
    JOIN bought b ON b."productId" = a."productId"
    ORDER BY b.docs DESC, b."lastAt" DESC
    LIMIT 20
  `;

  return rows.map((r) => ({
    productId: r.productId,
    why: `приїхало ${dayMonth(r.arrivedAt)} (${r.qty} шт); брав ${times(r.docs)} за пів року, востаннє ${days(
      Math.max(0, Math.floor((now.getTime() - r.lastAt.getTime()) / DAY_MS))
    )} тому`,
  }));
}

/** Поради з картки клієнта в потрібному порядку причин. */
async function recoCandidates(counterpartyId: string, order: RecoReason[]): Promise<OfferCandidate[]> {
  const recos = await recommendations(counterpartyId);
  const rank = (r: RecoReason) => {
    const i = order.indexOf(r);
    return i < 0 ? order.length : i;
  };
  // sort стабільний: усередині причини лишається порядок за вагою з recommendations().
  return recos
    .filter((r) => order.includes(r.reason))
    .sort((a, b) => rank(a.reason) - rank(b.reason))
    .map((r) => ({
      // Порада «беруть схожі клієнти» має ключ бренду, а не товару, — id
      // товару з неї не дістати, лише артикул і назву.
      productId: r.key.startsWith("product:") ? r.key.slice("product:".length) : undefined,
      sku: r.sku,
      name: r.name,
      why: r.why,
    }));
}

/**
 * Гачки помічника — лише коли інших джерел немає.
 *
 * entryOffer рахує статистику по всьому асортименту (секунди), тож кликати
 * його на кожне відкриття картки не можна. Але клієнту без повторних покупок
 * інакше нічого запропонувати: recommendations() без двох однакових покупок
 * мовчить.
 */
async function hookCandidates(counterpartyId: string, repId: string): Promise<OfferCandidate[]> {
  const offer = await entryOffer(counterpartyId, repId, 4);
  const hooks = (offer?.гачки ?? []) as Array<{ товар_id: string; підстава: string }>;
  return hooks.map((h) => ({ productId: h.товар_id, why: h.підстава }));
}

/** Артикул/назва → id для порад по бренду. Артикул унікальний, назва — запасний шлях. */
async function resolveIds(candidates: OfferCandidate[]): Promise<OfferCandidate[]> {
  const missing = candidates.filter((c) => !c.productId);
  if (missing.length === 0) return candidates;

  const skus = missing.map((c) => c.sku).filter((s): s is string => !!s);
  const names = missing.filter((c) => !c.sku && c.name).map((c) => c.name!);
  const found = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [...(skus.length ? [{ sku: { in: skus } }] : []), ...(names.length ? [{ name: { in: names } }] : [])],
    },
    select: { id: true, sku: true, name: true },
  });
  const bySku = new Map(found.filter((p) => p.sku).map((p) => [p.sku!, p.id]));
  const byName = new Map(found.map((p) => [p.name, p.id]));

  return candidates.map((c) =>
    c.productId ? c : { ...c, productId: (c.sku && bySku.get(c.sku)) || (c.name && byName.get(c.name)) || undefined }
  );
}

/**
 * Фінальна перевірка й дані для тексту: назва, slug для посилання, опт,
 * вільний залишок і «чи брав» — двома запитами на весь список.
 */
export async function loadOfferProducts(
  counterpartyId: string,
  candidates: OfferCandidate[],
  limit = MAX_OFFER_PRODUCTS
): Promise<PickedProduct[]> {
  const resolved = await resolveIds(candidates);
  const order: Array<{ id: string; why: string }> = [];
  const seen = new Set<string>();
  for (const c of resolved) {
    if (!c.productId || seen.has(c.productId)) continue;
    seen.add(c.productId);
    order.push({ id: c.productId, why: c.why });
  }
  if (order.length === 0) return [];

  const ids = order.map((o) => o.id);
  const [rows, bought] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        sku: string | null;
        slug: string | null;
        wholesalePrice: number | null;
        categoryName: string | null;
        freeStock: number;
      }>
    >`
      SELECT p.id, p.name, p.sku, p.slug, p."wholesalePrice"::float AS "wholesalePrice",
             cat.name AS "categoryName", st.free AS "freeStock"
      FROM "Product" p
      LEFT JOIN "Category" cat ON cat.id = p."categoryId"
      ${FREE_STOCK("p")}
      WHERE p.id = ANY(${ids}::text[]) AND p."isActive"
    `,
    prisma.$queryRaw<Array<{ productId: string }>>`
      SELECT DISTINCT i."productId"
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE ${SOURCE_FILTER}
        AND s."docType" = 'REALIZATION'
        AND s."counterpartyId" = ${counterpartyId}
        AND i."productId" = ANY(${ids}::text[])
    `,
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const boughtIds = new Set(bought.map((b) => b.productId));

  const out: PickedProduct[] = [];
  for (const o of order) {
    const p = byId.get(o.id);
    // Немає на складі — не пропонуємо: торговий пообіцяє, а привезти не зможе.
    if (!p || p.freeStock <= 0 || isHiddenCategory(p.categoryName)) continue;
    out.push({
      id: p.id,
      name: p.name,
      sku: p.sku,
      slug: p.slug,
      wholesalePrice: p.wholesalePrice && p.wholesalePrice > 0 ? p.wholesalePrice : null,
      freeStock: p.freeStock,
      why: o.why,
      boughtBefore: boughtIds.has(p.id),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * До трьох товарів під вид пропозиції.
 *
 * `arrivals` можна передати готовими: compose уже рахує їх, щоб знати, чи
 * доступний вид «Приїхало ваше», і другий такий самий запит нічого не дасть.
 */
export async function pickOfferProducts(
  counterpartyId: string,
  repId: string,
  kind: OutreachKind,
  now: Date = new Date(),
  opts: { arrivals?: OfferCandidate[] } = {}
): Promise<PickedProduct[]> {
  let candidates: OfferCandidate[];
  switch (kind) {
    case "WIN_BACK":
    case "REPLENISH":
      candidates = await recoCandidates(counterpartyId, ["REPLENISH", "DROPPED"]);
      break;
    case "DEVELOP":
      candidates = await recoCandidates(counterpartyId, ["SIMILAR_CLIENTS", "REPLENISH", "DROPPED"]);
      break;
    case "ARRIVALS":
      // Без запасних джерел: «приїхало ваше» з товаром, який не приїжджав, — неправда.
      return loadOfferProducts(counterpartyId, opts.arrivals ?? (await arrivalCandidates(counterpartyId, now)));
    default:
      // Борг, акція, «своїми словами» — без товарів.
      return [];
  }

  const picked = await loadOfferProducts(counterpartyId, candidates);
  if (picked.length > 0) return picked;
  return loadOfferProducts(counterpartyId, await hookCandidates(counterpartyId, repId));
}
