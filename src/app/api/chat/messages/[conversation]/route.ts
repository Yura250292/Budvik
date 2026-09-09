/**
 * Повідомлення однієї розмови — останні 50 або старіші за `before`.
 *
 * Курсора «після» немає навмисно: cuid не впорядковані в часі, і два
 * вставлення можуть закомітитись у зворотному порядку — строга межа
 * пропустила б повідомлення. Кожне опитування віддає хвіст цілком (~10 КБ),
 * клієнт просто замінює стан.
 */

import { NextResponse } from "next/server";
import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { listMessages } from "@/lib/chat/queries";
import { NO_STORE, chatErrorResponse } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ conversation: string }> }) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;

  const { conversation } = await params;
  const url = new URL(req.url);
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if (before && Number.isNaN(before.getTime())) {
    return NextResponse.json({ error: "Невірна дата" }, { status: 400, ...NO_STORE });
  }
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

  try {
    const result = await listMessages(guard.me, conversation, { before, limit });
    return NextResponse.json(result, NO_STORE);
  } catch (e) {
    return chatErrorResponse(e);
  }
}
