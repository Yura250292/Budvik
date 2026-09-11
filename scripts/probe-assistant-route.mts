/**
 * Проба помічника через СПРАВЖНІЙ роут — локально або на проді.
 *
 * READ ONLY щодо даних фірми. Єдине, що пишеться, — власна розмова проби в
 * таблицях AssistantThread/AssistantMessage: інакше хід неможливий, бо історія
 * живе в базі. Розмова позначена в першому питанні, і скрипт прибирає її за
 * собою, якщо не сказано --keep.
 *
 * Навіщо окремо від `scripts/assistant-turn.mts`. Той викликає `runTurn`
 * напряму, тобто перевіряє ЛОКАЛЬНИЙ код на прод-базі. Після деплою треба
 * інше: чи працює код, який справді лежить на проді, — разом із сесією,
 * ролями, стрімом SSE і 120-секундним вікном Vercel.
 *
 *   npx tsx --env-file=.env scripts/probe-assistant-route.mts
 *   PROBE_BASE=https://www.budvik27.com npx tsx --env-file=.env scripts/probe-assistant-route.mts
 */

import { PrismaClient, type Role } from "@prisma/client";
import { encode } from "next-auth/jwt";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";
const KEEP = process.argv.includes("--keep");
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Немає ${name} (запускати з --env-file=.env)`);
    process.exit(1);
  }
  return v;
}
const SECRET = requireEnv("NEXTAUTH_SECRET");

const prisma = new PrismaClient();

/** Питання навмисно причинне: саме такі вмикають міркування в керівника. */
const QUESTION =
  "Порівняй середній чек реалізації у серпні й у вересні по кожному торговому. У кого він впав найсильніше і чи це через менші замовлення, чи через меншу кількість клієнтів?";

async function cookieFor(u: { id: string; email: string | null; name: string | null; role: Role }) {
  const t = await encode({
    token: { sub: u.id, id: u.id, email: u.email, name: u.name, role: u.role, boltsBalance: 0 },
    secret: SECRET,
  });
  // Обидва імені — як у scripts/check-identity.ts: локально протокол і
  // NEXTAUTH_URL розходяться, і secure-варіант сам по собі не долітає.
  return `next-auth.session-token=${t}; __Secure-next-auth.session-token=${t}`;
}

const who = await prisma.user.findFirst({
  where: { role: "ADMIN" },
  select: { id: true, email: true, name: true, role: true },
  orderBy: { createdAt: "asc" },
});
if (!who) {
  console.error("У базі немає жодного ADMIN");
  process.exit(1);
}

const cookie = await cookieFor(who);
console.log(`Проба ${BASE} · помічник від імені ${who.email} (${who.role})\n`);

/**
 * Рештки попередніх прогонів прибираємо на старті.
 *
 * Проба може впасти після ходу — тоді розмова лишається висіти в кабінеті
 * живої людини. Шукаємо за підписом розмови: його складає createThread із
 * перших слів першого питання, а питання тут завжди те саме.
 */
const MARK = QUESTION.slice(0, 24);
const stale = await prisma.assistantThread.findMany({
  where: { userId: who.id, title: { startsWith: MARK } },
  select: { id: true },
});
if (stale.length > 0) {
  const ids = stale.map((t) => t.id);
  await prisma.assistantMessage.deleteMany({ where: { threadId: { in: ids } } });
  await prisma.assistantThread.deleteMany({ where: { id: { in: ids } } });
  console.log(`прибрано розмов від попередніх прогонів: ${stale.length}`);
}

/* ── Розмова ───────────────────────────────────────────────────────────── */

const created = await fetch(`${BASE}/api/sales/assistant/threads`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie },
  body: JSON.stringify({}),
});
const createdBody = (await created.json().catch(() => null)) as { id?: string; error?: string } | null;
if (created.status !== 201 || !createdBody?.id) {
  console.error(`✗ розмова не створилася: HTTP ${created.status} ${JSON.stringify(createdBody)}`);
  process.exit(1);
}
const threadId = createdBody.id;
console.log(`розмова ${threadId}`);

/* ── Хід зі стрімом ────────────────────────────────────────────────────── */

const t0 = Date.now();
const res = await fetch(`${BASE}/api/sales/assistant/threads/${threadId}/messages`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie },
  body: JSON.stringify({ text: QUESTION }),
  signal: AbortSignal.timeout(180_000),
});

const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}с`;
let failed = 0;

if (!res.ok || !res.body) {
  const detail = await res.text().catch(() => "");
  console.error(`✗ хід не почався: HTTP ${res.status} ${detail.slice(0, 300)}`);
  // Челендж Vercel ріже не-браузерні клієнти, і це виглядає як поломка коду.
  console.error(`   x-vercel-mitigated: ${res.headers.get("x-vercel-mitigated") ?? "—"}`);
  failed++;
} else {
  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
  let buf = "";
  let text = "";
  let errors = 0;
  const tools: string[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.replace(/\r\n/g, "\n").split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      let event = "";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!event) continue;
      let payload: Record<string, unknown> = {};
      try {
        payload = data ? (JSON.parse(data) as Record<string, unknown>) : {};
      } catch {
        /* keep-alive і побиті шматки пропускаємо */
      }
      if (event === "tool_start") {
        tools.push(String(payload.name ?? "?"));
        console.log(`[${at()}] ► ${payload.label ?? payload.name}`);
      } else if (event === "tool_done") {
        console.log(`[${at()}] ✓ ${payload.name} ${payload.ok === false ? "— ПОМИЛКА " : ""}${payload.ms ?? "?"} мс`);
      } else if (event === "delta") {
        text += String(payload.text ?? "");
      } else if (event === "drop") {
        text = "";
      } else if (event === "error") {
        errors++;
        console.log(`[${at()}] ✗ ${payload.message}`);
      }
    }
  }

  console.log(`\n${"─".repeat(70)}\n${text.slice(0, 1200)}\n${"─".repeat(70)}`);

  // Остання репліка помічника і є відповіддю: проміжні несуть tool_calls і
  // нульові токени. Фільтрувати по toolCalls не можна — Prisma не приймає
  // null у фільтрі Json-поля, а падіння тут лишило б розмову проби в базі.
  const saved = await prisma.assistantMessage.findFirst({
    where: { threadId, role: "ASSISTANT" },
    orderBy: { createdAt: "desc" },
    select: { promptTokens: true, completionTokens: true, durationMs: true, error: true },
  });

  console.log(
    `інструментів ${tools.length} · токенів вхід ${saved?.promptTokens ?? 0}, вихід ${saved?.completionTokens ?? 0}` +
      ` · ${((Date.now() - t0) / 1000).toFixed(1)} с`
  );

  if (errors > 0) {
    console.log("✗ у стрімі була подія error");
    failed++;
  }
  if (text.length < 200) {
    console.log("✗ відповідь підозріло коротка або порожня");
    failed++;
  }
  if (saved?.error) {
    console.log(`✗ у базі збережено помилку: ${saved.error}`);
    failed++;
  }
}

/* ── Прибирання ────────────────────────────────────────────────────────── */

if (KEEP) {
  console.log(`\nрозмову ${threadId} лишено (--keep)`);
} else {
  await prisma.assistantMessage.deleteMany({ where: { threadId } });
  await prisma.assistantThread.delete({ where: { id: threadId } }).catch(() => {});
  console.log(`\nрозмову проби ${threadId} прибрано`);
}

await prisma.$disconnect();
console.log(failed === 0 ? "Усе гаразд." : `ПАДІНЬ: ${failed}.`);
process.exit(failed === 0 ? 0 : 1);
