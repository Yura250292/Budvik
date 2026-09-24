/**
 * Інструменти MCP-конектора без HTTP і без OAuth: справжній MCP-клієнт із
 * SDK говорить із createMcpServer через InMemoryTransport.
 *
 * Що доводимо:
 * - назовні рівно ті 19 інструментів, що в списку, усі з readOnlyHint, і
 *   жодного пишучого (remind_me) чи файлового (export_file);
 * - посилання на екрани сайту у відповідях зведень — повні адреси: у claude.ai
 *   чи ChatGPT шлях «/admin/…» нікуди не веде;
 * - describe_data і query_db працюють, битий чи «пишучий» SQL повертає
 *   помилку з підказкою, а не валить сервер;
 * - готові зведення керівника відповідають, неправильні аргументи — isError;
 * - кожен виклик лягає в журнал McpCall.
 *
 *   npx tsx --env-file=.env scripts/check-mcp-tools.mts
 *
 * Пише в McpCall і RateLimit, тому лише на локальній базі.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "../src/lib/prisma";
import { createMcpServer } from "../src/lib/mcp/server";
import { SUMMARY_TOOLS, absolutizeLinks } from "../src/lib/mcp/tools";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got).slice(0, 160)}`);
  if (!ok) fails.push(name);
}

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) {
  console.log("База не локальна — відмовляюсь (скрипт пише в McpCall).");
  process.exit(1);
}

const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, name: true, email: true } });
if (!admin) {
  console.log("У базі немає ADMIN — нема від чийого імені викликати.");
  process.exit(1);
}

const clientId = `mcp-tools-check-${Date.now()}`;
const server = createMcpServer({ userId: admin.id, userName: admin.name ?? admin.email, clientId });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "check-mcp-tools", version: "1.0.0" });
await client.connect(clientSide);

type Res = { isError?: boolean; content: { type: string; text?: string }[] };
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Res;
const text = (r: Res) => r.content.map((c) => c.text ?? "").join("\n");

try {
  /* ── Список ─────────────────────────────────────────────────────── */
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const expected = ["describe_data", "query_db", ...SUMMARY_TOOLS].sort();
  check("рівно 19 інструментів", tools.length === 19, tools.length);
  check("маршрути доставки є", names.includes("build_route"), names.includes("build_route"));
  check("саме ті, що в списку", JSON.stringify(names) === JSON.stringify(expected), names.join(","));
  check("усі readOnlyHint", tools.every((t) => t.annotations?.readOnlyHint === true), tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name).join(",") || "усі");
  check("жодного пишучого чи файлового", !names.some((n) => ["remind_me", "export_file", "my_reminders"].includes(n)), "немає");
  check("у кожного JSON Schema object", tools.every((t) => t.inputSchema?.type === "object"), "object");
  check("опис є в кожного", tools.every((t) => (t.description ?? "").length > 20), "є");
  const info = client.getServerVersion();
  check("сервер назвався", info?.name === "budvik", info?.name);
  check("інструкції сервера є", (client.getInstructions() ?? "").includes("real_sale"), (client.getInstructions() ?? "").slice(0, 60));

  /* ── describe_data ──────────────────────────────────────────────── */
  const d = await call("describe_data");
  check("describe_data без аргументів — не помилка", !d.isError, text(d).slice(0, 80));
  const dj = JSON.parse(text(d));
  check("29 видів", dj.представлення?.length === 29, dj.представлення?.length);
  check("правила на місці", Array.isArray(dj.правила) && dj.правила.length > 0, dj.правила?.length);
  const dd = JSON.parse(text(await call("describe_data", { views: ["documents"] })));
  check("колонки documents", (dd.представлення?.[0]?.колонки?.length ?? 0) > 5, dd.представлення?.[0]?.колонки?.length);

  /* ── query_db ───────────────────────────────────────────────────── */
  const q = await call("query_db", { sql: "SELECT day, SUM(total) AS amount FROM documents WHERE real_sale GROUP BY day ORDER BY day LIMIT 400" });
  check("агрегат по днях — не помилка", !q.isError, text(q));
  const qj = JSON.parse(text(q));
  check("відповідь: columns / rows / row_count", Array.isArray(qj.rows) && typeof qj.row_count === "number", Object.keys(qj).join(","));
  const s = await call("query_db", { sql: `SELECT name, role FROM staff WHERE name ILIKE '%${(admin.name ?? "").split(" ")[0]}%' LIMIT 5` });
  const sj = JSON.parse(text(s));
  check("рядки масивами, колонки окремо", Array.isArray(sj.columns) && sj.columns.includes("name") && Array.isArray(sj.rows?.[0]), text(s));
  const u = await call("query_db", { sql: 'UPDATE "SyncState" SET value = value WHERE false' });
  check("UPDATE → isError", u.isError === true, text(u));
  check("у помилці є підказка", /помилка/.test(text(u)), text(u));
  const bad = await call("query_db", { sql: "SELECT nosuch FROM documents LIMIT 1" });
  check("неіснуюча колонка → isError з кодом 42703", bad.isError === true && text(bad).includes("42703"), text(bad));
  const empty = await call("query_db", {});
  check("без sql → isError", empty.isError === true, text(empty));

  /* ── Готові зведення ────────────────────────────────────────────── */
  const t = await call("team_overview", {});
  check("team_overview відповідає", !t.isError && text(t).length > 2, text(t).slice(0, 100));
  const sync = await call("sync_health");
  check("sync_health відповідає", !sync.isError, text(sync).slice(0, 100));
  const badArgs = await call("documents", { doc_type: "НЕМАЄ_ТАКОГО" });
  check("неправильний аргумент → isError, а не виняток", badArgs.isError === true, text(badArgs));
  const trips = await call("shifts_report", { mode: "days", days: 7 });
  check("поїздки по днях відповідають", !trips.isError && "по_днях" in JSON.parse(text(trips)), text(trips).slice(0, 100));
  const plan = await call("build_route", { mode: "day_plan" });
  check("план доставки викликається без винятку", !plan.isError, text(plan).slice(0, 100));

  /* ── Посилання на сайт ──────────────────────────────────────────── */
  const linked = absolutizeLinks({
    посилання: "/admin/logistics/delivery?tab=plan&day=2026-09-25",
    список: [{ url: "/admin/sales-analytics" }],
    google: "https://www.google.com/maps/dir/a/b",
    текст: "дивись /admin/x у кабінеті",
    число: 5,
  });
  check("шлях /admin/… → повна адреса", linked.посилання === "https://www.budvik27.com/admin/logistics/delivery?tab=plan&day=2026-09-25", linked.посилання);
  check("вкладені посилання теж", linked.список[0].url === "https://www.budvik27.com/admin/sales-analytics", linked.список[0].url);
  check("чужі адреси не чіпає", linked.google === "https://www.google.com/maps/dir/a/b", linked.google);
  check("текст зі шляхом усередині не чіпає", linked.текст === "дивись /admin/x у кабінеті", linked.текст);
  check("числа не чіпає", linked.число === 5, linked.число);

  const unknown = await call("remind_me", { text: "x" });
  check("remind_me назовні недоступний", unknown.isError === true, text(unknown));

  /* ── Журнал ─────────────────────────────────────────────────────── */
  const logged = await prisma.mcpCall.findMany({ where: { clientId }, select: { tool: true, ok: true } });
  check("кожен виклик у McpCall", logged.length >= 10, logged.length);
  check("помилки позначено ok=false", logged.some((r) => r.tool === "query_db" && !r.ok), logged.filter((r) => !r.ok).length);
  const sqlLogged = await prisma.mcpCall.findFirst({ where: { clientId, tool: "query_db", ok: true }, select: { args: true, rows: true } });
  check("для query_db у журналі сам SQL", JSON.stringify(sqlLogged?.args ?? {}).includes("SELECT"), JSON.stringify(sqlLogged?.args));
} finally {
  await prisma.mcpCall.deleteMany({ where: { clientId } }).catch(() => {});
  await client.close();
  await prisma.$disconnect();
}

console.log(fails.length ? `\nПРОВАЛЕНО ${fails.length}: ${fails.join("; ")}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
