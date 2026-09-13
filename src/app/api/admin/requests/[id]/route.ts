import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { afterResponse } from "@/lib/http/after-response";
import { RequestError, resolveRequest } from "@/lib/office-requests";

/**
 * Закрити заявку: { status: "DONE" | "REJECTED", answer }. Сповіщення автору
 * — після відповіді, щоб офіс не чекав на сервер пушів.
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, ["ADMIN", "MANAGER"]);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const body = await req.json().catch(() => null);
    const { row, notify } = await resolveRequest(auth.me.userId, id, body);
    afterResponse(notify);
    return NextResponse.json({ item: row });
  } catch (e) {
    if (e instanceof RequestError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
