/**
 * Клієнт бази для довільного SQL із MCP — окрема читальна роль Postgres.
 *
 * Сайт і помічник ходять у базу як postgres (superuser), і для query_db це
 * тримають три шари в query-db.ts. Але MCP-сервер дивиться в інтернет, тож
 * тут четвертий шар: роль budvik_mcp_ro (scripts/mcp/readonly-role.sql), якій
 * сама база не дає ні писати, ні читати секрети (паролі, токени).
 *
 * Готові зведення керівника й OAuth ходять звичайним `prisma` — там фіксований
 * код, а не текст від моделі.
 */

import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

let client: PrismaClient | undefined;

/**
 * Лінивий, щоб перевірки могли підставити змінну до першого виклику.
 *
 * Без MCP_READONLY_DATABASE_URL у production — відмова, а не тихий відкат на
 * superuser: сервіс має впасти на старті, а не роками працювати без шару,
 * про який усі думають, що він є.
 */
export function readonlyDb(): PrismaClient {
  if (client) return client;
  const url = process.env.MCP_READONLY_DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MCP_READONLY_DATABASE_URL не задано — довільний SQL без читальної ролі в проді не запускаємо");
    }
    console.warn("[mcp] MCP_READONLY_DATABASE_URL не задано — query_db іде спільним клієнтом (лише для розробки)");
    client = prisma;
    return client;
  }
  // Два з'єднання: запити моделі однаково йдуть по два (limiter у query-db.ts).
  const u = new URL(url);
  if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "2");
  if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "15");
  client = new PrismaClient({ datasources: { db: { url: u.toString() } } });
  return client;
}
