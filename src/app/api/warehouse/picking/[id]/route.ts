/**
 * Одна накладна на збірці: рядки, позначки й прогрес.
 *
 * POST ставить кількість зібраного по товару. Саме кількість, а не «галочку»:
 * накладна росте, і в уже зібраному рядку кількість може змінитися.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, WAREHOUSE_ROLES } from "@/lib/app/identity";
import { pickLines, pickProgress } from "@/lib/warehouse/picking";
import { baselineSeenLines } from "@/lib/warehouse/pick-notify";

export const dynamic = "force-dynamic";

async function loadDoc(id: string) {
  return prisma.salesDocument.findFirst({
    where: { id, docType: "REALIZATION" },
    select: {
      id: true,
      number: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      totalAmount: true,
      notes: true,
      counterparty: { select: { id: true, name: true, address: true, deliveryAddress: true, phone: true } },
      salesRep: { select: { name: true } },
    },
  });
}

function docDto(doc: NonNullable<Awaited<ReturnType<typeof loadDoc>>>) {
  return {
    id: doc.id,
    номер: doc.number,
    стан: doc.status === "DRAFT" ? "набирається" : doc.status === "PACKING" ? "пакується" : "проведено",
    клієнт: doc.counterparty?.name ?? "—",
    клієнтId: doc.counterparty?.id ?? null,
    адреса: doc.counterparty?.deliveryAddress ?? doc.counterparty?.address ?? null,
    телефон: doc.counterparty?.phone ?? null,
    торговий: doc.salesRep?.name ?? null,
    сума: doc.totalAmount,
    коментар: doc.notes,
    оновлено: doc.updatedAt,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const doc = await loadDoc(id);
  if (!doc) return NextResponse.json({ error: "Накладну не знайдено" }, { status: 404 });

  const lines = await pickLines(id);

  return NextResponse.json(
    { документ: docDto(doc), рядки: lines, разом: pickProgress(lines) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { productId?: unknown; quantity?: unknown };

  const productId = typeof body.productId === "string" ? body.productId : "";
  const quantity = Number(body.quantity);

  if (!productId || !Number.isFinite(quantity) || quantity < 0) {
    return NextResponse.json({ error: "Потрібні productId і кількість" }, { status: 400 });
  }

  const doc = await loadDoc(id);
  if (!doc) return NextResponse.json({ error: "Накладну не знайдено" }, { status: 404 });

  /**
   * Нуль — це зняти позначку, а не «зібрано нуль».
   *
   * Складовщик помилився рядком і виправляється; лишити рядок із нулем
   * означало б показувати його як «зібране, чого немає в накладній».
   */
  if (quantity === 0) {
    await prisma.pickMark.deleteMany({ where: { salesDocumentId: id, productId } });
  } else {
    /**
     * Перша позначка означає «я взявся» — і саме тут ставиться знімок того,
     * що людина вже бачила. Усе, що менеджер допише після, стане новиною й
     * прилетить пушем (див. lib/warehouse/pick-notify.ts). Знімок ставимо
     * ДО позначки: інакше обмін, який приїде між цими двома записами, побачив
     * би «взявся, а знімка немає» і зайво промовчав би про справжню новину.
     */
    await baselineSeenLines(id);

    await prisma.pickMark.upsert({
      where: { salesDocumentId_productId: { salesDocumentId: id, productId } },
      create: { salesDocumentId: id, productId, quantity, userId: auth.me.userId },
      update: { quantity, userId: auth.me.userId },
    });
  }

  const lines = await pickLines(id);
  return NextResponse.json({ рядки: lines, разом: pickProgress(lines) });
}
