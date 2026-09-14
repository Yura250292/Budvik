import { NextResponse } from "next/server";
import { OFFICE_ROLES, requireRoles } from "@/lib/app/identity";
import { listStaff } from "@/lib/tasks";

/**
 * Кому можна доручити: лише персонал, лише id, ім'я й роль.
 * Не /api/admin/users — той тягне всіх покупців і зайві поля.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ items: await listStaff() });
}
