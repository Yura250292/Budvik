import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { priceChangesForRep } from "@/lib/rep-feed/price-changes";
import { priceWindow } from "@/lib/rep-feed/format";

/** Подорожчання за день для торгового — повним списком до ранкового пуша. */
export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request, { params }: { params: Promise<{ day: string }> }) {
  const auth = await requireRoles(req, ["SALES", "ADMIN"]);
  if (!auth.ok) return auth.response;

  const { day } = await params;
  if (!DAY_RE.test(day)) {
    return NextResponse.json({ error: "Дата має бути у форматі YYYY-MM-DD" }, { status: 400 });
  }
  const window = priceWindow(day);
  return NextResponse.json({
    day,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    items: await priceChangesForRep(auth.me.userId, window),
  });
}
