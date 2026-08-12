/**
 * Карта клієнтів: точки зі станом активності + точки для розпрацювання.
 *
 * Одна відповідь на всю вкладку, бо всі три набори (клієнти, ті, що не
 * лягли на карту, і проспекти) міряються одним періодом і мають
 * оновлюватися разом: інакше після геокодування чи додавання точки
 * лічильники покриття розійшлися б із тим, що видно на мапі.
 *
 * Фільтри за торговим і станом навмисно лишені клієнту: набір невеликий
 * (сотні точок), а перемикання легенди мусить бути миттєвим, без запиту.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";
import { clientPortfolioAll } from "@/lib/analytics/clients";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const period = parsePeriod(url.searchParams);
  const allProspects = url.searchParams.get("prospects") === "all";

  const [portfolio, prospectRows, repRows] = await Promise.all([
    clientPortfolioAll(period),
    prisma.prospectClient.findMany({
      where: allProspects ? {} : { status: { in: ["NEW", "IN_PROGRESS"] } },
      select: {
        id: true,
        name: true,
        address: true,
        lat: true,
        lng: true,
        notes: true,
        status: true,
        createdAt: true,
        assignedRep: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Торгові для фільтра: ті, за ким закріплені клієнти, плюс ті, хто
    // веде документи. Один список — інакше у фільтрі бракувало б людини,
    // яка продає, але формально клієнтів за нею не закріплено.
    prisma.user.findMany({
      where: {
        OR: [{ salesRepClients: { some: {} } }, { salesRepSales: { some: {} } }],
        role: { in: ["SALES", "MANAGER", "ADMIN"] },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const mapped = portfolio.clients.filter((c) => c.lat != null && c.lng != null);
  const unmapped = portfolio.clients.filter((c) => c.lat == null || c.lng == null);

  return NextResponse.json({
    canEdit: true,
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    clients: mapped,
    // Без координат: список видно у вкладці, щоб було ясно, кого бракує
    // на карті й чому — порожня адреса чи провалене геокодування.
    unmapped: unmapped.map((c) => ({
      counterpartyId: c.counterpartyId,
      name: c.name,
      address: c.address,
      state: c.state,
      amount: c.amount,
      geoSource: c.geoSource,
      reps: c.reps,
    })),
    prospects: prospectRows.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      notes: p.notes,
      status: p.status,
      assignedRep: p.assignedRep,
      createdAt: p.createdAt.toISOString(),
    })),
    reps: repRows,
    counts: portfolio.counts,
    coverage: {
      classified: portfolio.clients.length,
      mapped: mapped.length,
      noAddress: unmapped.filter((c) => !c.address?.trim()).length,
      geoFailed: unmapped.filter((c) => c.geoSource === "FAILED").length,
      // Скільки точок стоять у центрі населеного пункту, а не на адресі:
      // без цієї цифри карта виглядає точнішою, ніж вона є.
      cityOnly: mapped.filter((c) => c.geoSource === "CITY").length,
      exact: mapped.filter((c) => c.geoSource === "MANUAL").length,
    },
  });
}
