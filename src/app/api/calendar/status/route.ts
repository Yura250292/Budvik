import { NextResponse } from "next/server";
import { STAFF_ROLES, requireRoles } from "@/lib/app/identity";
import { prisma } from "@/lib/prisma";
import { calendarMissingEnv } from "@/lib/calendar/config";

/**
 * Стан календаря для картки в кабінеті.
 *
 * Конектор не налаштовано — картки взагалі немає (enabled: false), а не
 * кнопка, яка віддає помилку.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, STAFF_ROLES);
  if (!auth.ok) return auth.response;

  if (calendarMissingEnv().length > 0) {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const conn = await prisma.calendarConnection.findUnique({
    where: { userId: auth.me.userId },
    select: { googleEmail: true, status: true, lastSyncAt: true, connectedAt: true, calendarId: true },
  });

  const events =
    conn && conn.status === "ACTIVE"
      ? await prisma.calendarEventLink.count({ where: { userId: auth.me.userId, state: "SYNCED" } })
      : 0;

  return NextResponse.json(
    {
      enabled: true,
      connected: Boolean(conn && conn.status !== "DISABLED"),
      status: conn?.status ?? null,
      googleEmail: conn?.googleEmail ?? null,
      lastSyncAt: conn?.lastSyncAt ?? null,
      connectedAt: conn?.connectedAt ?? null,
      calendarReady: Boolean(conn?.calendarId),
      events,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
