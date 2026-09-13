import { NextResponse } from "next/server";
import { FIELD_ROLES, requireRoles } from "@/lib/app/identity";
import { repToday } from "@/lib/rep-feed/today";

/**
 * «Сьогодні в цифрах» для головної торгового: замовлення за день (з
 * чернетками окремо) і зібрані гроші. Без кешу — це саме та цифра, яку
 * дивляться серед дня, і година давності зробила б її брехливою.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await repToday(auth.me.userId));
}
