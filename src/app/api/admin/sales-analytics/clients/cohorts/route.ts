/**
 * Когорти утримання і відтік у грошах. Логіка в lib/analytics/cohorts.ts.
 *
 * Періоду немає: когорти за визначенням уся історія, відтік — стан «зараз».
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildCohortReport } from "@/lib/analytics/cohorts";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role ?? "";
  if (!["ADMIN", "MANAGER"].includes(role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  return NextResponse.json(await buildCohortReport());
}
