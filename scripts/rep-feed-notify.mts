/**
 * Стрічка торгового по живій базі: що знайшли детектори й кому пішов би пуш.
 *
 *   npx tsx --env-file=.env scripts/rep-feed-notify.mts                 # dry: від курсора
 *   npx tsx --env-file=.env scripts/rep-feed-notify.mts --since 2026-09-12T06:00:00Z
 *   npx tsx --env-file=.env scripts/rep-feed-notify.mts --at 14:30      # dry, «зараз» = сьогодні 14:30 Києва
 *   npx tsx --env-file=.env scripts/rep-feed-notify.mts --send          # справжній прохід
 *
 * Без --send нічого не пишеться: ні рядків у стрічку, ні курсора, ні
 * пушів. Локальний .env дивиться в бойову базу, тож --send — лише свідомо
 * (це той самий тік, що робить воркер).
 */
import { prisma } from "../src/lib/prisma";
import { kyivDate, kyivDayStart, kyivTime } from "../src/lib/date/kyiv";
import { TYPE_LABELS } from "../src/lib/rep-feed/format";
import { CURSOR_KEY, notifyRepFeed } from "../src/lib/rep-feed/notify";

const has = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

const send = has("send");
const sinceArg = arg("since");
const atArg = arg("at");

let now = new Date();
if (atArg) {
  const day = kyivDate(now);
  const [h, m] = atArg.split(":").map(Number);
  now = new Date(kyivDayStart(day).getTime() + (h * 60 + m) * 60_000);
}
const since = sinceArg ? new Date(sinceArg) : undefined;
if (since && Number.isNaN(since.getTime())) throw new Error(`--since не дата: ${sinceArg}`);
if (send && (since || atArg)) throw new Error("--send не поєднується з --since/--at");

const cursor = await prisma.syncState.findUnique({ where: { key: CURSOR_KEY } });
console.log(
  `курсор: ${cursor ? `${cursor.value} (оновлено ${cursor.updatedAt.toISOString()})` : "немає — перший прохід лише прогріє"}`
);
console.log(`зараз: ${now.toISOString()} (${kyivDate(now)} ${kyivTime(now)} Києва), режим ${send ? "SEND" : "dry"}\n`);

const run = await notifyRepFeed({ now, dry: !send, since });

if (run.warmed) {
  console.log("курсор прогріто, подій не шукали");
} else {
  console.log(`з ${run.since?.toISOString()}: подій ${run.events.length}, нових ${run.inserted}, відомих ${run.known}\n`);
  const names = new Map(run.pushes.map((p) => [p.repId, p.name ?? p.repId]));
  for (const e of run.events) {
    console.log(
      `  ${kyivTime(e.at)}  ${TYPE_LABELS[e.type].padEnd(11)} ${(names.get(e.repId) ?? e.repId).padEnd(22)} ${e.title} — ${e.body}`
    );
  }
  console.log("");
  for (const p of run.pushes) {
    console.log(`${p.sent ? "ПУШ " : "    "} ${(p.name ?? p.repId).padEnd(22)} ${p.events} под.  ${p.why}`);
    console.log(`         ${p.title}\n         ${p.body}\n         → ${p.target}`);
  }
  if (run.pushes.length === 0) console.log("нових подій немає — пушів не буде");
}

// Скільки з них узагалі дістануться телефона.
const repIds = [...new Set(run.pushes.map((p) => p.repId))];
if (repIds.length > 0) {
  const live = await prisma.pushToken.groupBy({
    by: ["userId"],
    where: { revokedAt: null, userId: { in: repIds } },
    _count: true,
  });
  console.log(`\nіз ${repIds.length} торгових мають живий пристрій: ${live.length}`);
}

await prisma.$disconnect();
