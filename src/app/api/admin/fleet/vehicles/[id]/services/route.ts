/** Новий запис у журнал обслуговування машини. */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { fleetUser, inputError } from "../../../common";
import { serviceData } from "./service-data";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Порожній запит" }, { status: 400 });

  let data: Record<string, unknown>;
  try {
    data = serviceData(body, kyivDate(new Date()), false);
  } catch (e) {
    return inputError(e);
  }

  const vehicle = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
  if (!vehicle) return NextResponse.json({ error: "Машину не знайдено" }, { status: 404 });

  const created = await prisma.vehicleService.create({
    data: { ...(data as Omit<Prisma.VehicleServiceUncheckedCreateInput, "vehicleId">), vehicleId: id, createdById: user.id },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: created.id });
}
