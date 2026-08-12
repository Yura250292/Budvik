/**
 * Точки для розпрацювання: майбутні клієнти, нанесені на карту вручну.
 *
 * Це не контрагенти: у 1С їх немає й бути не мусить, поки вони нічого не
 * купили. Тримаємо окремо, щоб не засмічувати довідник і не зіткнутися
 * з обміном.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const all = new URL(req.url).searchParams.get("status") === "all";
  const prospects = await prisma.prospectClient.findMany({
    where: all ? {} : { status: { in: ["NEW", "IN_PROGRESS"] } },
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
  });

  return NextResponse.json({ prospects, canEdit: true });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);

  if (!name) {
    return NextResponse.json({ error: "Потрібна назва точки" }, { status: 400 });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Потрібні координати на карті" }, { status: 400 });
  }

  const created = await prisma.prospectClient.create({
    data: {
      name,
      lat,
      lng,
      address: body?.address?.trim() || null,
      notes: body?.notes?.trim() || null,
      assignedRepId: body?.assignedRepId || null,
      createdById: session.user.id,
    },
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
  });

  return NextResponse.json(created, { status: 201 });
}
