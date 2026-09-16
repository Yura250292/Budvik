import { NextResponse } from "next/server";
import { CABINET_ROLES, requireRoles } from "@/lib/app/identity";
import { rateLimit } from "@/lib/shop/rate-limit";
import { canEditOutreach, createOutreach, listOutreach, OutreachError } from "@/lib/outreach";

/**
 * Журнал пропозицій клієнту: історія на картці й запис відправки.
 *
 * POST приходить із keepalive у ту мить, коли торговий натиснув «Viber», —
 * сторінка тут же йде у фон, і без keepalive запит обривався б разом із нею.
 */
export const dynamic = "force-dynamic";

/**
 * 60 на годину: торговий за годину реально пише десятку клієнтів. Стеля
 * не проти людини, а проти зациклених повторів із поганого зв'язку.
 */
const POST_LIMIT = 60;

export async function GET(req: Request) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const counterpartyId = new URL(req.url).searchParams.get("counterpartyId")?.trim();
  if (!counterpartyId) return NextResponse.json({ error: "Не вказано клієнта" }, { status: 400 });

  const items = await listOutreach(counterpartyId);
  return NextResponse.json(
    { items: items.map((i) => ({ ...i, canEdit: canEditOutreach(i, auth.me) })) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const limit = await rateLimit(`outreach:${auth.me.userId}`, POST_LIMIT, 3600);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Забагато відправок за годину — зачекайте" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => null);
    const { item, duplicate } = await createOutreach(body, auth.me.userId);
    return NextResponse.json(
      { item: { ...item, canEdit: true }, duplicate },
      { status: duplicate ? 200 : 201 }
    );
  } catch (e) {
    if (e instanceof OutreachError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
