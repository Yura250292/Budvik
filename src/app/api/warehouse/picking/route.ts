/**
 * Що зараз збирати: накладні в роботі.
 *
 * Головне — DRAFT: це накладна, яку менеджер набирає просто зараз. Саме її
 * склад і збирає, не чекаючи «проведено». Проведені показуємо теж, поки
 * товар не поїхав: між проведенням і відвантаженням лишається робота.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, WAREHOUSE_ROLES } from "@/lib/app/identity";
import { PICKING_STATUSES } from "@/lib/warehouse/picking";
import { kyivDayStart, kyivDate } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

/**
 * Глибина списку.
 *
 * Накладні старші за це склад уже не збирає — вони або поїхали, або застрягли
 * в 1С назавжди (таких там тисячі, див. купу «до збірки» на 3412 документів).
 * Без межі екран показував би історію замість роботи.
 */
const DAYS_BACK = 3;

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(Number(searchParams.get("days")) || DAYS_BACK, 1), 14);
  const from = kyivDayStart(kyivDate(new Date(Date.now() - (days - 1) * 86_400_000)));

  const docs = await prisma.salesDocument.findMany({
    where: {
      docType: "REALIZATION",
      status: { in: PICKING_STATUSES as unknown as string[] as never },
      createdAt: { gte: from },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      totalAmount: true,
      counterparty: { select: { id: true, name: true } },
      salesRep: { select: { name: true } },
      _count: { select: { items: true } },
      pickMarks: { select: { quantity: true, updatedAt: true, user: { select: { name: true } } } },
    },
    take: 100,
  });

  return NextResponse.json(
    {
      документи: docs.map((d) => {
        const touched = d.pickMarks.filter((m) => m.quantity > 0);
        const last = touched.reduce<Date | null>(
          (max, m) => (!max || m.updatedAt > max ? m.updatedAt : max),
          null
        );
        return {
          id: d.id,
          номер: d.number,
          // DRAFT — це «менеджер ще набирає»: саме це слово має бачити склад,
          // а не технічний статус.
          стан: d.status === "DRAFT" ? "набирається" : d.status === "PACKING" ? "пакується" : "проведено",
          клієнт: d.counterparty?.name ?? "—",
          клієнтId: d.counterparty?.id ?? null,
          торговий: d.salesRep?.name ?? null,
          позицій: d._count.items,
          сума: d.totalAmount,
          створено: d.createdAt,
          оновлено: d.updatedAt,
          взявся: touched.length > 0 ? (touched[0]?.user.name ?? null) : null,
          рядківЗібрано: touched.length,
          останняВідмітка: last,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
