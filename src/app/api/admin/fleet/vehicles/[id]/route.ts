/**
 * Картка машини: зведення, повний журнал, правила ТО, історія закріплень.
 *
 * Видалення машини немає навмисно: разом із нею зникла б історія замін.
 * Продану чи списану машину знімають з обліку прапорцем active.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fleetOverview } from "@/lib/fleet/overview";
import { KIND_LABEL } from "@/lib/fleet/kinds";
import { kyivDate } from "@/lib/date/kyiv";
import { fleetUser, inputError } from "../../common";
import { vehicleData } from "../vehicle-data";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  const [overview, services, assignments] = await Promise.all([
    fleetOverview({ vehicleIds: [id], includeInactive: true }),
    prisma.vehicleService.findMany({
      where: { vehicleId: id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.vehicleAssignment.findMany({
      where: { vehicleId: id },
      orderBy: { from: "desc" },
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  const vehicle = overview.vehicles[0];
  if (!vehicle) return NextResponse.json({ error: "Машину не знайдено" }, { status: 404 });

  return NextResponse.json({
    vehicle,
    services: services.map((s) => ({
      id: s.id,
      day: kyivDate(s.date),
      odometerKm: s.odometerKm,
      kind: s.kind,
      kindLabel: KIND_LABEL[s.kind],
      title: s.title,
      partsCost: s.partsCost,
      laborCost: s.laborCost,
      total: s.partsCost + s.laborCost,
      vendor: s.vendor,
      notes: s.notes,
      hasReceipt: !!s.receiptKey,
      createdBy: s.createdBy?.name ?? null,
    })),
    assignments: assignments.map((a) => ({
      id: a.id,
      userId: a.user.id,
      name: a.user.name,
      from: kyivDate(a.from),
      to: a.to ? kyivDate(a.to) : null,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Порожній запит" }, { status: 400 });

  let data: Record<string, unknown>;
  try {
    data = vehicleData(body, kyivDate(new Date()), true);
  } catch (e) {
    return inputError(e);
  }

  try {
    await prisma.vehicle.update({ where: { id }, data: data as Prisma.VehicleUpdateInput });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return NextResponse.json({ error: "Машина з таким номером уже є" }, { status: 409 });
      if (e.code === "P2025") return NextResponse.json({ error: "Машину не знайдено" }, { status: 404 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}
