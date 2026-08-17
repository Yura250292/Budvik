/**
 * Застосування номенклатури з 1С.
 *
 * Побудовано на логіці src/lib/sync/product-sync.ts (ручний імпорт файлів),
 * але з двома принциповими відмінностями:
 *  1. драбина зіставлення externalId → SKU → назва; перший збіг дозаписує
 *     externalId, після чого товар назавжди прив'язаний до GUID у 1С
 *     і перейменування в 1С більше не створює дубль;
 *  2. категорія НОВОГО товару береться з групи 1С, а вже наявні товари
 *     ніколи не переміщуються між категоріями (ручна розкладка — священна).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generateSlug } from "@/lib/import-1c";
import { parsePackQty } from "@/lib/pack-qty";
import { isRealSku } from "@/lib/catalog/sku-search";
import crypto from "crypto";
import type { ProductRecord } from "./types";
import { ApplyContext } from "./context";

/** Той самий алгоритм, що й у ручному імпорті — SKU лишаються стабільними. */
function generateSKU(name: string): string {
  const hash = crypto.createHash("md5").update(name).digest("hex").slice(0, 8).toUpperCase();
  return `1C-${hash}`;
}

const FALLBACK_CATEGORY_SLUG = "import-z-1s";

/** Категорія-звалище для товарів, чия група 1С ще не синхронізована. */
async function ensureFallbackCategory(): Promise<string> {
  const existing = await prisma.category.findUnique({ where: { slug: FALLBACK_CATEGORY_SLUG } });
  if (existing) return existing.id;

  const created = await prisma.category.create({
    data: { name: "Імпорт з 1С", slug: FALLBACK_CATEGORY_SLUG },
  });
  return created.id;
}

