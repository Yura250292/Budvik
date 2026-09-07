/**
 * Хто зараз на маршруті — для карти керівника.
 *
 * Сам збір даних живе в src/lib/track/live-positions.ts: те саме питання
 * ставить помічник керівника, і друга реалізація неминуче розійшлася б із
 * цією. Тут лишається доступ і розбір адреси.
 *
 * Сторінка опитує цей ендпоінт раз на 20–30 секунд.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { kyivDate } from "@/lib/date/kyiv";
import { livePositions } from "@/lib/track/live-positions";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const day = url.searchParams.get("day") || kyivDate(new Date());

  return NextResponse.json(await livePositions(day));
}
