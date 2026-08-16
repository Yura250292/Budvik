import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findSalesRepByRefCode, REF_COOKIE, REF_COOKIE_MAX_AGE } from "@/lib/ref-code";

/**
 * Вхідна точка QR-коду торгового: запам'ятовує, хто привів клієнта,
 * і веде його в каталог.
 *
 * Роут, а не сторінка: показувати тут нема чого, вся робота — кука
 * і редірект. Невалідний код теж веде в каталог мовчки — клієнт не має
 * впиратися в помилку через те, що торговий дав старий QR.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  /**
   * Відносний Location замість NextResponse.redirect: той вимагає
   * абсолютний URL і бере origin з req.nextUrl, а за проксі на проді
   * (і в WebView планшета) origin розходиться з реальним доменом —
   * та сама пастка, що в /api/device/session.
   */
  const res = new NextResponse(null, {
    status: 302,
    headers: { Location: "/catalog", "Cache-Control": "no-store" },
  });

  const rep = await findSalesRepByRefCode(code);
  if (!rep) return res;

  /**
   * Перший виграє: якщо кука вже стоїть, іншим QR її не перебити.
   * Інакше конкурент, чий QR клієнт відкрив другим, забирав би собі
   * чужу роботу.
   */
  if (!req.cookies.get(REF_COOKIE)) {
    res.cookies.set(REF_COOKIE, code.trim().toUpperCase(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // має пережити редіректи Google OAuth
      path: "/",
      maxAge: REF_COOKIE_MAX_AGE,
    });
  }

  /**
   * Клієнт уже зареєстрований і ще нічий — закріплюємо одразу, не чекаючи
   * замовлення. updateMany з умовою referredBySalesRepId: null робить це
   * атомарно: вже прив'язаного клієнта запит просто не зачепить.
   */
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (userId && userId !== rep.id) {
    await prisma.user.updateMany({
      where: { id: userId, referredBySalesRepId: null, role: "CLIENT" },
      data: { referredBySalesRepId: rep.id },
    });
  }

  return res;
}