export async function applyProducts(
  records: ProductRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  const externalIds = records.map((r) => r.externalId);
  const skus = records.map((r) => r.sku).filter((s): s is string => !!s);
  const names = records.map((r) => r.name.toLowerCase());

  // Тягнемо лише потенційно релевантні товари, а не весь каталог:
  // батч — максимум 500 записів, тож три OR-умови дешевші за findMany({}).
  const candidates = await prisma.product.findMany({
    where: {
      OR: [
        { externalId: { in: externalIds } },
        ...(skus.length > 0 ? [{ sku: { in: skus } }] : []),
        { name: { in: names, mode: "insensitive" as const } },
      ],
    },
    select: {
      id: true,
      externalId: true,
      sku: true,
      name: true,
      slug: true,
      description: true,
      categoryId: true,
      brandId: true,
      packQty: true,
    },
  });

  const byExternalId = new Map(
    candidates.filter((p) => p.externalId).map((p) => [p.externalId!, p])
  );
  const bySku = new Map(candidates.filter((p) => p.sku).map((p) => [p.sku!, p]));
  const byName = new Map(candidates.map((p) => [p.name.toLowerCase(), p]));

  // Артикули, які в 1С означають не товар, а бренд.
  //
  // У цій базі поле "Артикул" подекуди заповнене назвою виробника: POLAX
  // стоїть у 242 різних товарів, MAGTOOLS — у 25. Шукати товар за таким
  // артикулом означає звести сотні різних позицій до одного запису на сайті:
  // сокира, валик і скотч усі "знайшли б" той самий пензель, і кожна
  // наступна перезаписувала б попередню.
  //
  // Тому артикул, що трапляється більше одного разу, як ключ пошуку не
  // використовуємо — лишаються externalId і назва.
  //
  // Перевіряємо і в межах батча, і по вже наявних товарах: 242 POLAX
  // розкидані по різних батчах, тож лічильник самого батча побачив би в
  // кожному лише кілька і нічого не запідозрив.
  const skuOccurrences = new Map<string, number>();
  for (const r of records) {
    const s = r.sku?.trim();
    if (s) skuOccurrences.set(s, (skuOccurrences.get(s) ?? 0) + 1);
  }
  const ambiguousSkus = new Set(
    [...skuOccurrences.entries()].filter(([, n]) => n > 1).map(([s]) => s)
  );

  // Артикул, під яким на сайті вже лежить товар, прив'язаний до ІНШОГО
  // запису 1С, теж ненадійний: збіг за ним перезаписав би чужий товар.
  // Неприв'язані (externalId = null) сюди не входять — саме їх ми й хочемо
  // знаходити за артикулом.
  const batchSkus = [...skuOccurrences.keys()];
  if (batchSkus.length > 0) {
    const linkedElsewhere = await prisma.product.findMany({
      where: {
        sku: { in: batchSkus },
        externalId: { not: null, notIn: externalIds },
      },
      select: { sku: true },
    });
    for (const p of linkedElsewhere) {
      if (p.sku) ambiguousSkus.add(p.sku);
    }
  }

  // Категорії 1С, на які посилається батч.
  const categoryExternalIds = [
    ...new Set(records.map((r) => r.categoryExternalId).filter((c): c is string => !!c)),
  ];
  const categories =
    categoryExternalIds.length > 0
      ? await prisma.category.findMany({
          where: { externalId: { in: categoryExternalIds } },
          select: { id: true, externalId: true },
        })
      : [];
  const categoryByExternalId = new Map(categories.map((c) => [c.externalId!, c.id]));

  let fallbackCategoryId: string | null = null;

  // Бренди для автопривʼязки нових товарів.
  //
  // Без цього кожен новий товар із 1С приїжджав би без бренду — навіть коли
  // в назві написано «SIGMA», — і аналітика по брендах поступово гнила б:
  // старі товари з брендом, нові без. matchPatterns саме для цього й
  // задумані в моделі Brand.
  //
  // Довші патерни перевіряються першими: «DNIPRO-M» має виграти в «DNIPRO».
  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    select: { id: true, matchPatterns: true },
  });
  const brandPatterns = brands
    .flatMap((b) => b.matchPatterns.map((p) => ({ id: b.id, pattern: p.toLowerCase().trim() })))
    .filter((p) => p.pattern.length >= 2)
    .sort((a, b) => b.pattern.length - a.pattern.length);

  /** Бренд за назвою товару; null, якщо жоден патерн не збігся. */
  function detectBrandId(name: string): string | null {
    const lower = name.toLowerCase();
    for (const { id, pattern } of brandPatterns) {
      if (lower.includes(pattern)) return id;
    }
    return null;
  }

  // Резервуємо slug/sku в межах батча, щоб два нових товари з однаковою
  // назвою не зіштовхнулися на унікальному індексі.
  const takenSlugs = new Set(candidates.map((p) => p.slug));
  const takenSkus = new Set(candidates.filter((p) => p.sku).map((p) => p.sku!));

  for (const rec of records) {
    if (!rec.name?.trim()) {
      ctx.skipped++;
      continue;
    }

    const recSku = rec.sku?.trim();
    const skuIsUsable = !!recSku && !ambiguousSkus.has(recSku);
    const sku = recSku || generateSKU(rec.name);
    const existing =
      byExternalId.get(rec.externalId) ||
      (skuIsUsable ? bySku.get(recSku!) : undefined) ||
      byName.get(rec.name.toLowerCase());

    // --- Товар помічений на видалення в 1С ---
    // Не деактивуємо автоматично: це рішення адміністратора.
    if (rec.deleted) {
      if (existing) {
        ctx.discrepancy({
          entityType: "product",
          entityRef: skuIsUsable ? recSku! : rec.externalId,
          entityName: rec.name,
          field: "DELETED_IN_1C",
          value1C: "помічено на видалення",
          valueBudvik: "активний на сайті",
        });
      }
      ctx.skipped++;
      continue;
    }

    // --- Новий товар ---
    if (!existing) {
      if (ctx.isPreview) {
        ctx.created++;
        ctx.discrepancy({
          entityType: "product",
          entityRef: sku,
          entityName: rec.name,
          field: "NEW",
          value1C: rec.name,
          valueBudvik: "не існує",
        });
        continue;
      }

      let categoryId = rec.categoryExternalId
        ? categoryByExternalId.get(rec.categoryExternalId)
        : undefined;
      if (!categoryId) {
        fallbackCategoryId ??= await ensureFallbackCategory();
        categoryId = fallbackCategoryId;
      }

      // takenSlugs бачить лише кандидатів цього батча, а однойменний товар
      // цілком може лежати в іншому батчі або вже в базі. Тому суфікс із
      // GUID додається завжди, коли базовий slug зайнятий, а остаточну
      // унікальність гарантує повтор зі створенням нижче.
      let slug = generateSlug(rec.name) || `product-${rec.externalId.slice(0, 8)}`;
      if (takenSlugs.has(slug)) slug = `${slug}-${rec.externalId.slice(0, 6)}`;
      takenSlugs.add(slug);

      // Артикул-бренд не можна ставити новому товару як є: 242 товари з
      // артикулом POLAX зіткнулися б на унікальному індексі, і в базу
      // потрапив би лише перший. Такі одразу отримують похідний артикул.
      let finalSku = skuIsUsable ? sku : `${sku}-${rec.externalId.slice(0, 6)}`;
      if (takenSkus.has(finalSku)) finalSku = `${sku}-${rec.externalId.slice(0, 6)}`;
      takenSkus.add(finalSku);

      // Друга спроба з гарантовано унікальними slug/sku, якщо перша впала на
      // унікальному індексі. Так сталося з 426 товарами: однойменні позиції
      // з різних батчів претендували на один slug, takenSlugs бачив лише свій
      // батч, і товари просто не створювались.
      const createData = {
        externalId: rec.externalId,
        name: rec.name,
        description: rec.description || "",
        price: 0, // ціна приїде окремим батчем entityType: "price"
        stock: 0, // залишок приїде окремим батчем entityType: "stock"
        categoryId,
        brandId: detectBrandId(rec.name),
        packQty: parsePackQty(rec.name),
        isActive: true,
        syncedAt: new Date(),
        syncSource: "1C",
      };
      const selectFields = {
        id: true, externalId: true, sku: true, name: true,
        slug: true, description: true, categoryId: true, brandId: true,
        packQty: true,
      };

      let createdProduct = null;
      for (const attempt of [0, 1]) {
        // GUID унікальний за визначенням, тож друга спроба конфліктувати не може.
        const trySlug = attempt === 0 ? slug : `${slug}-${rec.externalId.slice(0, 8)}`;
        const trySku = attempt === 0 ? finalSku : `${finalSku}-${rec.externalId.slice(0, 8)}`;
        try {
          createdProduct = await prisma.product.create({
            data: { ...createData, slug: trySlug, sku: trySku },
            select: selectFields,
          });
          finalSku = trySku;
          break;
        } catch (e) {
          const isUniqueConflict =
            e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
          if (!isUniqueConflict || attempt === 1) {
            ctx.fail(rec.name, e);
            break;
          }
        }
      }

      if (createdProduct) {
        // Щоб наступні записи цього ж батча бачили щойно створений товар.
        byExternalId.set(rec.externalId, createdProduct);
        ctx.created++;
        ctx.discrepancy({
          entityType: "product",
          entityRef: finalSku,
          entityName: rec.name,
          field: "NEW",
          value1C: rec.name,
          valueBudvik: "створено",
        });
      }
      continue;
    }

    // --- Наявний товар ---
    const updates: Record<string, unknown> = {};

    // Прив'язка до GUID — головна цінність першого зіставлення.
    if (!existing.externalId) updates.externalId = rec.externalId;

    // Дозаписуємо артикул, якщо на сайті його не було.
    //
    // Заглушку «1C-XXXXXXXX» теж вважаємо за «не було»: раніше умова звучала
    // як `!existing.sku`, але порожнього sku в базі не буває — при створенні
    // товару туди одразу лягає згенерована заглушка. Через це справжній
    // артикул із 1С мовчки відкидався, і 11 тис. товарів лишались без нього.
    // Торгові шукають саме за артикулом, тож це ламало їм пошук.
    if (rec.sku?.trim() && !isRealSku(existing.sku)) {
      const incoming = rec.sku.trim();
      // Артикул унікальний у схемі — не вішаємо його, якщо ним уже володіє
      // інший товар (у цьому ж батчі або деінде в базі), інакше впаде батч.
      if (!takenSkus.has(incoming) && !ambiguousSkus.has(incoming)) {
        updates.sku = incoming;
        takenSkus.add(incoming);
      }
    }

    // Назву оновлюємо, опис — ні: опис на сайті збагачений вручну/AI
    // і завжди якісніший за той, що приходить з 1С.
    if (rec.name !== existing.name) {
      ctx.discrepancy({
        entityType: "product",
        entityRef: skuIsUsable ? recSku! : rec.externalId,
        entityName: rec.name,
        field: "name",
        value1C: rec.name,
        valueBudvik: existing.name,
      });
      updates.name = rec.name;
    }

    // Опис заповнюємо лише якщо на сайті порожньо.
    if (!existing.description?.trim() && rec.description?.trim()) {
      updates.description = rec.description.trim();
    }

    // Бренд дозаповнюємо, але НІКОЛИ не перезаписуємо.
    //
    // Так новий бренд у довіднику підхоплює вже наявні товари: додали
    // «Bosch» із патерном — і наступний цикл проставить його всім, де це
    // слово є в назві. А проставлений вручну бренд лишається недоторканим:
    // людина знає краще за пошук по рядку.
    if (!existing.brandId) {
      const detected = detectBrandId(rec.name);
      if (detected) updates.brandId = detected;
    }

    // Кратність — за тим самим правилом, що й бренд: дозаповнюємо з назви,
    // але виставлену вручну не чіпаємо. Якщо в 1С перейменували товар і
    // додали «кратно 10шт» — підхопимо з нової назви на наступному циклі.
    if (existing.packQty == null) {
      const pack = parsePackQty(rec.name || existing.name);
      if (pack) updates.packQty = pack;
    }

    if (Object.keys(updates).length === 0) {
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      ctx.updated++;
      continue;
    }

    updates.syncedAt = new Date();
    updates.syncSource = "1C";

    try {
      await prisma.product.update({ where: { id: existing.id }, data: updates });
      ctx.updated++;
    } catch (e) {
      ctx.fail(rec.name, e);
    }
  }
}
