/**
 * Робочі дні водіїв за період — «Логістика → Зміни → Водії».
 *
 * Логіка — у `src/lib/drivers/driver-days.ts`; тут доступ і кеш пробігу.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { unstable_cache } from "next/cache";
import { authOptions } from "@/lib/auth";
import { loadDriverDays, sessionDriveKm } from "@/lib/drivers/driver-days";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Пробіг доби — з кешем даних.
 *
 * Кожен день — це всі його точки (тисячі рядків через інтернет до бази), а
 * минулий день не змінюється. Кількість точок стоїть у ключі: доїхав хвіст
 * буфера — ключ новий, і пробіг перераховується; сьогоднішній день так само
 * оновлюється, щойно прийшла пачка точок.
 */
const cachedSessionKm = unstable_cache(
  async (sessionId: string, pointsCount: number) =>
    pointsCount > 0 ? sessionDriveKm(sessionId) : null,
  ["driver-day-drive-km-v1"],
  { revalidate: 7 * 24 * 3600 }
);

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to)) {
    return NextResponse.json({ error: "Потрібні from і to у форматі РРРР-ММ-ДД" }, { status: 400 });
  }

  const result = await loadDriverDays(from, to, {
    driverId: url.searchParams.get("driverId"),
    sessionKm: cachedSessionKm,
  });
  return NextResponse.json(result);
}
