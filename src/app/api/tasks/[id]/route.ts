import { NextResponse } from "next/server";
import { STAFF_ROLES, requireRoles } from "@/lib/app/identity";
import { TaskError, completeTask } from "@/lib/tasks";

/**
 * Виконавець закриває свою задачу: { action: "done", note? }.
 * Чужу — 403. Автору повідомить воркер.
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, STAFF_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (body.action !== "done") return NextResponse.json({ error: "Невідома дія" }, { status: 400 });
  try {
    return NextResponse.json({ item: await completeTask(auth.me, id, body.note) });
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
