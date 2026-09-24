/**
 * Бекфіл координат клієнтів для карти.
 *
 * Nominatim просить не частіше запиту на секунду, а безнадійна адреса
 * з'їдає до шести спроб — тобто півтори тисячі адрес це години. Тому
 * ендпоінт не намагається зробити все за раз: він працює до дедлайну,
 * повертає `remaining`, а вкладка смикає його по колу. Перерваний запуск
 * нічого не втрачає — прогрес лежить у самій таблиці.
 *
 * geoAttemptedAt ставиться і на провал теж: без цього кожен наступний
 * прохід знову витрачав би шість запитів на ту саму адресу, яку
 * Nominatim не знає, і бекфіл ніколи б не дійшов до кінця.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { locateClient } from "@/lib/geo/locate-client";

export const dynamic = "force-dynamic";
/** Nominatim повільний; за 60 с встигаємо кілька десятків адрес, далі новий запит. */
export const maxDuration = 60;

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

/**
 * Лишаємо запас до ліміту Vercel, щоб встигнути записати результат. Запас
 * великий: безнадійна адреса перебирає всі стратегії й займає до ~30 с.
 */
const DEADLINE_MS = 25_000;
const HARD_CAP = 40;

/**
 * Кандидати — клієнти, які взагалі можуть з'явитися на карті: ті, за ким
 * закріплений торговий, або ті, у кого є відвантаження. Решту трьох тисяч
 * контрагентів (роздріб, разові покупці) геокодувати немає сенсу — вони
 * все одно не потрапляють у портфель.
 */
const CANDIDATE_SCOPE = Prisma.sql`
  c."isActive"
  AND COALESCE(c.address, '') <> ''
  AND (
    EXISTS (SELECT 1 FROM "SalesRepClient" src WHERE src."counterpartyId" = c.id)
    OR EXISTS (
      SELECT 1 FROM "SalesDocument" s
      WHERE s."counterpartyId" = c.id
        AND s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
    )
  )
`;

type Progress = {
  candidates: number;
  geocoded: number;
  failed: number;
  pending: number;
};

async function progress(): Promise<Progress> {
  const [row] = await prisma.$queryRaw<
    Array<{ candidates: number; geocoded: number; failed: number; pending: number }>
  >`
    SELECT
      COUNT(*)::int AS candidates,
      COUNT(*) FILTER (WHERE c."deliveryLat" IS NOT NULL)::int AS geocoded,
      COUNT(*) FILTER (WHERE c."geoSource" = 'FAILED')::int AS failed,
      COUNT(*) FILTER (WHERE c."deliveryLat" IS NULL AND c."geoAttemptedAt" IS NULL)::int AS pending
    FROM "Counterparty" c
    WHERE ${CANDIDATE_SCOPE}
  `;
  return row ?? { candidates: 0, geocoded: 0, failed: 0, pending: 0 };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }
  return NextResponse.json(await progress());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const retryFailed = body?.retryFailed === true;

  // MANUAL не чіпаємо ніколи: виправлений рукою пін важливіший за будь-що,
  // що поверне геокодер.
  const pendingFilter = retryFailed
    ? Prisma.sql`c."deliveryLat" IS NULL AND (c."geoAttemptedAt" IS NULL OR c."geoSource" = 'FAILED')`
    : Prisma.sql`c."deliveryLat" IS NULL AND c."geoAttemptedAt" IS NULL`;

  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; address: string }>>`
    SELECT c.id, c.name, c.address
    FROM "Counterparty" c
    WHERE ${CANDIDATE_SCOPE} AND ${pendingFilter}
    ORDER BY c.name
    LIMIT ${HARD_CAP}
  `;

  const startedAt = Date.now();
  let processed = 0;
  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    if (Date.now() - startedAt > DEADLINE_MS) break;

    // Точність — у geoSource: будинок → GEOCODED, вулиця чи центр пункту →
    // CITY (див. locateClient). Населений пункт із назви клієнта теж там.
    let hit;
    try {
      hit = await locateClient(row.address, row.name);
    } catch (e) {
      // Google відмовив (вимкнений API, ліміт) — зупиняємось, а не пишемо
      // сотні «центрів міста» там, де він знайшов би будинок.
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e), processed, ok, failed },
        { status: 502 }
      );
    }

    processed += 1;
    if (hit) {
      ok += 1;
      await prisma.$executeRaw`
        UPDATE "Counterparty"
        SET "deliveryLat" = ${hit.lat}, "deliveryLng" = ${hit.lng},
            "geoSource" = ${hit.geoSource}::"GeoSource", "geoAttemptedAt" = NOW()
        WHERE id = ${row.id}`;
    } else {
      failed += 1;
      await prisma.$executeRaw`
        UPDATE "Counterparty"
        SET "geoSource" = 'FAILED', "geoAttemptedAt" = NOW()
        WHERE id = ${row.id}`;
    }
  }

  const after = await progress();

  return NextResponse.json({
    processed,
    ok,
    failed,
    // Скільки ще лишилось у цьому режимі: вкладка крутить цикл, поки не 0.
    remaining: retryFailed ? after.pending + after.failed : after.pending,
    progress: after,
  });
}
