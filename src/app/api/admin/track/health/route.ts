/**
 * Пульт треку — дані для екрана «Чому не пишеться».
 *
 * Логіка не тут, а в `@/lib/track/health-board`: той самий діагноз читають
 * скрипт у терміналі й воркер, який шле сповіщення. Роут лишає собі доступ і
 * розбір дня.
 *
 * Сторінка опитує його раз на 20 секунд, тож нічого не кешуємо: пульт, який
 * показує стан хвилинної давності, гірший за відсутній — на нього дивляться
 * саме тоді, коли рахунок іде на хвилини.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { trackHealthBoard } from "@/lib/track/health-board";

export const dynamic = "force-dynamic";

/**
 * Тільки керівництво. Пульт показує все поле разом — де хто зараз, чий
 * планшет мовчить, у кого сідає батарея; торговому тут нема чого.
 */
const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const day = new URL(req.url).searchParams.get("day") ?? undefined;
  const board = await trackHealthBoard(day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined);

  return NextResponse.json(board, { headers: { "Cache-Control": "no-store" } });
}
