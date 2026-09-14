import { NextResponse } from "next/server";
import { OFFICE_ROLES, requireRoles } from "@/lib/app/identity";
import { TaskError, createTask, listTasks, parseStatusFilter } from "@/lib/tasks";

/**
 * Задачі команді для офісу.
 *
 * GET ?status=PROPOSED,ASSIGNED&assigneeId=…&mine=1&meetingId=… — без фільтрів усі.
 * POST — ручна задача, одразу надіслана: { title, details?, assigneeId, counterpartyId?, dueDate?, priority? }.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams;
  const items = await listTasks({
    status: parseStatusFilter(q.get("status")),
    assigneeId: q.get("assigneeId") || undefined,
    createdById: q.get("mine") === "1" ? auth.me.userId : undefined,
    meetingId: q.get("meetingId") || undefined,
  });
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => null);
    return NextResponse.json({ item: await createTask(auth.me.userId, body) }, { status: 201 });
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
