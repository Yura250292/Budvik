/**
 * Інструменти про товар: знайти, знайти мертве, зібрати пропозицію входу.
 *
 * Скрізь тут «залишок» означає ВІЛЬНИЙ залишок з несервісних складів.
 * Product.stock не використовується взагалі: він застигає, коли позиція
 * зникає з регістра 1С, і обіцяти клієнту такий товар — гірше, ніж не
 * пропонувати нічого.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { bool, id as validId, int, str } from "@/lib/assistant/validate";
import { DEAD_STOCK_DAYS } from "@/lib/assistant/config";
import { deadStockItems, searchProducts } from "@/lib/assistant/facts/product-facts";
import { entryOffer } from "@/lib/assistant/facts/entry-offer";
import { priceMarginPct, productStats } from "@/lib/assistant/facts/product-stats";
import { SECTION_BY_ID } from "@/lib/catalog/classify";
import { pct, uah, ymd } from "@/lib/assistant/format";

const sectionTitle = (id: string | null) => (id ? (SECTION_BY_ID.get(id)?.title ?? id) : null);

export const productSearch: ToolDef = {
  kinds: ["SALES", "DRIVER"],
  name: "product_search",
  label: "Шукаю товар",
  description:
    "Знайти товар за назвою, артикулом або штрихкодом: ціна, оптова ціна, вільний залишок, остання собівартість, маржа, скільки продали за півроку і чи брали його клієнти цього торгового.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Назва, артикул або штрихкод." },
      limit: { type: "integer", description: "Скільки повернути, до 10. За замовчуванням 8." },
    },
    required: ["query"],
  },
  async run(ctx, args) {
    const query = str(args.query, "query", { min: 2, max: 80 });
    const limit = int(args.limit, "limit", { min: 1, max: 10, fallback: 8 });

    const [hits, stats] = await Promise.all([
      searchProducts(query, ctx.scope.repId, limit),
      productStats(),
    ]);
    const statById = new Map(stats.map((s) => [s.productId, s]));

    if (hits.length === 0) return { знайдено: 0, підказка: "нічого не знайшли — спробуйте артикул" };

    return {
      знайдено: hits.length,
      товари: hits.map((h) => {
        const s = statById.get(h.productId);
        return {
          товар_id: h.productId,
          назва: h.name,
          артикул: h.sku,
          бренд: h.brand,
          розділ: sectionTitle(h.sectionId),
          ціна: h.price > 0 ? uah(h.price) : null,
          опт_ціна: h.wholesalePrice ? uah(h.wholesalePrice) : null,
          залишок: h.free,
          собівартість: h.lastCost ? Math.round(h.lastCost * 100) / 100 : null,
          маржа_прайсова_відсотків: pct(priceMarginPct(h.price, h.lastCost)),
          продано_180д: s ? Math.round(s.qty) : 0,
          клієнтів_180д: s?.clients ?? 0,
          моїх_клієнтів_брали: h.myBuyers,
          остання_реалізація: ymd(h.lastSale),
          ...(h.price > 0 ? {} : { увага: "ціни в 1С немає — продати не можна, поки не заведуть" }),
        };
      }),
    };
  },
};

export const deadStock: ToolDef = {
  name: "dead_stock",
  label: "Шукаю мертві залишки",
  description:
    "Товари, які лежать на складі без продажів. Сортування за грошима (залишок × собівартість), тобто спершу те, що варто зусиль. Можна звузити за брендом, розділом і показати лише те, що вже брали клієнти цього торгового.",
  parameters: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Назва бренду або її частина." },
      section: { type: "string", description: "Розділ каталогу: код (osnastka) або назва («Оснастка»)." },
      minDays: { type: "integer", description: "Скільки днів без продажу, 30..999. За замовчуванням 90." },
      boughtByMyClients: {
        type: "boolean",
        description: "true — лише те, що колись брали клієнти цього торгового: з таким заходити легше.",
      },
      limit: { type: "integer", description: "Скільки позицій, до 25. За замовчуванням 12." },
    },
  },
  async run(ctx, args) {
    const minDays = int(args.minDays, "minDays", { min: 30, max: 999, fallback: DEAD_STOCK_DAYS });
    const limit = int(args.limit, "limit", { min: 1, max: 25, fallback: 12 });

    const items = await deadStockItems({
      repId: ctx.scope.repId,
      brand: args.brand ? str(args.brand, "brand", { max: 60 }) : null,
      section: args.section ? str(args.section, "section", { max: 40 }) : null,
      boughtByMyClients: bool(args.boughtByMyClients, false),
      minDays,
      limit,
    });

    if (items.length === 0) {
      return { товари: [], примітка: "за такими умовами мертвих залишків немає" };
    }

    const totalValue = items.reduce((sum, i) => sum + i.free * (i.lastCost ?? i.price), 0);

    return {
      умова: {
        днів_без_продажу_від: minDays,
        бренд: args.brand ?? null,
        розділ: args.section ?? null,
        лише_знайомі_клієнтам: bool(args.boughtByMyClients, false),
      },
      разом: { позицій: items.length, сума_за_собівартістю: uah(totalValue) },
      товари: items.map((i) => ({
        товар_id: i.productId,
        назва: i.name,
        артикул: i.sku,
        бренд: i.brand,
        розділ: sectionTitle(i.sectionId),
        залишок: i.free,
        днів_без_продажу: i.lastSale
          ? Math.round((Date.now() - i.lastSale.getTime()) / 86_400_000)
          : null,
        жодного_продажу: i.lastSale ? undefined : true,
        ціна: uah(i.price),
        собівартість: i.lastCost ? Math.round(i.lastCost * 100) / 100 : null,
        маржа_прайсова_відсотків: pct(priceMarginPct(i.price, i.lastCost)),
        сума_на_складі: uah(i.free * (i.lastCost ?? i.price)),
        моїх_клієнтів_брали: i.myBuyers,
      })),
    };
  },
};

export const entryOfferTool: ToolDef = {
  name: "entry_offer",
  label: "Збираю, з чим заходити",
  description:
    "З чим заходити до конкретного клієнта: гачок (розхідник, який бере вся база, — з ціною, собівартістю й підлогою ціни), причіп до кожного гачка (те, що статистично їде в одній накладній і має нормальну маржу) і мертві залишки того ж бренду, які варто розпрацювати. Викликай на «з чим зайти», «що запропонувати», «як розпрацювати клієнта».",
  parameters: {
    type: "object",
    properties: {
      counterpartyId: { type: "string", description: "Ідентифікатор клієнта." },
      maxHooks: { type: "integer", description: "Скільки гачків, до 6. За замовчуванням 4." },
    },
    required: ["counterpartyId"],
  },
  async run(ctx, args) {
    const counterpartyId = validId(args.counterpartyId, "counterpartyId");
    const maxHooks = int(args.maxHooks, "maxHooks", { min: 1, max: 6, fallback: 4 });
    const offer = await entryOffer(counterpartyId, ctx.scope.repId, maxHooks);
    if (!offer) return { помилка: "клієнта з таким ідентифікатором немає" };
    return offer;
  },
};
