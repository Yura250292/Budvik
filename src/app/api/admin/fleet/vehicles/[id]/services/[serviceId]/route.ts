/** Правка й видалення запису журналу. */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/r2";
import { kyivDate } from "@/lib/date/kyiv";
import { fleetUser, inputError } from "../../../../common";
import { serviceData } from "../service-data";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; serviceId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;
  const { id, serviceId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Порожній запит" }, { status: 400 });

  let data: Record<string, unknown>;
  try {
    data = serviceData(body, kyivDate(new Date()), true);
  } catch (e) {
    return inputError(e);
  }

  const res = await prisma.vehicleService.updateMany({
    where: { id: serviceId, vehicleId: id },
    data: data as Prisma.VehicleServiceUpdateManyMutationInput,
  });
  if (res.count === 0) return NextResponse.json({ error: "Запис не знайдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;
  const { id, serviceId } = await params;

  const row = await prisma.vehicleService.findFirst({
    where: { id: serviceId, vehicleId: id },
    select: { receiptKey: true },
  });
  if (!row) return NextResponse.json({ error: "Запис не знайдено" }, { status: 404 });

  await prisma.vehicleService.delete({ where: { id: serviceId } });
  // Чек без запису нікому не потрібен; не вийшло прибрати — не страшно.
  if (row.receiptKey) await deleteFile(row.receiptKey).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
