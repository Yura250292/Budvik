import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { listGrants, revokeGrant } from "@/lib/mcp/grants";

/**
 * Підключені AI-застосунки адміна (MCP-конектор для claude.ai і ChatGPT).
 *
 * GET              — живі підключення поточного адміна.
 * DELETE { familyId } — відключити одне (гасить токени; застосунок попросить
 *                    увійти знову).
 *
 * Лише ADMIN і лише свої: конектор видає дані всієї фірми, і відключати
 * його має той, хто підключав (або сам сервер — при ознаках крадіжки).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, ["ADMIN"]);
  if (!auth.ok) return auth.response;
  const grants = await listGrants(auth.me.userId);
  return NextResponse.json(
    {
      connectorUrl: process.env.MCP_PUBLIC_URL ?? "https://mcp.budvik27.com/mcp",
      grants,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(req: Request) {
  const auth = await requireRoles(req, ["ADMIN"]);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { familyId?: unknown };
  if (typeof body.familyId !== "string" || !body.familyId) {
    return NextResponse.json({ error: "Не вказано, що відключити" }, { status: 400 });
  }
  const ok = await revokeGrant(auth.me.userId, body.familyId);
  if (!ok) return NextResponse.json({ error: "Такого підключення немає" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
