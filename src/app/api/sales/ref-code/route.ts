import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureRefCode } from "@/lib/ref-code";

/**
 * QR-лінк торгового і його приведені клієнти.
 *
 * Окремий роут, а не дані на сторінці /sales/catalog: та сторінка
 * кешується на годину (revalidate = 3600), тож персональний код у неї
 * не покласти — дістався б чужий.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = session.user.role;
  if (role !== "SALES" && role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const code = await ensureRefCode(session.user.id);

  /**
   * Домен беремо з NEXTAUTH_URL, а не з origin запиту: QR друкують і
   * показують з планшета, де origin може бути внутрішньою адресою
   * WebView — клієнт відсканував би непрацюючий лінк.
   */
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "");

  const [referredCount, recentClients] = await Promise.all([
    prisma.user.count({ where: { referredBySalesRepId: session.user.id } }),
    prisma.user.findMany({
      where: { referredBySalesRepId: session.user.id },
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
