/**
 * Нове повідомлення в чаті персоналу.
 *
 * Пуш іде ПІСЛЯ відповіді: людина не має чекати, поки Expo відповість на
 * десять запитів. afterResponse тримає роботу живою на Vercel.
 */

import { NextResponse } from "next/server";
import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { rateLimit } from "@/lib/shop/rate-limit";
import { afterResponse } from "@/lib/http/after-response";
import { createMessage, type CreateInput } from "@/lib/chat/queries";
import { notifyStaffMessage } from "@/lib/chat/notify";
import { NO_STORE, chatErrorResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;

  const limit = await rateLimit(`chat:${guard.me.userId}`, 30, 60);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Забагато повідомлень — зачекайте хвилину" }, { status: 429, ...NO_STORE });
  }

  let body: CreateInput = {};
  try {
    body = (await req.json()) as CreateInput;
  } catch {
    return NextResponse.json({ error: "Порожнє повідомлення" }, { status: 400, ...NO_STORE });
  }

  try {
    const result = await createMessage(guard.me, body);
    afterResponse(() => notifyStaffMessage(result.message.id));
    return NextResponse.json(result, { status: 201, ...NO_STORE });
  } catch (e) {
    return chatErrorResponse(e);
  }
}
