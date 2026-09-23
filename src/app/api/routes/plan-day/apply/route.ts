/**
 * Застосувати план: чернетки маршрутів на день.
 *
 * Створює рівно те, що менеджер бачив на екрані, — жодного перерахунку.
 * Якщо між «порахувати» і «застосувати» щось змінилося (документ уже
 * потрапив у лист 1С), такий документ пропускаємо й називаємо його: мовчки
 * створити маршрут з половиною точок гірше, ніж сказати правду.
 *
 * Статус PLANNED: водій чернетки не бачить. Передача — окрема дія
 * (`/api/erp/delivery-routes/[id]/assign`), і вона лишається за людиною.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";
import { getNextDocumentNumber } from "@/lib/erp/document-numbers";

export const dynamic = "force-dynamic";

type ApplyRoute = {
  driverId: string;
  salesDocumentIds: string[];
  distanceKm?: number | null;
  geometry?: unknown;
};

/**
 * Геометрія маршруту — або справжній LineString, або нічого.
 *
 * Перевірка сувора саме тут, бо це єдине місце підсистеми, яке пише в базу,
 * а значення приходить у тілі запиту, тобто з-за меж нашого коду. Каст без
 * перевірки пропустив би будь-який об'єкт чи масив, і крива геометрія
 * виявилася б лише тоді, коли планшет водія спробує намалювати лінію.
 *
 * Маршрут без лінії — стан робочий: карта покаже пунктир по прямій.
 */
function lineStringOrNothing(value: unknown): Prisma.InputJsonValue | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) return undefined;
  return value as Prisma.InputJsonValue;
}

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const body = (await req.json()) as { date?: string; routes?: ApplyRoute[] };
  if (!body.date) return NextResponse.json({ error: "Вкажіть дату" }, { status: 400 });
  if (!body.routes?.length) return NextResponse.json({ error: "Немає маршрутів для створення" }, { status: 400 });

  const allIds = body.routes.flatMap((r) => r.salesDocumentIds);

  // Хто вже поїхав, поки менеджер дивився на екран.
  const taken = new Set<string>();
  for (const row of await prisma.routeSheetStop.findMany({
    where: { salesDocumentId: { in: allIds }, hidden: false },
    select: { salesDocumentId: true },
  })) {
    if (row.salesDocumentId) taken.add(row.salesDocumentId);
  }
  for (const row of await prisma.deliveryStop.findMany({
    where: { salesDocumentId: { in: allIds } },
    select: { salesDocumentId: true },
  })) {
    if (row.salesDocumentId) taken.add(row.salesDocumentId);
  }

  const skipped: string[] = [];
  const created: Array<{ id: string; number: string; driverId: string; stops: number }> = [];

  for (const r of body.routes) {
    const ids = r.salesDocumentIds.filter((id) => {
      if (taken.has(id)) {
        skipped.push(id);
        return false;
      }
      return true;
    });
    if (ids.length === 0) continue;

    const docs = await prisma.salesDocument.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        counterpartyId: true,
        counterparty: { select: { address: true, deliveryAddress: true } },
      },
    });
    const byId = new Map(docs.map((d) => [d.id, d]));

    const number = await getNextDocumentNumber("DR");

    let route: { id: string; number: string; stops: number };
    try {
      route = await prisma.$transaction(async (tx) => {
        const createdRoute = await tx.deliveryRoute.create({
          data: {
            number,
            driverId: r.driverId,
            date: new Date(body.date!),
            status: "PLANNED",
            totalDistanceKm: r.distanceKm ?? null,
            routeGeometry: lineStringOrNothing(r.geometry),
            createdById: me.userId,
            notes: "Склав помічник",
          },
        });

        let sequence = 0;
        for (const id of ids) {
          const doc = byId.get(id);
          if (!doc) continue;
          sequence += 1;
          await tx.deliveryStop.create({
            data: {
              deliveryRouteId: createdRoute.id,
              salesDocumentId: doc.id,
              counterpartyId: doc.counterpartyId,
              sequence,
              address: doc.counterparty?.deliveryAddress || doc.counterparty?.address || null,
            },
          });
        }

        return { id: createdRoute.id, number: createdRoute.number, stops: sequence };
      });
    } catch (e) {
      /*
       * DeliveryStop.salesDocumentId унікальний, тож два одночасні натиски
       * «Створити маршрути» з тим самим документом не задублять точку —
       * другий просто впаде. Без цієї гілки людина бачила б голий 500
       * замість пояснення, що маршрут уже створив хтось інший.
       */
      const message = e instanceof Error && e.message.includes("Unique constraint")
        ? "Частину цих документів щойно розібрав хтось інший — складіть план заново"
        : "Не вдалося створити маршрут";
      return NextResponse.json({ error: message, created, skipped }, { status: 409 });
    }

    created.push({ ...route, driverId: r.driverId });
  }

  return NextResponse.json({ created, skipped });
}
