import { NextResponse } from "next/server";
import { ChatError } from "@/lib/chat/queries";

export const NO_STORE = { headers: { "Cache-Control": "no-store" } } as const;

/** Помилка бізнес-логіки → JSON зі статусом; решта — 500 із загальним текстом. */
export function chatErrorResponse(e: unknown): NextResponse {
  if (e instanceof ChatError) {
    return NextResponse.json({ error: e.message }, { status: e.status, ...NO_STORE });
  }
  console.error("[chat]", e);
  return NextResponse.json({ error: "Не вдалося виконати запит" }, { status: 500, ...NO_STORE });
}
