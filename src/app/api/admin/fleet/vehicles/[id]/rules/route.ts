/**
 * Регламент ТО машини: список правил цілком, як у формі.
 *
 * Одне правило на вид робіт (@@unique vehicleId+kind). Правило без км і без
 * місяців нічого не нагадує — таке відкидаємо з поясненням.
 */

import { NextRequest, NextResponse } from "next/server";
import type { VehicleServiceKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isKind, KIND_LABEL } from "@/lib/fleet/kinds";
import { FleetInputError, optNum, optText } from "@/lib/fleet/input";
import { fleetUser, inputError } from "../../../common";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
  const user = await fleetUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { rules?: unknown } | null;
  if (!body || !Array.isArray(body.rules)) {
    return NextResponse.json({ error: "Очікую список правил" }, { status: 400 });
  }

  let rules: Array<{ kind: VehicleServiceKind; title: string; everyKm: number | null; everyMonths: number | null }>;
  try {
    const seen = new Set<string>();
    rules = body.rules.map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      if (!isKind(r.kind)) throw new FleetInputError("Виберіть вид робіт у кожному правилі");
      if (seen.has(r.kind)) throw new FleetInputError(`Правило «${KIND_LABEL[r.kind]}» повторюється`);
      seen.add(r.kind);
      const everyKm = optNum(r.everyKm, "Кожні, км", { min: 500, max: 500_000, int: true });
      const everyMonths = optNum(r.everyMonths, "Кожні, міс.", { min: 1, max: 120, int: true });
      if (everyKm == null && everyMonths == null) {
        throw new FleetInputError(`«${KIND_LABEL[r.kind]}»: вкажіть інтервал у км або місяцях`);
      }
      return { kind: r.kind, title: optText(r.title, "Назва", 120) ?? KIND_LABEL[r.kind], everyKm, everyMonths };
    });
  } catch (e) {
    return inputError(e);
  }

  const vehicle = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
  if (!vehicle) return NextResponse.json({ error: "Машину не знайдено" }, { status: 404 });

  await prisma.$transaction([
    prisma.vehicleServiceRule.deleteMany({ where: { vehicleId: id } }),
    prisma.vehicleServiceRule.createMany({ data: rules.map((r) => ({ ...r, vehicleId: id })) }),
  ]);
  return NextResponse.json({ ok: true });
}
