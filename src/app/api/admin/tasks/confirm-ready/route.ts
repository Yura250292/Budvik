import { NextResponse } from "next/server";
import { OFFICE_ROLES, requireRoles } from "@/lib/app/identity";
import { confirmReady } from "@/lib/tasks";

/**
 * «Надіслати всі готові» з наради: { meetingId }.
 *
 * Лише задачі, де виконавця назвали на нараді, а клієнт однозначний. Решта
 * лишається чекати — у відповіді скільки саме.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;
  const body = ((await req.json().catch(() => null)) ?? {}) as { meetingId?: unknown };
  if (typeof body.meetingId !== "string" || !body.meetingId) {
    return NextResponse.json({ error: "Не вказано нараду" }, { status: 400 });
  }
  return NextResponse.json(await confirmReady(auth.me.userId, body.meetingId));
}
