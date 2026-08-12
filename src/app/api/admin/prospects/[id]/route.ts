/**
 * Редагування та видалення точки для розпрацювання.
 *
 * Прив'язка counterpartyId означає, що точку відкрили як клієнта — статус
 * при цьому виставляється сам, щоб на карті не лишалося «нових» точок,
 * які насправді вже стали контрагентами.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];
const STATUSES = ["NEW", "IN_PROGRESS", "CONVERTED", "REJECTED"] as const;

type ProspectUpdate = {
  name?: string;
  address?: string | null;
  notes?: string | null;
  lat?: number;
  lng?: number;
  assignedRepId?: string | null;
  counterpartyId?: string | null;
  status?: (typeof STATUSES)[number];
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Порожній запит" }, { status: 400 });
  }

  const data: ProspectUpdate = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "Потрібна назва точки" }, { status: 400 });
    data.name = name;
  }
  if (body.address !== undefined) data.address = String(body.address).trim() || null;
  if (body.notes !== undefined) data.notes = String(body.notes).trim() || null;
  if (body.assignedRepId !== undefined) data.assignedRepId = body.assignedRepId || null;

  if (body.lat !== undefined || body.lng !== undefined) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "Потрібні координати lat і lng" }, { status: 400 });
    }
    data.lat = lat;
    data.lng = lng;
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Невідомий статус" }, { status: 400 });
    }
    data.status = body.status;
  }

  if (body.counterpartyId !== undefined) {
    data.counterpartyId = body.counterpartyId || null;
    // Прив'язали контрагента — точку розпрацьовано, хай там що прислали.
    if (body.counterpartyId) data.status = "CONVERTED";
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нема що змінювати" }, { status: 400 });
  }

  const exists = await prisma.prospectClient.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "Точку не знайдено" }, { status: 404 });
  }

  const updated = await prisma.prospectClient.update({
    where: { id },
    data,
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

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  const exists = await prisma.prospectClient.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "Точку не знайдено" }, { status: 404 });
  }

  await prisma.prospectClient.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
