import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureRefCode } from "@/lib/ref-code";
import { requireRoles } from "@/lib/app/identity";

/**
 * QR-лінк торгового і його приведені клієнти.
 *
 * Окремий роут, а не дані на сторінці /sales/catalog: та сторінка
 * кешується на годину (revalidate = 3600), тож персональний код у неї
 * не покласти — дістався б чужий.
 */
export async function GET(req: Request) {
  const auth = await requireRoles(req, ["SALES", "ADMIN"]);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const role = me.role;
  if (role !== "SALES" && role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const code = await ensureRefCode(me.userId);

  /**
   * Домен беремо з NEXTAUTH_URL, а не з origin запиту: QR друкують і
   * показують з планшета, де origin може бути внутрішньою адресою
   * WebView — клієнт відсканував би непрацюючий лінк.
   */
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "");

  const [referredCount, recentClients] = await Promise.all([
    prisma.user.count({ where: { referredBySalesRepId: me.userId } }),
    prisma.user.findMany({
      where: { referredBySalesRepId: me.userId },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return NextResponse.json({
    code,
    url: `${base}/r/${code}`,
    referredCount,
    recentClients,
  });
}
