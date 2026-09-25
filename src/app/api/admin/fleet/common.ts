/**
 * Спільне для роутів автопарку: доступ і відповідь на помилку вводу.
 *
 * Вносить лише офіс (ADMIN, MANAGER) — так вирішено 25.09.2026. Торговий і
 * водій своїх машин у застосунку поки не бачать.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FleetInputError } from "@/lib/fleet/input";

const FLEET_ROLES = ["ADMIN", "MANAGER"];

export async function fleetUser(): Promise<{ id: string } | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!FLEET_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }
  return { id: session.user.id };
}

/** Помилка вводу → 400 з текстом; решта летить далі як 500. */
export function inputError(e: unknown): NextResponse {
  if (e instanceof FleetInputError) return NextResponse.json({ error: e.message }, { status: 400 });
  throw e;
}
