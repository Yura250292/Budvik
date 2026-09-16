/**
 * Пропозиції клієнтам: що закрив би воркер — «замовив» чи «без відповіді».
 *
 *   npx tsx --env-file=.env scripts/outreach-settle-dry.mts                          # dry, «зараз»
 *   npx tsx --env-file=.env scripts/outreach-settle-dry.mts --now 2026-09-30T12:00:00Z
 *   DATABASE_URL=postgresql://…/scratch npx tsx scripts/outreach-settle-dry.mts --apply
 *
 * Без --apply нічого не пише. З --apply — той самий прохід, що tickOutreach у
 * воркері: пише лише таблицю ClientOutreach на сайті. Локальний .env дивиться
 * в бойову базу, тож --apply — лише свідомо. У 1С не пишеться нічого.
 *
 * Поки міграцію client_outreach не накочено, скрипт каже про це одним рядком
 * і виходить із кодом 2.
 */
import { prisma } from "../src/lib/prisma";
import { isOutreachTableMissing, settleOutreachOutcomes } from "../src/lib/outreach/settle";

const has = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const apply = has("apply");
const nowArg = arg("now");
const now = nowArg ? new Date(nowArg) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`--now не дата: ${nowArg}`);
  process.exit(1);
}

function dbLabel(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "DATABASE_URL не задано";
  }
}

async function outcomes(): Promise<string> {
  const rows = await prisma.clientOutreach.groupBy({ by: ["outcome"], _count: true, orderBy: { outcome: "asc" } });
  return rows.length ? rows.map((r) => `${r.outcome} ${r._count}`).join(", ") : "порожньо";
}

console.log(`база: ${dbLabel()}`);
console.log(`зараз: ${now.toISOString()}, режим ${apply ? "APPLY (пише ClientOutreach)" : "dry (нічого не пише)"}\n`);

let code = 0;
try {
  console.log(`до:    ${await outcomes()}`);
  const run = await settleOutreachOutcomes({ now, dry: !apply });
  console.log(`\n${apply ? "закрито" : "закрив би"}: замовили ${run.ordered}, без відповіді ${run.noAnswer}`);
  for (const line of run.lines) console.log(`  ${line}`);
  if (run.lines.length === 0) console.log("  нічого закривати");
  console.log(`\nпісля: ${await outcomes()}${apply ? "" : " (dry — без змін)"}`);
} catch (e) {
  if (isOutreachTableMissing(e)) {
    console.error(
      "таблиці ClientOutreach у цій базі ще немає — міграцію 20260916110000_client_outreach не накочено. Нічого не зроблено."
    );
    code = 2;
  } else {
    console.error(e);
    code = 1;
  }
} finally {
  await prisma.$disconnect();
}
process.exit(code);
