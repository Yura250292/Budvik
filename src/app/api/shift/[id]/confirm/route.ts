/**
 * Торговий підтверджує зміну, яку закрила не він.
 *
 * Зміну міг закрити воркер увечері або сам торговий заднім числом без
 * фото. У всіх цих випадках цифри стоять на здогадці треку, і питання
 * до людини одне: «так було?». Відповідей три:
 *
 *   {ok:true}            — так, усе вірно;
 *   {endOdometer}        — ні, ось справжній одометр на кінець роботи;
 *   {endedAt}            — ні, я закінчив в інший час.
 *
 * Усі три закривають картку в застосунку. Мовчання — ні: доти зміна
 * лишається в черзі й у офіса, і в торгового.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { confirmShift, loadForConfirm } from "@/lib/shift/confirm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  let body: { ok?: boolean; endOdometer?: number; endedAt?: string };
  try {
    body = await req.json();
  } catch {
    // Порожнє тіло = «все вірно»: найчастіша відповідь не має вимагати
    // від клієнта нічого, крім самого запиту.
    body = { ok: true };
  }

  const shift = await loadForConfirm(id);
  if (!shift) return NextResponse.json({ error: "Зміну не знайдено" }, { status: 404 });

  // Свою — так, чужу — ні. Офіс має для цього адмінку з іншими правами.
  if (shift.userId !== auth.me.userId) {
    return NextResponse.json({ error: "Це чужа зміна" }, { status: 403 });
  }

  if (shift.confirmedAt) {
    // Повторне підтвердження — не помилка: застосунок міг не отримати
    // відповідь і повторити запит.
    return NextResponse.json({ shift, repeated: true });
  }

  let endedAt: Date | undefined;
  if (body.endedAt) {
    endedAt = new Date(body.endedAt);
    if (Number.isNaN(endedAt.getTime())) {
      return NextResponse.json({ error: "Некоректний час закінчення" }, { status: 400 });
    }
  }

  const result = await confirmShift(
    shift,
    { endOdometer: body.endOdometer, endedAt },
    { userId: auth.me.userId, source: "REP" }
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ shift: result.shift });
}
