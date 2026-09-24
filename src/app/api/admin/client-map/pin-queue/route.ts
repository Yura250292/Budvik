/**
 * Черга «Точки з треку» — див. lib/routes/pin-queue.ts.
 *
 * Трек читається повільно (~0,5 с на клієнта), тож роут працює до
 * дедлайну і віддає `nextOffset`, а вкладка догружає решту по колу — так
 * само, як кнопка «Геокодувати адреси». Нічого не пише.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";
import { pinQueue } from "@/lib/routes/pin-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Запас до ліміту Vercel: один клієнт з довгою історією — кілька секунд. */
const DEADLINE_MS = 35_000;

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0);
  const queue = await pinQueue({ offset, deadlineMs: DEADLINE_MS });
  return NextResponse.json(queue, { headers: { "Cache-Control": "no-store" } });
}
