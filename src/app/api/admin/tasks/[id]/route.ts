import { NextResponse } from "next/server";
import { OFFICE_ROLES, requireRoles } from "@/lib/app/identity";
import { TaskError, cancelTask, completeTask, confirmTask, reopenTask, updateTask } from "@/lib/tasks";

/**
 * Дії офісу над задачею: { action, ...поля }.
 *
 * - confirm — підтвердити пропозицію з наради (з правками): піде виконавцю;
 * - update — правка; новий виконавець отримає задачу як нову;
 * - cancel, done { note }, reopen.
 *
 * Пуш звідси не шлеться: доставку робить воркер (src/lib/tasks/notify.ts).
 */
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    switch (body.action) {
      case "confirm":
        return NextResponse.json({ item: await confirmTask(auth.me.userId, id, body) });
      case "update":
        return NextResponse.json({ item: await updateTask(id, body) });
      case "cancel":
        return NextResponse.json({ item: await cancelTask(id) });
      case "done":
        return NextResponse.json({ item: await completeTask(auth.me, id, body.note) });
      case "reopen":
        return NextResponse.json({ item: await reopenTask(id) });
      default:
        return NextResponse.json({ error: "Невідома дія" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
