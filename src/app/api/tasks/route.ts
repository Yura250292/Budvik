import { NextResponse } from "next/server";
import { STAFF_ROLES, requireRoles } from "@/lib/app/identity";
import { listMyTasks } from "@/lib/tasks";

/**
 * Мої задачі від офісу — для кабінету торгового, водія й складу.
 *
 * Лише свої, без параметрів: чужих задач виконавцю не видно навіть підставивши
 * id руками. Кукі кабінету або Bearer застосунку — resolveIdentity вміє обидва.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, STAFF_ROLES);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await listMyTasks(auth.me.userId), { headers: { "Cache-Control": "no-store" } });
}
