/**
 * Нативний маяк планшета: знімок стану, який приходить БЕЗ участі JS.
 *
 * Пульс (`/api/track/heartbeat`) шле JS — а 15.09.2026 саме JS і був
 * заморожений: трек стояв годинами, і сервер не бачив від планшетів нічого,
 * крім тиші. Цей роут кличе track-guard з нативного будильника (з 1.6.6), тож
 * відповідь «що з планшетом» є і тоді, коли застосунок мовчить.
 *
 * Зберігаємо двома шарами, без міграції:
 *   • останній повний знімок — SyncState `app:staff:native:<userId>`;
 *   • історія — рядок `native` у TrackEvent стислим «ключ=значення»
 *     (src/lib/track/native-diag.ts), з якого будує проміжки звіт за день.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyDeviceToken } from "@/lib/track/device-token";
import { summarizeNative, type NativeBeaconBody } from "@/lib/track/native-diag";

export const dynamic = "force-dynamic";

/** Знімок зазвичай 3–8 КБ; більше — уже щось не так, і рядок бази не для цього. */
const MAX_SNAPSHOT_CHARS = 100_000;

export async function POST(req: NextRequest) {
  const device = await verifyDeviceToken(req.headers.get("authorization"));
  if (!device) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  let body: NativeBeaconBody | null = null;
  try {
    body = (await req.json()) as NativeBeaconBody;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Порожній знімок" }, { status: 400 });
  }

  const receivedAt = new Date();
  /**
   * Час пристрою, як і в решті журналу: події в TrackEvent міряються його
   * годинником, і маяк має стати в ту саму стрічку. Сміття або годинник, що
   * пішов на добу, — беремо час сервера.
   */
  const deviceAt = typeof body.at === "number" ? new Date(body.at) : null;
  const at =
    deviceAt && Math.abs(deviceAt.getTime() - receivedAt.getTime()) < 24 * 3600_000 ? deviceAt : receivedAt;

  const key = `app:staff:native:${device.userId}`;
  const raw = JSON.stringify({ receivedAt: receivedAt.toISOString(), ...body });
  const value =
    raw.length <= MAX_SNAPSHOT_CHARS
      ? raw
      : JSON.stringify({ receivedAt: receivedAt.toISOString(), reason: body.reason, truncated: raw.length });

  await prisma.syncState
    .upsert({ where: { key }, create: { key, value }, update: { value } })
    .catch(() => {});

  await prisma.trackEvent
    .create({
      data: { userId: device.userId, at, kind: "native", note: summarizeNative(body) || null },
    })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
