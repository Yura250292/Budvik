/**
 * АІ-помічник над аналітикою продажів.
 *
 * Ключове рішення: модель НЕ має доступу до бази й не пише SQL. Спершу
 * звичайні запити збирають зведення (ті самі, що живлять дашборд), і лише
 * готові цифри йдуть у модель — вона їх пояснює й порівнює.
 *
 * Так зроблено з двох причин. По-перше, цифра завжди правильна: модель не
 * може її вигадати, бо не рахує. По-друге, це дешево — у запиті йде кілька
 * тисяч токенів зведення замість десятків тисяч сирих рядків.
 *
 * Модель — DeepSeek: переказати вже пораховані числа українською він уміє не
 * гірше за дорожчі, а коштує вдесятеро менше при щоденному використанні.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FULL_ACCESS_ROLES = new Set(["ADMIN", "MANAGER"]);

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";

const SYSTEM_PROMPT = `Ти аналітик відділу продажів будівельної компанії Budvik.

Тобі дають ГОТОВІ цифри з бази (продажі з 1С за період) і питання від
керівника або торгового. Твоя робота — пояснити, порівняти, знайти
закономірність.

ПРАВИЛА:
1. Використовуй ЛИШЕ надані цифри. Не вигадуй і не оцінюй "приблизно".
2. Якщо даних для відповіді бракує — так і скажи, і вкажи, чого саме бракує.
3. Відповідай стисло: 2-5 речень або короткий список. Це не звіт, а відповідь.
4. Суми пиши в гривнях із розділювачами: 1 234 567 ₴.
5. Українською, діловим тоном, без вступів на кшталт "Звичайно!".
6. Якщо бачиш щось справді варте уваги (різкий спад, аномалію) — скажи,
   навіть якщо не питали. Але без домислів про причини, яких не видно з цифр.`;

/** Компактне зведення для моделі: усе потрібне, нічого зайвого. */
async function buildSummary(days: number, restrictToRep: string | null) {
  const from = new Date();
  from.setDate(from.getDate() - days);

  const repCondition = restrictToRep
    ? Prisma.sql`AND s."salesRepId" = ${restrictToRep}`
    : Prisma.empty;

  const [byRep, byBrand, totals, weekly, topClients] = await Promise.all([
    prisma.$queryRaw<Array<{ rep: string; docs: number; amount: number }>>`
      SELECT u.name AS rep, COUNT(*)::int AS docs, SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      JOIN "User" u ON u.id = s."salesRepId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."createdAt" >= ${from} ${repCondition}
      GROUP BY u.name ORDER BY amount DESC
    `,
    prisma.$queryRaw<Array<{ brand: string | null; amount: number; qty: number }>>`
      SELECT b.name AS brand,
             SUM(i.quantity * i."sellingPrice")::float AS amount,
             SUM(i.quantity)::float AS qty
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."createdAt" >= ${from} ${repCondition}
      GROUP BY b.name ORDER BY amount DESC NULLS LAST LIMIT 20
    `,
    prisma.$queryRaw<Array<{ docs: number; amount: number; avg: number; clients: number }>>`
      SELECT COUNT(*)::int AS docs,
             SUM(s."totalAmount")::float AS amount,
             AVG(s."totalAmount")::float AS avg,
             COUNT(DISTINCT s."counterpartyId")::int AS clients
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."createdAt" >= ${from} ${repCondition}
    `,
    // Тижнями, а не днями: 90 днів по днях — це 90 рядків шуму, з яких
    // модель однаково побачить лише тренд.
    prisma.$queryRaw<Array<{ week: Date; docs: number; amount: number }>>`
      SELECT date_trunc('week', s."createdAt") AS week,
             COUNT(*)::int AS docs, SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."createdAt" >= ${from} ${repCondition}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw<Array<{ client: string; amount: number; docs: number }>>`
      SELECT c.name AS client, SUM(s."totalAmount")::float AS amount, COUNT(*)::int AS docs
      FROM "SalesDocument" s
      JOIN "Counterparty" c ON c.id = s."counterpartyId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."createdAt" >= ${from} ${repCondition}
      GROUP BY c.name ORDER BY amount DESC LIMIT 15
    `,
  ]);

  const round = (n: number | null) => Math.round(n ?? 0);

  return {
    період_днів: days,
    підсумок: {
      сума: round(totals[0]?.amount),
      замовлень: totals[0]?.docs ?? 0,
      середній_чек: round(totals[0]?.avg),
      унікальних_клієнтів: totals[0]?.clients ?? 0,
    },
    торгові: byRep.map((r) => ({
      імя: r.rep,
      сума: round(r.amount),
      замовлень: r.docs,
      середній_чек: r.docs > 0 ? round(r.amount / r.docs) : 0,
    })),
    бренди: byBrand.map((b) => ({
      бренд: b.brand ?? "Без бренду",
      сума: round(b.amount),
      кількість: round(b.qty),
    })),
    по_тижнях: weekly.map((w) => ({
      тиждень: w.week.toISOString().slice(0, 10),
      сума: round(w.amount),
      замовлень: w.docs,
    })),
    топ_клієнтів: topClients.map((c) => ({
      клієнт: c.client,
      сума: round(c.amount),
      замовлень: c.docs,
    })),
  };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role ?? "CLIENT";
  const userId = (session.user as { id?: string }).id;
  const isFullAccess = FULL_ACCESS_ROLES.has(role);

  if (!isFullAccess && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "АІ-помічник не налаштований: бракує DEEPSEEK_API_KEY" },
      { status: 503 }
    );
  }

  let body: { question?: string; days?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний запит" }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "Порожнє питання" }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: "Питання задовге" }, { status: 400 });
  }

  const days = Math.min(365, Math.max(1, body.days ?? 30));

  // Торговий бачить лише свої дані — обмеження на сервері, не в інтерфейсі.
  const restrictToRep = isFullAccess ? null : userId ?? null;

  const summary = await buildSummary(days, restrictToRep);

  // Порожній період: модель тут не потрібна, відповідь очевидна.
  if (summary.підсумок.замовлень === 0) {
    return NextResponse.json({
      answer: `За обраний період (${days} дн.) продажів немає — відповідати нема на чому.`,
      usedTokens: 0,
    });
  }

  const scopeNote = restrictToRep
    ? "Дані охоплюють ЛИШЕ продажі цього торгового."
    : "Дані охоплюють усіх торгових компанії.";

  let res: Response;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${scopeNote}\n\nДАНІ:\n${JSON.stringify(summary, null, 1)}\n\nПИТАННЯ: ${question}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Модель не відповіла: ${(e as Error).message}` },
      { status: 504 }
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("deepseek error", res.status, detail.slice(0, 300));
    return NextResponse.json(
      { error: `Помилка моделі (${res.status})` },
      { status: 502 }
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };

  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    return NextResponse.json({ error: "Порожня відповідь моделі" }, { status: 502 });
  }

  return NextResponse.json({
    answer,
    usedTokens: data.usage?.total_tokens ?? 0,
    period: days,
  });
}
