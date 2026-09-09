/** Скільки непрочитаного — для бейджа в шапці й крапки на вкладці. */

import { NextResponse } from "next/server";
import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { unreadTotal } from "@/lib/chat/queries";
import { NO_STORE, chatErrorResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ total: await unreadTotal(guard.me) }, NO_STORE);
  } catch (e) {
    return chatErrorResponse(e);
  }
}
