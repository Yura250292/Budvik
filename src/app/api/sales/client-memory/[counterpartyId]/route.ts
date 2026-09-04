/**
 * Пам'ять про клієнта: читання і новий запис.
 *
 * Живе під /api/sales, а не під /api/admin, свідомо: це знання торгового
 * про свою точку, і головний вхід до нього — картка клієнта в кабінеті.
 * Стрічка спільна для всієї команди, як і коментарі: клієнта веде людина,
 * але передавати його між людьми доводиться регулярно.
 */

import { NextResponse } from "next/server";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { prisma } from "@/lib/prisma";
import { createMemory, listMemory, MemoryError } from "@/lib/assistant/memory";

export const dynamic = "force-dynamic";

/** Хто може правити й видаляти чужий запис. */
const MANAGEMENT_ROLES = ["ADMIN", "MANAGER"];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  const { counterpartyId } = await params;
  const facts = await listMemory(counterpartyId);

  return NextResponse.json(
    {
      facts: facts.map((f) => ({
        ...f,
        // Явний перелік, а не «не SALES»: заперечення тихо роздало б
        // право правити чужі записи кожній новій ролі.
        canEdit:
          f.author?.id === guard.me.userId || MANAGEMENT_ROLES.includes(guard.me.role),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  const { counterpartyId } = await params;

  const exists = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });

  let body: { kind?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний запит" }, { status: 400 });
  }

  try {
    const fact = await createMemory({
      counterpartyId,
      authorId: guard.me.userId,
      kind: body.kind,
      text: body.text,
      source: "REP",
    });
    return NextResponse.json({ ...fact, canEdit: true }, { status: 201 });
  } catch (e) {
    if (e instanceof MemoryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
