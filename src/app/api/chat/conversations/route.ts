/**
 * Список розмов чату персоналу з непрочитаним і довідником людей.
 *
 * Люди їдуть разом зі списком, а не окремим роутом: вони потрібні і для
 * підписів особистих розмов, і для вибору адресата — один похід на сервер
 * із телефона замість двох.
 */

import { NextResponse } from "next/server";
import { requireRoles, STAFF_ROLES } from "@/lib/app/identity";
import { summarize } from "@/lib/chat/queries";
import { isOffice } from "@/lib/chat/audience";
import { NO_STORE, chatErrorResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireRoles(req, STAFF_ROLES);
  if (!guard.ok) return guard.response;
  try {
    const { conversations, totalUnread, people } = await summarize(guard.me);
    return NextResponse.json(
      {
        me: { id: guard.me.userId, role: guard.me.role },
        conversations,
        totalUnread,
        people,
        canPickGroups: isOffice(guard.me.role),
      },
      NO_STORE
    );
  } catch (e) {
    return chatErrorResponse(e);
  }
}
