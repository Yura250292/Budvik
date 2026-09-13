import { NextResponse } from "next/server";
import { CABINET_ROLES, requireRoles } from "@/lib/app/identity";
import { loadStatement, STATEMENT_DAYS } from "@/lib/clients/statement";

/**
 * Виписка по клієнту за 30/60/90 днів. Ті самі ролі, що й картка клієнта:
 * торгові універсальні й відкривають будь-якого клієнта бази.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const raw = Number(new URL(req.url).searchParams.get("days"));
  const days = (STATEMENT_DAYS as readonly number[]).includes(raw) ? raw : 30;

  const payload = await loadStatement(id, days);
  if (!payload) return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  return NextResponse.json(payload);
}
