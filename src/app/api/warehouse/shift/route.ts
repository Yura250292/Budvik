/**
 * Зміна складовщика: стан, відкриття, закриття.
 *
 * Це не /api/shift/* — там зміна торгового з одометром і касою. Спільного в
 * них рівно стільки, скільки в слова «зміна»: тут людина приходить на склад і
 * йде зі складу, і все, що потрібно офісу, — час і місце.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRoles, WAREHOUSE_ROLES } from "@/lib/app/identity";
import { closeShift, getOpenShift, openShift, shiftDto, shiftSummary } from "@/lib/warehouse/shift";
import { daySummary } from "@/lib/warehouse/reports";

export const dynamic = "force-dynamic";

/** Повторний дотик по «Відкрити зміну» не має її закривати. */
const DOUBLE_TAP_WINDOW_MS = 60_000;

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;

  const shift = await getOpenShift(auth.me.userId);

  return NextResponse.json(
    {
      shift: shiftDto(shift),
      summary: shift ? await shiftSummary(shift.id) : null,
      today: await daySummary(auth.me.userId),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function coord(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;
  const userId = auth.me.userId;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = String(body.action ?? "");
  const lat = coord(body.lat);
  const lng = coord(body.lng);

  const open = await getOpenShift(userId);

  if (action === "open") {
    /**
     * Зміна вже відкрита — це не помилка, а другий дотик.
     *
     * Планшет міг не дочекатися відповіді й повторити запит; віддаємо ту саму
     * зміну замість другої. Без цього в людини за день накопичувалося б
     * кілька «змін» по одній хвилині, і години не сходилися б ні з чим.
     */
    if (open) {
      return NextResponse.json({ shift: shiftDto(open), alreadyOpen: true });
    }
    const shift = await openShift(userId, lat, lng);
    return NextResponse.json({ shift: shiftDto(shift) }, { status: 201 });
  }

  if (action === "close") {
    if (!open) return NextResponse.json({ error: "Відкритої зміни немає" }, { status: 409 });

    const age = Date.now() - new Date(open.openedAt).getTime();
    if (age < DOUBLE_TAP_WINDOW_MS) {
      return NextResponse.json({ shift: shiftDto(open), tooSoon: true });
    }

    /**
     * Накладні, що ще розпізнаються, — привід ПОПЕРЕДИТИ, а не заборонити.
     *
     * Людина йде додому, і тримати її біля терміналу заради чужого AI ми не
     * маємо права. Але й мовчки закрити зміну не можна: непрочитана накладна
     * лишиться без зміни, і в звіті години не зійдуться з документами.
     */
    const summary = await shiftSummary(open.id);
    if (summary.pendingCount > 0 && !body.force) {
      return NextResponse.json({ needsConfirm: true, summary }, { status: 409 });
    }

    const shift = await closeShift(open, lat, lng);
    return NextResponse.json({ shift: shiftDto(shift), summary });
  }

  return NextResponse.json({ error: "Невідома дія" }, { status: 400 });
}
