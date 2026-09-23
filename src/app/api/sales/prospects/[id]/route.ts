/**
 * Точка для розпрацювання з карти торгового: уточнити місце або прив'язати
 * до контрагента 1С.
 *
 * Окремо від /api/admin/prospects/[id], бо там керівник править усе (назву,
 * статус, кому доручено), а торговий у полі робить рівно дві речі. Права ті
 * самі, що в пінів клієнтів: точки спільні, уточнює будь-хто з торгових —
 * розпрацьовує той, хто поруч.
 *
 * Прив'язка — це не «конверсія». Точка перестає бути ромбом лише тоді, коли в
 * її контрагента з'являється хоч одне замовлення від торгового (правило в
 * lib/prospects/converted.ts); до того видно ромб, а не кружок клієнта.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRoles, CABINET_ROLES } from "@/lib/app/identity";
import type { ProspectDetails } from "@/components/map/prospect-pin";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;
  const { id } = await params;

  const current = await prisma.prospectClient.findUnique({
    where: { id },
    select: { id: true, lat: true, lng: true, details: true, counterpartyId: true },
  });
  if (!current) return NextResponse.json({ error: "Точку не знайдено" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const details = { ...((current.details as ProspectDetails | null) ?? {}) } as Record<string, unknown>;

  // ── Уточнення місця ──────────────────────────────────────────────────────
  if (body && "lat" in body) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json({ error: "Потрібні координати lat і lng" }, { status: 400 });
    }
    const accuracyRaw = Number(body.accuracyM);
    // Слід польової роботи, як geoById/geoAt у клієнтів: хто, коли і чи на місці.
    details.precision = "MANUAL";
    details.geoById = me.userId;
    details.geoAt = new Date().toISOString();
    details.geoAccuracyM =
      Number.isFinite(accuracyRaw) && accuracyRaw > 0 ? Math.min(100000, Math.round(accuracyRaw)) : null;

    await prisma.prospectClient.update({
      where: { id },
      data: { lat, lng, details: details as Prisma.InputJsonValue },
    });
    // Уже прив'язаний контрагент без справжньої точки отримує цю: ромб і
    // майбутній кружок мусять стояти в одному місці.
    if (current.counterpartyId) await shareLocation(current.counterpartyId, lat, lng, "MANUAL", me.userId);
    return NextResponse.json({ id, lat, lng, precision: "MANUAL" });
  }

  // ── Прив'язка до контрагента 1С ──────────────────────────────────────────
  if (body && "counterpartyId" in body) {
    const counterpartyId = body.counterpartyId ? String(body.counterpartyId) : null;
    if (!counterpartyId) {
      await prisma.prospectClient.update({ where: { id }, data: { counterpartyId: null, status: "NEW" } });
      return NextResponse.json({ id, counterpartyId: null });
    }

    const cp = await prisma.counterparty.findUnique({ where: { id: counterpartyId }, select: { id: true, name: true } });
    if (!cp) return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });

    // counterpartyId унікальний: один контрагент — одна точка розпрацювання.
    const taken = await prisma.prospectClient.findFirst({
      where: { counterpartyId, NOT: { id } },
      select: { name: true },
    });
    if (taken) {
      return NextResponse.json(
        { error: `«${cp.name}» уже прив'язаний до іншої точки: ${taken.name}` },
        { status: 409 }
      );
    }

    details.linkedById = me.userId;
    details.linkedAt = new Date().toISOString();
    await prisma.prospectClient.update({
      where: { id },
      data: { counterpartyId, status: "IN_PROGRESS", details: details as Prisma.InputJsonValue },
    });

    const precision = (current.details as ProspectDetails | null)?.precision;
    await shareLocation(
      counterpartyId,
      current.lat,
      current.lng,
      precision === "MANUAL" ? "MANUAL" : precision === "CITY" ? "CITY" : "GEOCODED",
      me.userId
    );
    return NextResponse.json({ id, counterpartyId, counterpartyName: cp.name });
  }

  return NextResponse.json({ error: "Нічого змінювати" }, { status: 400 });
}

/**
 * Координати точки → контрагенту, лише якщо в нього гірші.
 *
 * Ручний пін контрагента не чіпаємо ніколи. Здогад до міста (CITY) чи
 * порожнечу замінюємо будь-чим кращим; GEOCODED — лише ручною точкою.
 * Сирий SQL — як у /api/admin/client-map: рівно колонки карти.
 */
async function shareLocation(
  counterpartyId: string,
  lat: number,
  lng: number,
  source: "MANUAL" | "GEOCODED" | "CITY",
  userId: string
) {
  const rank = { FAILED: 0, CITY: 1, GEOCODED: 2, MANUAL: 3 } as const;
  const [row] = await prisma.$queryRaw<Array<{ lat: number | null; geoSource: string | null }>>`
    SELECT "deliveryLat" AS lat, "geoSource"::text AS "geoSource" FROM "Counterparty" WHERE id = ${counterpartyId}`;
  if (!row) return;
  const have = row.lat == null ? -1 : rank[(row.geoSource ?? "GEOCODED") as keyof typeof rank] ?? 2;
  if (rank[source] <= have) return;
  await prisma.$executeRaw`
    UPDATE "Counterparty"
    SET "deliveryLat" = ${lat}, "deliveryLng" = ${lng},
        "geoSource" = ${source}::"GeoSource", "geoAttemptedAt" = NOW(),
        "geoById" = ${source === "MANUAL" ? userId : null},
        "geoAt" = ${source === "MANUAL" ? new Date() : null}
    WHERE id = ${counterpartyId}`;
}
