/**
 * Пересадити: хто їздить на машині з певного дня.
 *
 * Поточне закріплення закривається тим самим днем, нове відкривається з
 * нього. Людина за раз їздить на одній машині: якщо вона була закріплена
 * за іншою, те закріплення теж закривається — інакше її зміни рахувалися б
 * у пробіг обох машин. userId=null — машина стоїть без водія.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { FleetInputError, reqDay } from "@/lib/fleet/input";
import { fleetUser, inputError } from "../../../common";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { userId?: string | null; day?: string } | null;
  if (!body) return NextResponse.json({ error: "Порожній запит" }, { status: 400 });

  try {
    const day = reqDay(body.day ?? kyivDate(new Date()), "З якого дня", kyivDate(new Date()));
    const at = kyivDayStart(day);
    const userId = body.userId || null;

    const vehicle = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
    if (!vehicle) return NextResponse.json({ error: "Машину не знайдено" }, { status: 404 });

    if (userId) {
      const person = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!person || !["SALES", "DRIVER"].includes(person.role)) {
        throw new FleetInputError("Закріпити можна торгового або водія");
      }
    }

    const open = await prisma.vehicleAssignment.findMany({
      where: { to: null, OR: [{ vehicleId: id }, ...(userId ? [{ userId }] : [])] },
      select: { id: true, from: true, vehicleId: true, userId: true },
    });
    if (open.some((a) => a.vehicleId === id && a.userId === userId)) {
      throw new FleetInputError("Ця людина вже їздить на цій машині");
    }
    if (open.some((a) => a.from > at)) {
      throw new FleetInputError("Дата раніша за початок поточного закріплення");
    }

    await prisma.$transaction([
      ...open.map((a) => prisma.vehicleAssignment.update({ where: { id: a.id }, data: { to: at } })),
      ...(userId ? [prisma.vehicleAssignment.create({ data: { vehicleId: id, userId, from: at } })] : []),
    ]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return inputError(e);
  }
}
