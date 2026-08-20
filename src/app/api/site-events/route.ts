/**
 * Прийом пачки подій вебаналітики з браузера покупця.
 *
 * Публічний роут без перевірки ролі: події шле кожен відвідувач, зокрема
 * не залогінений. Замість авторизації — стелі на все, що приходить
 * ззовні: розмір тіла, кількість подій, довжина кожного рядка й білий
 * список типів. Найгірше, що дає спам у цей ендпоінт, — сміття в
 * SiteEvent, яке чиститься нічним cron.
 *
 * Назва шляху навмисно без слів analytics/track/stats: блокувальники
 * реклами ріжуть їх за патерном URL.
 *
 * Service worker пачці не заважає: public/sw.js обробляє лише GET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { REF_COOKIE } from "@/lib/ref-code";
import {
  EVENT_TYPES,
  isBotUserAgent,
  parseDevice,
  parseBrowser,
  parseGeo,
  clip,
  clampInt,
  refererHost,
} from "@/lib/webstats/server";

export const dynamic = "force-dynamic";

/** Стеля на пачку: клієнт шле до 50, більше — це вже не браузер. */
const MAX_BATCH = 50;
/** Тіло більше 50 КБ не буває навіть при повній черзі — не читаємо далі. */
const MAX_BODY_BYTES = 50_000;

interface RawEvent {
  t?: unknown;
  path?: unknown;
  productId?: unknown;
  query?: unknown;
  label?: unknown;
  value?: unknown;
  referrer?: unknown;
}

export async function POST(req: NextRequest) {
  const ua = req.headers.get("user-agent");

  // Ботам відповідаємо так само спокійно, як людям, але нічого не пишемо:
  // 204 не дає підказки, що запит відсіяли, і не провокує ретраї.
  if (isBotUserAgent(ua)) {
    return new NextResponse(null, { status: 204 });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Завелике тіло запиту" }, { status: 413 });
  }

  let body: { vid?: unknown; sid?: unknown; events?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const visitorId = clip(body.vid, 60);
  const sessionId = clip(body.sid, 60);
  if (!visitorId || !sessionId) {
    return NextResponse.json({ error: "Немає ідентифікаторів" }, { status: 400 });
  }

  const raw = Array.isArray(body.events) ? (body.events as RawEvent[]) : [];
  if (raw.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  /**
   * Хто це, якщо залогінений.
   *
   * getServerSession тут дешевий: стратегія JWT, тож це розбір куки без
   * походу в базу. Роут не кешується, тому читання cookies йому не
   * шкодить — на відміну від сторінок каталогу.
   */
  let userId: string | null = null;
  try {
    const session = await getServerSession(authOptions);
    userId = session?.user?.id ?? null;
  } catch {
    // Побита кука сесії не повинна коштувати нам усієї пачки подій.
  }

  const device = parseDevice(ua);
  const browser = parseBrowser(ua);
  const { country, city } = parseGeo(req.headers);
  const refCode = clip(req.cookies.get(REF_COOKIE)?.value, 16);

  // Зайве відрізаємо, а не відхиляємо весь запит: втратити хвіст пачки
  // краще, ніж усю пачку через одну криву подію.
  const data = raw
    .slice(0, MAX_BATCH)
    .filter((e): e is RawEvent => Boolean(e) && typeof e === "object")
    .map((e) => {
      const type = clip(e.t, 40);
      if (!type || !EVENT_TYPES.has(type as never)) return null;
      return {
        visitorId,
        sessionId,
        userId,
        type,
        path: clip(e.path, 300),
        productId: clip(e.productId, 60),
        // Запити зводимо до нижнього регістру ще на вході: інакше
        // «Дриль» і «дриль» у звіті будуть двома різними рядками.
        query: clip(e.query, 120)?.toLowerCase() ?? null,
        label: clip(e.label, 120),
        value: clampInt(e.value),
        referrer: refererHost(e.referrer),
        refCode,
        device,
        browser,
        country,
        city,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  if (data.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    await prisma.siteEvent.createMany({ data });
  } catch (e) {
    // Аналітика не має права ламати досвід покупця: логуємо й мовчимо.
    console.error("[site-events] не вдалося записати пачку", e);
  }

  // sendBeacon відповідь однаково ігнорує — не витрачаємось на тіло.
  return new NextResponse(null, { status: 204 });
}
