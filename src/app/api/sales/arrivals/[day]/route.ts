import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/app/identity";
import { arrivalsForRep } from "@/lib/rep-feed/arrivals";
import { arrivalWindow } from "@/lib/rep-feed/format";

/**
 * Прихід за день для торгового — те саме, що пішло пушем о 10:00, але
 * повним списком. Рахується наживо тією ж функцією: вільний залишок на
 * сторінці свіжий, а не на момент пуша.
 */
export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request, { params }: { params: Promise<{ day: string }> }) {
  const auth = await requireRoles(req, ["SALES", "ADMIN"]);
  if (!auth.ok) return auth.response;

  const { day } = await params;
  if (!DAY_RE.test(day)) {
    return NextResponse.json({ error: "Дата має бути у форматі YYYY-MM-DD" }, { status: 400 });
  }
  const window = arrivalWindow(day);
  const items = await arrivalsForRep(auth.me.userId, window);
  return NextResponse.json({
    day,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    items,
  });
}
