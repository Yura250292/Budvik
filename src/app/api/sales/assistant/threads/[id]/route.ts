/**
 * Одна розмова: історія для інтерфейсу й видалення.
 *
 * Службові TOOL-повідомлення назовні не віддаємо — це JSON на кілька
 * кілобайт. Замість них до репліки помічника чіпляється список
 * інструментів, які він перевірив: рядок «що я подивився» під відповіддю.
 */

import { NextResponse } from "next/server";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { prisma } from "@/lib/prisma";
import { deleteThread, getThreadForUser } from "@/lib/assistant/threads";
import { TOOL_LABELS } from "@/lib/assistant/tools";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const thread = await getThreadForUser(id, guard.me.userId);
  if (!thread) return NextResponse.json({ error: "Розмову не знайдено" }, { status: 404 });

  const rows = await prisma.assistantMessage.findMany({
    where: { threadId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      toolName: true,
      durationMs: true,
      promptTokens: true,
      error: true,
      createdAt: true,
    },
  });

  // Інструменти приписуємо до НАСТУПНОЇ репліки помічника: у стрічці вони
  // стоять перед нею, а показати їх треба разом із відповіддю.
  const messages: Array<{
    id: string;
    role: "USER" | "ASSISTANT";
    content: string;
    createdAt: string;
    tools: Array<{ name: string; label: string; ms: number | null }>;
    /** false — відповідь склав код, модель не викликалася. */
    viaModel: boolean;
  }> = [];
  let pending: Array<{ name: string; label: string; ms: number | null }> = [];

  for (const row of rows) {
    if (row.role === "TOOL") {
      if (row.toolName) {
        pending.push({
          name: row.toolName,
          label: TOOL_LABELS[row.toolName] ?? "Перевіряю дані",
          ms: row.durationMs,
        });
      }
      continue;
    }
    // Проміжна репліка помічника з викликами інструментів тексту не несе.
    if (row.role === "ASSISTANT" && !row.content.trim()) continue;

    messages.push({
      id: row.id,
      role: row.role === "USER" ? "USER" : "ASSISTANT",
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      tools: row.role === "ASSISTANT" ? pending : [],
      // Нуль вхідних токенів буває лише у відповіді, складеної кодом:
      // будь-який похід до моделі коштує щонайменше системного промпту.
      viaModel: row.promptTokens > 0,
    });
    if (row.role === "ASSISTANT") pending = [];
  }

  return NextResponse.json(
    {
      id: thread.id,
      title: thread.title,
      repId: thread.repId,
      repName: thread.rep.name,
      messages,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRoles(req, FIELD_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const thread = await getThreadForUser(id, guard.me.userId);
  if (!thread) return NextResponse.json({ error: "Розмову не знайдено" }, { status: 404 });

  await deleteThread(id);
  return NextResponse.json({ ok: true });
}
