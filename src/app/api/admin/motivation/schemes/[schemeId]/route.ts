/**
 * Редагування схеми мотивації разом із її правилами.
 *
 * Правила зберігаються цілим набором (видалити всі → створити заново), а не
 * по одному: набір правил має сенс лише як ціле — «5% від прибутку і мінус
 * за прострочку» це одна домовленість, а не два незалежні записи. Той самий
 * підхід, що й у збереженні планів.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { MotivationRuleType, PlanMetric } from "@prisma/client";
import { RULE_TYPES, MOTIVATION_EDIT_ROLES as EDIT_ROLES } from "@/lib/motivation/labels";

export const dynamic = "force-dynamic";

type RuleInput = {
  type?: string;
  value?: unknown;
  brandId?: unknown;
  planMetric?: unknown;
  thresholdFrom?: unknown;
  thresholdTo?: unknown;
  overdueTolerance?: unknown;
  sortOrder?: unknown;
  notes?: unknown;
};

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function PUT(req: NextRequest, { params }: { params: Promise<{ schemeId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { schemeId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Порожній запит" }, { status: 400 });
  }

  const scheme = await prisma.motivationScheme.findUnique({ where: { id: schemeId }, select: { id: true } });
  if (!scheme) {
    return NextResponse.json({ error: "Схему не знайдено" }, { status: 404 });
  }

  const rules: RuleInput[] | null = Array.isArray(body.rules) ? body.rules : null;

  if (rules) {
    for (const rule of rules) {
      if (!RULE_TYPES.includes(rule.type as MotivationRuleType)) {
        return NextResponse.json({ error: `Невідомий тип правила: ${rule.type}` }, { status: 400 });
      }
      if (numOrNull(rule.value) === null) {
        return NextResponse.json({ error: "У кожного правила має бути числове значення" }, { status: 400 });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    // Типова схема одна: перш ніж призначити нову, знімаємо прапор зі старої.
    if (body.isDefault === true) {
      await tx.motivationScheme.updateMany({
        where: { isDefault: true, id: { not: schemeId } },
        data: { isDefault: false },
      });
    }

    await tx.motivationScheme.update({
      where: { id: schemeId },
      data: {
        ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined
          ? { description: typeof body.description === "string" ? body.description.trim() || null : null }
          : {}),
        ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
        ...(typeof body.isDefault === "boolean" ? { isDefault: body.isDefault } : {}),
      },
    });

    if (rules) {
      await tx.motivationRule.deleteMany({ where: { schemeId } });
      if (rules.length > 0) {
        await tx.motivationRule.createMany({
          data: rules.map((rule, i) => ({
            schemeId,
            type: rule.type as MotivationRuleType,
            value: numOrNull(rule.value) ?? 0,
            sortOrder: numOrNull(rule.sortOrder) ?? i,
            brandId: typeof rule.brandId === "string" && rule.brandId ? rule.brandId : null,
            planMetric:
              typeof rule.planMetric === "string" && rule.planMetric ? (rule.planMetric as PlanMetric) : null,
            thresholdFrom: numOrNull(rule.thresholdFrom),
            thresholdTo: numOrNull(rule.thresholdTo),
            overdueTolerance: numOrNull(rule.overdueTolerance),
            notes: typeof rule.notes === "string" && rule.notes.trim() ? rule.notes.trim() : null,
          })),
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ schemeId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { schemeId } = await params;

  // Схему з історією призначень не видаляємо: разом з нею зникли б підстави
  // нарахувань за минулі місяці. Вимкнути — так, стерти — ні.
  const used = await prisma.motivationAssignment.count({ where: { schemeId } });
  if (used > 0) {
    return NextResponse.json(
      { error: "Схему вже призначали торговим — її можна лише вимкнути, інакше зникне історія нарахувань" },
      { status: 409 }
    );
  }

  await prisma.motivationScheme.delete({ where: { id: schemeId } });
  return NextResponse.json({ ok: true });
}
