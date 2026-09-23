/**
 * MCP-сервер Budvik: tools/list і tools/call для одного автентифікованого адміна.
 *
 * Низькорівневий Server, а не McpServer.registerTool: схеми інструментів
 * помічника — уже готова JSON Schema, і перекладати їх у zod заради SDK
 * означало б тримати два описи одного й того самого.
 *
 * Сервер створюється на кожен HTTP-запит (Streamable HTTP без сесій), тож
 * контекст (хто питає, яким застосунком) — просто параметр.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { rateLimit } from "@/lib/shop/rate-limit";
import { logCall, type McpCtx } from "@/lib/mcp/audit";
import { MCP_INSTRUCTIONS } from "@/lib/mcp/instructions";
import { mcpTools } from "@/lib/mcp/tools";

/** 120 викликів на хвилину на людину: модель у циклі, а не людина за клавіатурою. */
const CALLS_PER_MINUTE = 120;

const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify({ помилка: message }) }],
  isError: true,
});

export function createMcpServer(ctx: McpCtx): Server {
  const server = new Server(
    { name: "budvik", title: "Budvik", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS }
  );
  const tools = mcpTools();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools.values()].map((t) => t.def),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const started = Date.now();

    const tool = tools.get(name);
    if (!tool) {
      await logCall(ctx, name, args, { ok: false, ms: 0, error: "невідомий інструмент" });
      return errorResult(`Інструмента ${name} немає. Доступні: ${[...tools.keys()].join(", ")}`);
    }

    const limit = await rateLimit(`mcp:${ctx.userId}`, CALLS_PER_MINUTE, 60);
    if (!limit.allowed) return errorResult("Забагато запитів поспіль — зачекайте хвилину.");

    try {
      const { result, rows } = await tool.run(ctx, args);
      const ms = Date.now() - started;
      const error = result.isError ? String((result.content[0] as { text?: string })?.text ?? "").slice(0, 500) : null;
      await logCall(ctx, name, args, { ok: !result.isError, rows, ms, error });
      console.log(`[mcp] ${ctx.userName} · ${name} · ${ms} мс${rows != null ? ` · ${rows} рядків` : ""}${result.isError ? " · помилка" : ""}`);
      return result;
    } catch (e) {
      const ms = Date.now() - started;
      console.error(`[mcp] ${name} упав:`, e);
      await logCall(ctx, name, args, { ok: false, ms, error: (e as Error).message });
      return errorResult("Внутрішня помилка інструмента. Спробуйте інакше сформулювати або інший інструмент.");
    }
  });

  return server;
}
