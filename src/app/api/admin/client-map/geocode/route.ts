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
import { geocodeAddress } from "@/lib/geo/nominatim";

export const dynamic = "force-dynamic";
/** Nominatim повільний; за 60 с встигаємо ~40 адрес, далі новий запит. */
export const maxDuration = 60;

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

/** Лишаємо запас до ліміту Vercel, щоб встигнути записати результат. */
const DEADLINE_MS = 45_000;
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

/**
 * Населений пункт із назви клієнта: «Мартинець Уляна (м.Мостиська)».
 *
 * У дужках буває й вулиця — «DNIPRO-M ЛЬВІВ (Джорджа Вашингтона, 1)», —
 * тому беремо лише те, що позначене як населений пункт (м./с./смт) або
 * складається з одного слова без цифр. Інакше геокодер шукав би вулицю
 * без міста й ставив пін у випадковій області: рівно так маршрут колись
 * вийшов 837 км замість 150.
 *
 * Область додається завжди: однойменних сіл в Україні десятки.
 */
const HOME_REGION = "Львівська область";

function settlementFromName(name: string): string | null {
  const inside = name.match(/\(([^)]*)\)/)?.[1]?.trim();
  if (!inside) return null;

  const prefixed = inside.match(/(?:^|\s)(?:м|с|смт)\.?\s*([А-ЯЇІЄҐA-Z][^,;]*)/iu)?.[1]?.trim();
  const candidate =
    prefixed ?? (!/\d/.test(inside) && !inside.includes(",") && inside.split(/\s+/).length === 1 ? inside : null);

  if (!candidate || candidate.length < 3) return null;
  return `${candidate}, ${HOME_REGION}, Україна`;
}

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

    let hit = await geocodeAddress(row.address);

    // Запасний варіант: у назві клієнта майже завжди є населений пункт —
    // «Мартинець Уляна (м.Мостиська)». Точка в правильному місті корисніша
    // за відсутність точки: торговий бачить, куди їхати, а пін потім можна
    // поправити рукою.
    if (!hit) {
      const fallback = settlementFromName(row.name);
      if (fallback) hit = await geocodeAddress(fallback);
    }

    processed += 1;
    if (hit) {
      ok += 1;
      await prisma.$executeRaw`
        UPDATE "Counterparty"
        SET "deliveryLat" = ${hit.lat}, "deliveryLng" = ${hit.lng},
            "geoSource" = 'GEOCODED', "geoAttemptedAt" = NOW()
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
