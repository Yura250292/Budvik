/** Відмітка «дочитано до …» для однієї розмови. */

import { NextResponse } from "next/server";
import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { markRead } from "@/lib/chat/queries";
import { NO_STORE, chatErrorResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;

  let body: { conversation?: unknown; upTo?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // нижче — 400
  }
  const conversation = typeof body.conversation === "string" ? body.conversation : "";
  const upTo = typeof body.upTo === "string" ? new Date(body.upTo) : null;
  if (!conversation || !upTo || Number.isNaN(upTo.getTime())) {
    return NextResponse.json({ error: "Потрібні розмова й час" }, { status: 400, ...NO_STORE });
  }

  try {
    const readAt = await markRead(guard.me, conversation, upTo);
    return NextResponse.json({ ok: true, readAt: readAt.toISOString() }, NO_STORE);
  } catch (e) {
    return chatErrorResponse(e);
  }
}
