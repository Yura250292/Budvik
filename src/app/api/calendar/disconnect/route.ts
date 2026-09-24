import { NextResponse } from "next/server";
import { STAFF_ROLES, requireRoles } from "@/lib/app/identity";
import { decryptToken } from "@/lib/calendar/crypto";
import { disconnect, getConnection } from "@/lib/calendar/connection";
import { revokeToken } from "@/lib/calendar/oauth";

/**
 * Відключити календар.
 *
 * Сам календар «Budvik» у Google ЛИШАЄТЬСЯ: це дані в акаунті людини, і
 * видаляти їх мовчки — гарантований дзвінок у підтримку. Ми прибираємо в
 * себе токен і мапінг; порожній календар людина видалить сама, якщо схоче.
 *
 * Відкликання дозволу в Google — справа доброї волі: не вийшло, то й
 * добре, токена в нас усе одно вже немає.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireRoles(req, STAFF_ROLES);
  if (!auth.ok) return auth.response;

  const conn = await getConnection(auth.me.userId);
  if (!conn) return NextResponse.json({ ok: true });

  if (conn.refreshTokenEnc) {
    try {
      await revokeToken(decryptToken(conn.refreshTokenEnc, auth.me.userId));
    } catch {
      // Ключ змінився або токен уже недійсний — відключенню це не заважає.
    }
  }

  await disconnect(auth.me.userId);
  return NextResponse.json({ ok: true });
}
