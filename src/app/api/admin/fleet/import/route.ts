/**
 * Перенесення машин із «Палива» в автопарк.
 *
 * У «Паливі» (SalesVehicle) в кожного торгового чи водія записано, на чому
 * він їздить, — вільним текстом і без історії. GET віддає кандидатів: людей
 * за кермом, за якими ще не закріплена жодна машина автопарку, з розбором
 * підпису й останнім одометром зі змін. POST створює машини, які людина
 * підтвердила (і, можливо, поправила), і відразу закріплює за людиною.
 *
 * Закріплення — з першої зміни людини, а не з сьогодні: інакше кілометраж
 * машини за минулі періоди був би нульовим, хоча людина їздила на ній і тоді.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma, type VehicleOwnership } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { parseVehicleLabel } from "@/lib/fleet/label";
import { FleetInputError, normalizePlate, optText, reqText } from "@/lib/fleet/input";
import { fleetUser, inputError } from "../common";

export const dynamic = "force-dynamic";

const DRIVING = ["SALES", "DRIVER"] as const;

export async function GET() {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;

  const people = await prisma.user.findMany({
    where: {
      role: { in: [...DRIVING] },
      vehicleAssignments: { none: { to: null } },
      OR: [{ salesVehicle: { isNot: null } }, { shifts: { some: {} } }],
    },
    select: {
      id: true,
      name: true,
      role: true,
      salesVehicle: { select: { label: true } },
    },
    orderBy: { name: "asc" },
  });
  const ids = people.map((p) => p.id);

  // Перша й остання зміна з одометром — звідки закріплювати і який пробіг зараз.
  const shifts = ids.length
    ? await prisma.$queryRaw<Array<{ userId: string; first: Date; last: Date; km: number | null; shifts: number }>>`
        SELECT s."userId",
               MIN(s."startedAt") AS first,
               MAX(COALESCE(s."endedAt", s."startedAt")) AS last,
               (ARRAY_AGG(COALESCE(s."endOdometer", s."startOdometer")
                  ORDER BY COALESCE(s."endedAt", s."startedAt") DESC)
                  FILTER (WHERE NOT s."odometerSuspicious"))[1] AS km,
               COUNT(*)::int AS shifts
        FROM "Shift" s
        WHERE s."userId" = ANY(${ids})
        GROUP BY s."userId"`
    : [];
  const byUser = new Map(shifts.map((s) => [s.userId, s]));

  return NextResponse.json({
    candidates: people.map((p) => {
      const s = byUser.get(p.id);
      return {
        userId: p.id,
        name: p.name,
        role: p.role,
        label: p.salesVehicle?.label ?? null,
        parsed: parseVehicleLabel(p.salesVehicle?.label),
        shifts: s?.shifts ?? 0,
        firstDay: s ? kyivDate(s.first) : null,
        odometerKm: s?.km ?? null,
        odometerDay: s?.km != null ? kyivDate(s.last) : null,
      };
    }),
  });
}

type Item = { userId?: unknown; make?: unknown; model?: unknown; plate?: unknown; ownership?: unknown };

export async function POST(req: NextRequest) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;

  const body = (await req.json().catch(() => null)) as { items?: Item[] } | null;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "Не вибрано жодної машини" }, { status: 400 });
  }

  try {
    const items = body.items.map((raw, i) => {
      const n = `Рядок ${i + 1}`;
      if (typeof raw.userId !== "string") throw new FleetInputError(`${n}: немає людини`);
      if (raw.ownership !== "COMPANY" && raw.ownership !== "PERSONAL") {
        throw new FleetInputError(`${n}: вкажіть, чия машина`);
      }
      const plateRaw = optText(raw.plate, "Номер", 20);
      return {
        userId: raw.userId,
        make: reqText(raw.make, `${n}: марка`, 60),
        model: optText(raw.model, "Модель", 60) ?? "—",
        plate: plateRaw ? normalizePlate(plateRaw) : null,
        ownership: raw.ownership as VehicleOwnership,
      };
    });

    const plates = items.map((i) => i.plate).filter(Boolean);
    if (new Set(plates).size !== plates.length) throw new FleetInputError("Один номер у двох рядках");

    const ids = items.map((i) => i.userId);
    const [people, busy, firsts] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids }, role: { in: [...DRIVING] } }, select: { id: true } }),
      prisma.vehicleAssignment.findMany({ where: { userId: { in: ids }, to: null }, select: { userId: true } }),
      prisma.shift.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _min: { startedAt: true } }),
    ]);
    if (people.length !== new Set(ids).size) throw new FleetInputError("Серед вибраних є не торговий і не водій");
    if (busy.length) throw new FleetInputError("За деким уже закріплена машина — оновіть сторінку");
    const firstOf = new Map(firsts.map((f) => [f.userId, f._min.startedAt]));
    const today = kyivDayStart(kyivDate(new Date()));

    const created = await prisma.$transaction(
      items.map((i) =>
        prisma.vehicle.create({
          data: {
            plate: i.plate,
            make: i.make,
            model: i.model,
            ownership: i.ownership,
            assignments: {
              create: { userId: i.userId, from: kyivDayStart(kyivDate(firstOf.get(i.userId) ?? today)) },
            },
          },
          select: { id: true },
        })
      )
    );
    return NextResponse.json({ ok: true, created: created.length });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Машина з одним із цих номерів уже є в автопарку" }, { status: 409 });
    }
    return inputError(e);
  }
}
