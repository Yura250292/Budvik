/**
 * Розкладка дашборду поточного користувача.
 *
 * Валідація ручна (zod у проєкті немає): пропускаємо лише відомі типи
 * віджетів і дозволені розміри, решту мовчки відкидаємо — зіпсований
 * запис не має ламати дашборд при наступному завантаженні.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["ADMIN", "MANAGER", "SALES"];
const SIZES = ["1x1", "2x1", "2x2", "3x1", "4x1", "4x2"];
const TYPES = [
  "stat-orders",
  "stat-products",
  "stat-clients",
  "stat-wholesale",
  "recent-orders",
  "sales-summary",
  "revenue-chart",
];
/**
 * Віджети, недоступні торговому: чужі клієнти, оптовики, зведення по всіх.
 * Перелік має збігатися з roles у widget-registry.tsx.
 */
const SALES_BLOCKED = ["stat-clients", "stat-wholesale", "revenue-chart", "stat-products"];
const MAX_WIDGETS = 20;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ADMIN_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const record = await prisma.userDashboardLayout.findUnique({
    where: { userId: session.user.id },
  });

  // Порожня відповідь — сигнал клієнту взяти дефолт для своєї ролі.
  return NextResponse.json({ layout: record?.layout ?? null, updatedAt: record?.updatedAt ?? null });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });

  const role = session.user.role;
  if (!ADMIN_ROLES.includes(role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const raw = (body as { widgets?: unknown })?.widgets;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "Очікується масив widgets" }, { status: 400 });
  }

  const seen = new Set<string>();
  const widgets = raw
    .filter((w: unknown) => {
      if (!w || typeof w !== "object") return false;
      const c = w as Record<string, unknown>;
      if (typeof c.id !== "string" || typeof c.type !== "string" || typeof c.size !== "string") return false;
      if (!TYPES.includes(c.type) || !SIZES.includes(c.size)) return false;
      if (role === "SALES" && SALES_BLOCKED.includes(c.type)) return false;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .slice(0, MAX_WIDGETS)
    .map((w: unknown, i: number) => {
      const c = w as Record<string, unknown>;
      return { id: c.id as string, type: c.type as string, size: c.size as string, order: i };
    });

  const layout = { version: 1, widgets };

  await prisma.userDashboardLayout.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, layout },
    update: { layout },
  });

  return NextResponse.json({ ok: true, layout });
}
