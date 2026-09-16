import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findSalesRepByRefCode, REF_COOKIE, REF_COOKIE_MAX_AGE } from "@/lib/ref-code";
import { CLICK_GRACE_MS, isLinkToken, isPreviewAgent, safeCatalogTarget } from "@/lib/outreach/links";

/**
 * Вхідна точка QR-коду торгового: запам'ятовує, хто привів клієнта,
 * і веде його в каталог.
 *
 * Роут, а не сторінка: показувати тут нема чого, вся робота — кука
 * і редірект. Невалідний код теж веде в каталог мовчки — клієнт не має
 * впиратися в помилку через те, що торговий дав старий QR.
 *
 * Те саме посилання стоїть і в пропозиції клієнту (src/lib/outreach):
 * `?to=/catalog/<slug>` веде одразу на товар, `&o=<токен>` позначає, що
 * клієнт повідомлення відкрив.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  /**
   * Відносний Location замість NextResponse.redirect: той вимагає
   * абсолютний URL і бере origin з req.nextUrl, а за проксі на проді
   * (і в WebView планшета) origin розходиться з реальним доменом —
   * та сама пастка, що в /api/device/session.
   *
   * `to` — лише каталог або товар (safeCatalogTarget): інакше посилання з
   * нашим доменом стало б відкритим редіректом на будь-який сайт.
   */
  const res = new NextResponse(null, {
    status: 302,
    headers: { Location: safeCatalogTarget(req.nextUrl.searchParams.get("to")), "Cache-Control": "no-store" },
  });

  const session = await getServerSession(authOptions);
  const sessionUser = session?.user as { id?: string; role?: string } | undefined;

  const token = req.nextUrl.searchParams.get("o");
  if (isLinkToken(token)) await markOutreachOpened(token, req, sessionUser?.role);

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
  const userId = sessionUser?.id;
  if (userId && userId !== rep.id) {
    await prisma.user.updateMany({
      where: { id: userId, referredBySalesRepId: null, role: "CLIENT" },
      data: { referredBySalesRepId: rep.id },
    });
  }

  return res;
}

/**
 * «Клієнт відкрив пропозицію» — перше відкриття, і лише людиною.
 *
 * Не рахуємо: персонал (торговий перевіряє своє ж посилання у WebView), ботів
 * прев'ю (Telegram і WhatsApp тягнуть сторінку в мить відправки) і першу
 * хвилину після збереження — прев'ю Viber іде з пристрою відправника і
 * звичайним браузером. Помилка тут редірект не ламає: клієнт має потрапити в
 * каталог, навіть якщо позначка не записалась (скажімо, до міграції таблиці).
 */
async function markOutreachOpened(token: string, req: NextRequest, role: string | undefined): Promise<void> {
  if (role && role !== "CLIENT") return;
  if (isPreviewAgent(req.headers.get("user-agent"))) return;
  try {
    const now = new Date();
    await prisma.clientOutreach.updateMany({
      where: { linkToken: token, clickedAt: null, sentAt: { lt: new Date(now.getTime() - CLICK_GRACE_MS) } },
      data: { clickedAt: now },
    });
  } catch (e) {
    console.error("[r] не вдалося позначити відкриття пропозиції:", e);
  }
}
