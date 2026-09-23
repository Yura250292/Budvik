/**
 * Журнал викликів MCP: хто, яким застосунком, що саме спитав і чим скінчилось.
 *
 * Навіщо: конектор видає дані фірми назовні, тож має бути видно, що
 * зчитували (для query_db — сам SQL), і де модель спотикається (помилки,
 * повільні запити, упор у 500 рядків). Тримаємо 90 днів.
 *
 * Запис журналу ніколи не валить відповідь: краще втратити рядок журналу,
 * ніж відмовити людині.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type McpCtx = {
  userId: string;
  userName: string;
  /** client_id OAuth-клієнта (claude.ai, ChatGPT…); null — виклик не через OAuth. */
  clientId: string | null;
};

export type CallOutcome = { ok: boolean; rows?: number | null; ms: number; error?: string | null };

const KEEP_DAYS = 90;

export async function logCall(ctx: McpCtx, tool: string, args: unknown, out: CallOutcome): Promise<void> {
  try {
    await prisma.mcpCall.create({
      data: {
        userId: ctx.userId,
        clientId: ctx.clientId,
        tool,
        args: (args ?? {}) as Prisma.InputJsonValue,
        ok: out.ok,
        rows: out.rows ?? null,
        ms: Math.round(out.ms),
        error: out.error ? out.error.slice(0, 1000) : null,
      },
    });
  } catch (e) {
    console.error("[mcp] журнал не записався:", e);
  }
}

export async function purgeOldCalls(days = KEEP_DAYS): Promise<number> {
  const { count } = await prisma.mcpCall.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
  });
  return count;
}
