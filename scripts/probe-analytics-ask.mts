/**
 * Проба роута /api/admin/sales-analytics/ask — панель «спитати» в аналітиці.
 *
 * READ ONLY: роут лише читає базу, проба лише читає роут. Нічого не записано.
 *
 * Навіщо окрема проба. Це єдине бойове місце, куди не дістає
 * `scripts/assistant-turn.mts`: воно живе не в циклі помічника, а власним
 * запитом до моделі, і формат відповіді там особливий — перший рядок JSON із
 * фокусом та іменами, далі текст. Після зміни назви моделі цей формат треба
 * побачити очима, а не сподіватися на нього.
 *
 * Сервер має бути вже піднятий:
 *   npm run dev
 *   npx tsx --env-file=.env scripts/probe-analytics-ask.mts
 */

import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";
const SECRET = process.env.NEXTAUTH_SECRET;
if (!SECRET) {
  console.error("Немає NEXTAUTH_SECRET (запускати з --env-file=.env)");
  process.exit(1);
}

const prisma = new PrismaClient();

const admin = await prisma.user.findFirst({
  where: { role: "ADMIN" },
  select: { id: true, email: true, name: true, role: true },
  orderBy: { createdAt: "asc" },
});
if (!admin) {
  console.error("У базі немає жодного ADMIN");
  process.exit(1);
}

// Обидва імені кукі — як у scripts/check-identity.ts: локально протокол і
// NEXTAUTH_URL розходяться, і secure-варіант сам по собі не долітає.
const token = await encode({
  token: { sub: admin.id, id: admin.id, email: admin.email, name: admin.name, role: admin.role, boltsBalance: 0 },
  secret: SECRET,
});
const cookie = `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;

const QUESTIONS = [
  "Хто з торгових продав найбільше і на скільки відстає наступний?",
  "Що в цих цифрах варте уваги?",
];

console.log(`Проба ${BASE}/api/admin/sales-analytics/ask · від імені ${admin.email}\n`);

let failed = 0;

for (const question of QUESTIONS) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/admin/sales-analytics/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ question, days: 30 }),
    signal: AbortSignal.timeout(120_000),
  });

  const ms = Date.now() - t0;
  const body = (await res.json().catch(() => null)) as {
    answer?: string;
    facts?: unknown[];
    usedTokens?: number;
    error?: string;
  } | null;

  const ok = res.status === 200 && typeof body?.answer === "string" && body.answer.length > 0;
  if (!ok) failed++;

  console.log(`${ok ? "✓" : "✗"} «${question}»`);
  console.log(`   HTTP ${res.status} · ${(ms / 1000).toFixed(1)} с · токенів ${body?.usedTokens ?? "—"}` +
    ` · карток ${Array.isArray(body?.facts) ? body.facts.length : "—"}`);
  if (body?.error) console.log(`   ПОМИЛКА: ${body.error}`);
  if (body?.answer) {
    // Службовий рядок JSON мусить бути знятий: якщо він видно у відповіді —
    // формат розійшовся, і користувач побачить сирий заголовок.
    const leaked = body.answer.trimStart().startsWith("{");
    console.log(`   службовий JSON знято: ${leaked ? "НІ — ВИТІК" : "так"}`);
    if (leaked) failed++;
    console.log(`   відповідь: ${body.answer.slice(0, 220).replace(/\n/g, " ⏎ ")}`);
  }
  console.log();
}

await prisma.$disconnect();
console.log(failed === 0 ? "Усе гаразд. Nothing was written." : `ПАДІНЬ: ${failed}. Nothing was written.`);
process.exit(failed === 0 ? 0 : 1);
