/**
 * Підключення MCP-конектора, як їх бачить адмін у профілі: «Claude,
 * підключено 23 вересня, востаннє ходив годину тому» — і кнопка «Відключити».
 *
 * Одне підключення = одна родина токенів (familyId): оновлення токена родини
 * не міняє, тож рядок у списку не множиться. Живе те підключення, у якого є
 * живий refresh — без нього клієнт уже не отримає нового доступу.
 */

import { prisma } from "@/lib/prisma";
import { revokeFamily } from "@/lib/mcp/oauth/provider";

export type McpGrant = {
  familyId: string;
  clientName: string;
  connectedAt: Date;
  lastUsedAt: Date | null;
  /** Викликів інструментів цим застосунком за 7 днів. */
  calls7d: number;
};

export async function listGrants(userId: string): Promise<McpGrant[]> {
  const now = new Date();
  const live = await prisma.mcpToken.findMany({
    where: { userId, kind: "REFRESH", revokedAt: null, usedAt: null, expiresAt: { gt: now } },
    select: { familyId: true, clientId: true, client: { select: { name: true } } },
  });
  if (!live.length) return [];

  const families = [...new Set(live.map((t) => t.familyId))];
  const clientIds = [...new Set(live.map((t) => t.clientId))];
  const [spans, calls] = await Promise.all([
    prisma.mcpToken.groupBy({
      by: ["familyId"],
      where: { familyId: { in: families } },
      _min: { createdAt: true },
      _max: { lastUsedAt: true },
    }),
    prisma.mcpCall.groupBy({
      by: ["clientId"],
      where: { userId, clientId: { in: clientIds }, createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      _count: { _all: true },
    }),
  ]);
  const span = new Map(spans.map((s) => [s.familyId, s]));
  const callsBy = new Map(calls.map((c) => [c.clientId, c._count._all]));

  const seen = new Set<string>();
  const out: McpGrant[] = [];
  for (const t of live) {
    if (seen.has(t.familyId)) continue;
    seen.add(t.familyId);
    const s = span.get(t.familyId);
    out.push({
      familyId: t.familyId,
      clientName: t.client.name ?? "AI-застосунок",
      connectedAt: s?._min.createdAt ?? now,
      lastUsedAt: s?._max.lastUsedAt ?? null,
      calls7d: callsBy.get(t.clientId) ?? 0,
    });
  }
  return out.sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime());
}

/** Відключити своє підключення. Чуже — false і нічого не чіпаємо. */
export async function revokeGrant(userId: string, familyId: string): Promise<boolean> {
  const owned = await prisma.mcpToken.findFirst({ where: { familyId, userId }, select: { id: true } });
  if (!owned) return false;
  await revokeFamily(familyId);
  return true;
}
