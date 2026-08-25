/**
 * Вихід із застосунку на цьому пристрої.
 *
 * Гасить рівно той токен, яким прийшов запит, — решта пристроїв людини
 * лишаються в системі. Повний вихід усюди робить зміна пароля.
 */

import { NextResponse } from "next/server";
import { revokeShopToken } from "@/lib/shop/app-token";
import { shopIdentity, unauthorized } from "@/lib/shop/api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await shopIdentity(req);
  if (!me) return unauthorized();

  await revokeShopToken(me.tokenId);
  return NextResponse.json({ ok: true });
}
