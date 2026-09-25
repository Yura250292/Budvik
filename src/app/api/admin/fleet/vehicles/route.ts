/**
 * Автопарк: список машин зі зведенням (пробіг, ТО, витрати, амортизація) і
 * додавання нової машини.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fleetOverview } from "@/lib/fleet/overview";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { fleetUser, inputError } from "../common";
import { vehicleData } from "./vehicle-data";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const [overview, people] = await Promise.all([
    fleetOverview({
      includeInactive: sp.get("all") === "1",
      from: from && DAY_RE.test(from) ? kyivDayStart(from) : undefined,
      to: to && DAY_RE.test(to) ? kyivDayEnd(to) : undefined,
    }),
    // Кого можна закріпити за машиною: ті, хто за кермом.
    prisma.user.findMany({
      where: { role: { in: ["SALES", "DRIVER"] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return NextResponse.json({ ...overview, people });
}

export async function POST(req: NextRequest) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Порожній запит" }, { status: 400 });

  let data: ReturnType<typeof vehicleData>;
  try {
    data = vehicleData(body, kyivDate(new Date()), false);
  } catch (e) {
    return inputError(e);
  }

  try {
    const vehicle = await prisma.vehicle.create({
      data: data as Prisma.VehicleCreateInput,
      select: { id: true },
    });
    return NextResponse.json({ ok: true, id: vehicle.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Машина з таким номером уже є" }, { status: 409 });
    }
    throw e;
  }
}
