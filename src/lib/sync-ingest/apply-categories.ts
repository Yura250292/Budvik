/**
 * Дзеркалення дерева груп номенклатури 1С у таблицю Category.
 *
 * Категорії з 1С позначаються source="1C" і НЕ показуються в навігації сайту
 * автоматично — вітрина далі будується вручну (src/lib/category-tree.ts).
 * Роль цього дерева — дати новим товарам осмислену категорію замість
 * звалища «Імпорт з 1С».
 *
 * Батьківські зв'язки проставляються другим проходом: 1С не гарантує, що
 * батьківська група приїде в тому ж батчі раніше за дочірню.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generateSlug } from "@/lib/import-1c";
import type { CategoryRecord } from "./types";
import { ApplyContext } from "./context";

/** Slug для категорії з 1С; префікс розводить її з ручними категоріями. */
function categorySlug(name: string, externalId: string): string {
  const base = generateSlug(name);
  return base ? `${base}-1c` : `category-1c-${externalId.slice(0, 8)}`;
}

export async function applyCategories(
  records: CategoryRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  const existing = await prisma.category.findMany({
    where: { externalId: { in: records.map((r) => r.externalId) } },
    select: { id: true, externalId: true, name: true, parentId: true },
  });
  const byExternalId = new Map(existing.map((c) => [c.externalId!, c]));

  const takenSlugs = new Set(
    (await prisma.category.findMany({ select: { slug: true } })).map((c) => c.slug)
  );

  // --- Прохід 1: створення/оновлення самих категорій ---
  for (const rec of records) {
    if (!rec.name?.trim()) {
      ctx.skipped++;
      continue;
    }

    // Групу, помічену на видалення в 1С, не чіпаємо: у ній можуть лишатися
    // товари сайту. Лише фіксуємо розбіжність — повтор відсіється при записі.
    if (rec.deleted) {
      if (byExternalId.has(rec.externalId)) {
        ctx.discrepancy({
          entityType: "category",
          entityRef: rec.externalId,
          entityName: rec.name,
          field: "DELETED_IN_1C",
          value1C: "помічено на видалення",
          valueBudvik: "існує на сайті",
        });
      }
      ctx.skipped++;
      continue;
    }

    const found = byExternalId.get(rec.externalId);

    if (!found) {
      if (ctx.isPreview) {
        ctx.created++;
        continue;
      }

      let slug = categorySlug(rec.name, rec.externalId);
      if (takenSlugs.has(slug)) slug = `${slug}-${rec.externalId.slice(0, 6)}`;
      takenSlugs.add(slug);

      // Друга спроба з GUID у слугу, якщо перша впала на унікальному індексі.
      // Групи 1С "1. MASTERTOOL", "1.MASTERTOOL" і "1.1 MASTERTOOL" дають
      // однаковий slug, а takenSlugs бачить лише кандидатів свого батча —
      // тому частина категорій просто не створювалась.
      let created = null;
      for (const attempt of [0, 1]) {
        const trySlug = attempt === 0 ? slug : `${slug}-${rec.externalId.slice(0, 8)}`;
        try {
          created = await prisma.category.create({
            data: { externalId: rec.externalId, name: rec.name, slug: trySlug, source: "1C" },
            select: { id: true, externalId: true, name: true, parentId: true },
          });
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
      if (created) {
        byExternalId.set(rec.externalId, created);
        ctx.created++;
      }
      continue;
    }

    if (found.name === rec.name) {
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      ctx.updated++;
      continue;
    }

    try {
      await prisma.category.update({ where: { id: found.id }, data: { name: rec.name } });
      ctx.updated++;
    } catch (e) {
      ctx.fail(rec.name, e);
    }
  }

  if (ctx.isPreview) return;

  // --- Прохід 2: батьківські зв'язки ---
  // Батько міг приїхати в цьому ж батчі або вже існувати в БД.
  const parentExternalIds = [
    ...new Set(records.map((r) => r.parentExternalId).filter((p): p is string => !!p)),
  ];
  const knownParents = new Map(byExternalId);

  const missingParents = parentExternalIds.filter((id) => !knownParents.has(id));
  if (missingParents.length > 0) {
    const fetched = await prisma.category.findMany({
      where: { externalId: { in: missingParents } },
      select: { id: true, externalId: true, name: true, parentId: true },
    });
    for (const c of fetched) knownParents.set(c.externalId!, c);
  }

  for (const rec of records) {
    if (rec.deleted) continue;

    const self = byExternalId.get(rec.externalId);
    if (!self) continue;

    const desiredParentId = rec.parentExternalId
      ? knownParents.get(rec.parentExternalId)?.id ?? null
      : null;

    if (desiredParentId === self.parentId) continue;

    // Категорія не може бути власним батьком — захист від зіпсованих даних 1С.
    if (desiredParentId === self.id) continue;

    try {
      await prisma.category.update({
        where: { id: self.id },
        data: { parentId: desiredParentId },
      });
      self.parentId = desiredParentId;
    } catch (e) {
      ctx.fail(`parent:${rec.name}`, e);
    }
  }
}
