/**
 * Чи вмикати шар пробок.
 *
 * Ключ TomTom живе лише на сервері, тож браузер не може сам дізнатися,
 * налаштований він чи ні. Карта питає тут: є ключ — додає шар і показує
 * перемикач, немає — тихо працює без пробок.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ enabled: false }, { status: 401 });
  }
  return NextResponse.json({ enabled: Boolean(process.env.TOMTOM_API_KEY) });
}
