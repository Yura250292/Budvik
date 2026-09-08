/**
 * Збірка накладної, яку ще набирають.
 *
 * Головне, що тут треба тримати в голові: список НЕ статичний. Менеджер
 * дописує позиції в накладну протягом дня, обмін привозить її кожні пʼять
 * хвилин, і на кожному циклі рядки документа ВИДАЛЯЮТЬСЯ й створюються
 * заново (apply-documents.ts). Тому:
 *
 * — позначка «зібрано» живе за парою (документ + товар), а не за рядком;
 * — зберігається кількість, а не прапорець: у зібраному рядку кількість може
 *   вирости, і тоді це «донести 2», а не «зібрати наново»;
 * — рядок, який зник із накладної після того, як його зібрали, не мовчить, а
 *   стає «повернути на місце».
 *
 * Усе це — стан на боці сайту. У 1С не пишеться нічого.
 */

import { prisma } from "@/lib/prisma";

/** Що зараз у роботі: набирається (DRAFT) або набране, але ще не поїхало. */
export const PICKING_STATUSES = ["DRAFT", "CONFIRMED", "PACKING"] as const;

export type PickLine = {
  productId: string;
  name: string;
  sku: string | null;
  /** Скільки треба за накладною просто зараз. */
  need: number;
  /** Скільки вже зібрано. */
  picked: number;
  /** Скільки лишилось донести; відʼємне означає «взяли зайве». */
  left: number;
  state: "чекає" | "зібрано" | "донести" | "зайве";
  packQty: number | null;
  image: string | null;
  /** Товар прибрали з накладної, а він уже зібраний — віднести назад. */
  removed: boolean;
};

function stateOf(need: number, picked: number, removed: boolean): PickLine["state"] {
  if (removed) return "зайве";
  if (picked <= 0) return "чекає";
  if (picked < need) return "донести";
  if (picked > need) return "зайве";
  return "зібрано";
}

/** Рядки накладної разом із позначками складу. */
export async function pickLines(salesDocumentId: string): Promise<PickLine[]> {
  const [items, marks] = await Promise.all([
    prisma.salesDocumentItem.findMany({
      where: { salesDocumentId },
      select: {
        quantity: true,
        product: { select: { id: true, name: true, sku: true, packQty: true, image: true } },
      },
    }),
    prisma.pickMark.findMany({
      where: { salesDocumentId },
      select: {
        quantity: true,
        product: { select: { id: true, name: true, sku: true, packQty: true, image: true } },
      },
    }),
  ]);

  /**
   * Один товар може стояти в накладній кількома рядками (різна ціна, різні
   * партії). Для збірки це одна позиція: складовщик несе штуки, а не рядки.
   */
  const need = new Map<string, { qty: number; product: (typeof items)[number]["product"] }>();
  for (const i of items) {
    const prev = need.get(i.product.id);
    need.set(i.product.id, {
      qty: (prev?.qty ?? 0) + i.quantity,
      product: i.product,
    });
  }

  const pickedBy = new Map(marks.map((m) => [m.product.id, m]));

  const lines: PickLine[] = [];

  for (const [productId, row] of need) {
    const picked = pickedBy.get(productId)?.quantity ?? 0;
    lines.push({
      productId,
      name: row.product.name,
      sku: row.product.sku,
      need: row.qty,
      picked,
      left: row.qty - picked,
      state: stateOf(row.qty, picked, false),
      packQty: row.product.packQty,
      image: row.product.image,
      removed: false,
    });
  }

  // Зібране, чого в накладній уже немає: менеджер прибрав рядок після того,
  // як склад його виніс. Мовчати не можна — товар лежить біля воріт.
  for (const [productId, mark] of pickedBy) {
    if (need.has(productId) || mark.quantity <= 0) continue;
    lines.push({
      productId,
      name: mark.product.name,
      sku: mark.product.sku,
      need: 0,
      picked: mark.quantity,
      left: -mark.quantity,
      state: "зайве",
      packQty: mark.product.packQty,
      image: mark.product.image,
      removed: true,
    });
  }

  // Спершу те, що робити: чекає й донести, потім зайве, зібране в кінці.
  const rank: Record<PickLine["state"], number> = { чекає: 0, донести: 1, зайве: 2, зібрано: 3 };
  lines.sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));

  return lines;
}

export function pickProgress(lines: PickLine[]) {
  const need = lines.filter((l) => !l.removed);
  return {
    позицій: need.length,
    зібрано: need.filter((l) => l.state === "зібрано").length,
    лишилось: need.filter((l) => l.state !== "зібрано").length,
    зайвого: lines.filter((l) => l.state === "зайве").length,
    /** Накладна зібрана, коли не лишилось ні недобору, ні зайвого. */
    готово: need.every((l) => l.state === "зібрано") && lines.every((l) => !l.removed),
  };
}
