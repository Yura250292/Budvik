/**
 * Архів АІ-звітів: список і збереження.
 *
 * GET  — що вже відкладено (з фільтром за видом і торговим).
 * POST — відкласти звіт, який зараз на екрані.
 *
 * Лише для керівництва. Торговий не зберігає звіти й не бачить чужих: архів
 * — це матеріал до розмови з людиною, а не зворотний зв'язок для неї.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

/** Скільки звітів віддавати списком. Більше на одному екрані не читають. */
const LIST_LIMIT = 100;

const MAX_TITLE = 120;
const MAX_NOTE = 500;

function guard(role: string | undefined) {
  if (!role) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!FULL_ACCESS_ROLES.includes(role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }
  return null;
}

/**
 * Види звітів, які можна відкладати в архів.
 *
 * Секції АІ-аналізу фірми лежать тут разом зі звітами по торговому й
 * команді: архів — це матеріал до розмови, і звіт про неліквід потрібен у
 * ньому не менше, ніж звіт про людину. Payload у них не Insight[], а
 * структура секції, тож перевірка «є що зберігати» нижче рахує не довжину
 * масиву, а непорожність об'єкта.
 */
const COMPANY_KINDS = [
  "company_reps",
  "company_products",
  "company_logistics",
  "company_strategy",
] as const;

const SAVED_KINDS = ["rep", "team", ...COMPANY_KINDS] as const;
type SavedKind = (typeof SAVED_KINDS)[number];

const COMPANY_TITLES: Record<(typeof COMPANY_KINDS)[number], string> = {
  company_reps: "АІ аналіз фірми — торгові",
  company_products: "АІ аналіз фірми — товари",
  company_logistics: "АІ аналіз фірми — логістика",
  company_strategy: "АІ аналіз фірми — стратегія",
};

/** Підпис за замовчуванням, якщо керівник не ввів свій. */
function defaultTitle(kind: SavedKind, repName: string | null, fromDay: string, toDay: string): string {
  if (kind in COMPANY_TITLES) {
    return `${COMPANY_TITLES[kind as keyof typeof COMPANY_TITLES]}, ${fromDay} — ${toDay}`;
  }
  const who = kind === "team" ? "Команда" : (repName ?? "Торговий");
  return `${who}, ${fromDay} — ${toDay}`;
}

/** Чи є в payload хоч щось. Порожній звіт найчастіше слід збою. */
function hasContent(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.length > 0;
  if (payload && typeof payload === "object") {
    return Object.values(payload).some((v) =>
      Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : v != null
    );
  }
  return false;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const denied = guard(session?.user?.role);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const repId = searchParams.get("repId");

  const rows = await prisma.savedAiReport.findMany({
    where: {
      ...(kind && (SAVED_KINDS as readonly string[]).includes(kind) ? { kind } : {}),
      ...(repId ? { repId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      kind: true,
      repId: true,
      fromDay: true,
      toDay: true,
      title: true,
      note: true,
      model: true,
      tokens: true,
      createdAt: true,
      // Без insights/facts: у списку потрібен лише лічильник, а звіти важкі
      insights: true,
      rep: { select: { name: true } },
      savedBy: { select: { name: true } },
    },
  });

  return NextResponse.json({
    reports: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      repId: r.repId,
      repName: r.rep?.name ?? null,
      fromDay: r.fromDay,
      toDay: r.toDay,
      title: r.title,
      note: r.note,
      model: r.model,
      tokens: r.tokens,
      savedBy: r.savedBy?.name ?? "—",
      createdAt: r.createdAt.toISOString(),
      insightsCount: Array.isArray(r.insights) ? (r.insights as unknown[]).length : 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const denied = guard(session?.user?.role);
  if (denied) return denied;

  let body: {
    kind?: string;
    repId?: string | null;
    fromDay?: string;
    toDay?: string;
    title?: string;
    note?: string;
    /** Insight[] у звітах по торговому й команді; структура секції — у звітах фірми */
    insights?: unknown;
    facts?: unknown;
    model?: string;
    tokens?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний запит" }, { status: 400 });
  }

  const kind = (SAVED_KINDS as readonly string[]).includes(body.kind ?? "")
    ? (body.kind as SavedKind)
    : null;
  if (!kind) {
    return NextResponse.json({ error: "Невідомий вид звіту" }, { status: 400 });
  }
  if (!body.fromDay || !body.toDay) {
    return NextResponse.json({ error: "Не вказано період" }, { status: 400 });
  }
  if (!hasContent(body.insights)) {
    // Порожній звіт відкладати нема сенсу — і найчастіше це слід збою,
    // а не «все спокійно».
    return NextResponse.json(
      { error: "Немає що зберігати: у звіті жодного висновку" },
      { status: 400 }
    );
  }

  // repId має бути реальним торговим: інакше зовнішній ключ впаде вже в базі,
  // а користувач побачить 500 замість зрозумілого тексту.
  let repName: string | null = null;
  if (kind === "rep") {
    if (!body.repId) {
      return NextResponse.json({ error: "Не вказано торгового" }, { status: 400 });
    }
    const rep = await prisma.user.findUnique({
      where: { id: body.repId },
      select: { name: true },
    });
    if (!rep) {
      return NextResponse.json({ error: "Торгового не знайдено" }, { status: 404 });
    }
    repName = rep.name;
  }

  const title =
    body.title?.trim().slice(0, MAX_TITLE) ||
    defaultTitle(kind, repName, body.fromDay, body.toDay);

  const saved = await prisma.savedAiReport.create({
    data: {
      kind,
      repId: kind === "rep" ? body.repId! : null,
      fromDay: body.fromDay,
      toDay: body.toDay,
      title,
      note: body.note?.trim().slice(0, MAX_NOTE) || null,
      insights: body.insights as unknown as object,
      facts: (body.facts ?? {}) as object,
      model: body.model ?? "",
      tokens: body.tokens ?? 0,
      savedById: session!.user.id,
    },
    select: { id: true, title: true, createdAt: true },
  });

  return NextResponse.json({
    id: saved.id,
    title: saved.title,
    createdAt: saved.createdAt.toISOString(),
  });
}
