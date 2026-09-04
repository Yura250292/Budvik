/**
 * Прогін одного інструмента помічника без моделі й без HTTP.
 *
 * Перше, чим перевіряють новий інструмент: чи не падає, скільки триває і
 * чи влазить у ліміт контексту. Модель тут зайва — вона лише переказує те,
 * що поверне ця функція.
 *
 *   npx tsx scripts/assistant-tool.mts <інструмент> '<json аргументів>' [email торгового]
 *   npx tsx scripts/assistant-tool.mts --list
 */

import { prisma } from "../src/lib/prisma";
import { TOOLS, TOOL_BY_NAME } from "../src/lib/assistant/tools";
import { compact } from "../src/lib/assistant/format";
import { collectEntities, entityIdList } from "../src/lib/assistant/guards";
import { TOOL_RESULT_MAX_CHARS } from "../src/lib/assistant/config";
import { kyivDate } from "../src/lib/date/kyiv";

const DEFAULT_REP = "rep-kavetskyi-viktor@budvik.local";

const [name, rawArgs = "{}", email = DEFAULT_REP] = process.argv.slice(2);

if (!name || name === "--list") {
  console.log("Інструменти:");
  for (const t of TOOLS) console.log(`  ${t.name.padEnd(22)} ${t.label}`);
  process.exit(0);
}

const tool = TOOL_BY_NAME.get(name);
if (!tool) {
  console.error(`Немає інструмента «${name}». Список: npx tsx scripts/assistant-tool.mts --list`);
  process.exit(1);
}

const rep = await prisma.user.findFirst({
  where: { email },
  select: { id: true, name: true, role: true },
});
if (!rep) {
  console.error(`Користувача ${email} немає`);
  process.exit(1);
}

const ctx = {
  userId: rep.id,
  role: rep.role,
  kind: rep.role === "DRIVER" ? ("DRIVER" as const) : ("SALES" as const),
  scope: { repId: rep.id, repName: rep.name },
  today: kyivDate(new Date()),
};

const args = JSON.parse(rawArgs) as Record<string, unknown>;
const started = Date.now();

try {
  const result = await tool.run(ctx, args);
  const json = compact(result);
  const entities = collectEntities(result);

  console.log(`${tool.name} · ${rep.name} · ${Date.now() - started} мс`);
  console.log(
    `розмір ${json.length} символів (ліміт ${TOOL_RESULT_MAX_CHARS})${json.length > TOOL_RESULT_MAX_CHARS ? " — ЗАВЕЛИКИЙ" : ""}`
  );
  console.log(`id у видачі: клієнтів ${entities.clients.size}, товарів ${entities.products.size}`);
  console.log(JSON.stringify(result, null, 1));
  if (entityIdList(entities).length === 0) console.log("(ідентифікаторів немає — посилатися не буде на що)");
} catch (e) {
  console.error("ПОМИЛКА:", (e as Error).message);
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
