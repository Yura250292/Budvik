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
import { SOURCE_FILTER, SALES_ONLY } from "@/lib/analytics/facts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FULL_ACCESS_ROLES = new Set(["ADMIN", "MANAGER"]);

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";

const SYSTEM_PROMPT = `Ти аналітик відділу продажів будівельної компанії Budvik.

Тобі дають ГОТОВІ цифри з бази і питання від керівника або торгового.
Цифри — це РЕАЛІЗАЦІЇ з 1С за період, тобто фактично відвантажений товар,
а не замовлення. Так і називай їх: реалізації, відвантаження, продажі.
Твоя робота — пояснити, порівняти, знайти закономірність.

ПОВЕРНЕННЯ. Усі суми вже НЕТТО: повернення від покупців віднято. Окремо
дається поле "повернення" (додатне число — скільки повернули) і
"частка_повернень_відсотків". Лічильники (реалізацій, клієнтів) рахують
лише продажі, повернення їх не роздувають. Висока частка повернень — це
привід сказати, але причини з цифр не видно, тож не вигадуй їх.

ПРАВИЛА:
1. Використовуй ЛИШЕ надані цифри. Не вигадуй і не оцінюй "приблизно".
2. Якщо даних для відповіді бракує — так і скажи, і вкажи, чого саме бракує.
3. Відповідай стисло: 2-5 речень або короткий список. Це не звіт, а відповідь.
4. Суми пиши в гривнях із розділювачами: 1 234 567 ₴.
5. Українською, діловим тоном, без вступів на кшталт "Звичайно!".
6. Якщо бачиш щось справді варте уваги (різкий спад, аномалію) — скажи,
   навіть якщо не питали. Але без домислів про причини, яких не видно з цифр.

ФОРМАТ ВІДПОВІДІ. Спершу — рядок JSON, потім з нового рядка звичайний текст:
{"focus":"reps|brands|clients|none","names":["точні імена з даних"]}
У "names" клади ЛИШЕ ті імена, які дослівно є в даних, і лише ті, про кого
справді йдеться у відповіді (максимум 6). Якщо питання загальне — "none" і
порожній список. Сам JSON у тексті відповіді не повторюй і не коментуй.`;

/**
 * Вікно періоду з запиту.
 *
 * from/to — те, що стоїть в адресі сторінки; days лишається запасним
 * варіантом для старих викликів. `to` розтягуємо до кінця доби, бо
 * "2026-08-10" парситься як опівніч, і весь останній день випав би.
 */
function resolvePeriod(fromRaw?: string, toRaw?: string, daysRaw?: number) {
  const from = fromRaw ? new Date(`${fromRaw}T00:00:00`) : null;
  const to = toRaw ? new Date(`${toRaw}T23:59:59.999`) : null;

  if (from && to && !Number.isNaN(+from) && !Number.isNaN(+to) && from <= to) {
    const days = Math.max(1, Math.round((+to - +from) / 86_400_000));
    return { from, to, days };
  }

  const days = Math.min(365, Math.max(1, daysRaw ?? 30));
  const fallbackFrom = new Date();
  fallbackFrom.setDate(fallbackFrom.getDate() - days);
  return { from: fallbackFrom, to: new Date(), days };
}

/**
 * Компактне зведення для моделі: усе потрібне, нічого зайвого.
 *
 * Гроші рахуються нетто (повернення в сумі з мінусом), а лічильники —
 * лише по продажах через SALES_ONLY. Без цього 2,5 тис. повернень
 * додалися б до "реалізацій", а від'ємні суми зіпсували б середній чек.
 */
async function buildSummary(from: Date, to: Date, days: number, restrictToRep: string | null) {
  const repCondition = restrictToRep
    ? Prisma.sql`AND s."salesRepId" = ${restrictToRep}`
    : Prisma.empty;

  const [byRep, byBrand, totals, weekly, topClients] = await Promise.all([
    prisma.$queryRaw<Array<{ rep: string; docs: number; amount: number; returns: number }>>`
      SELECT u.name AS rep,
             COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
             SUM(s."totalAmount")::float AS amount,
             -SUM(s."totalAmount") FILTER (WHERE NOT (${SALES_ONLY}))::float AS returns
      FROM "SalesDocument" s
      JOIN "User" u ON u.id = s."salesRepId"
      WHERE ${SOURCE_FILTER}
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to} ${repCondition}
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
      WHERE ${SOURCE_FILTER}
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to} ${repCondition}
      GROUP BY b.name ORDER BY amount DESC NULLS LAST LIMIT 20
    `,
    prisma.$queryRaw<
      Array<{ docs: number; amount: number; avg: number; clients: number; returns: number }>
    >`
      SELECT COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
             SUM(s."totalAmount")::float AS amount,
             AVG(s."totalAmount") FILTER (WHERE ${SALES_ONLY})::float AS avg,
             COUNT(DISTINCT s."counterpartyId") FILTER (WHERE ${SALES_ONLY})::int AS clients,
             -SUM(s."totalAmount") FILTER (WHERE NOT (${SALES_ONLY}))::float AS returns
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to} ${repCondition}
    `,
    // Тижнями, а не днями: 90 днів по днях — це 90 рядків шуму, з яких
    // модель однаково побачить лише тренд.
    prisma.$queryRaw<Array<{ week: Date; docs: number; amount: number }>>`
      SELECT date_trunc('week', s."createdAt") AS week,
             COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
             SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to} ${repCondition}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw<Array<{ client: string; amount: number; docs: number; returns: number }>>`
      SELECT c.name AS client,
             SUM(s."totalAmount")::float AS amount,
             COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
             -SUM(s."totalAmount") FILTER (WHERE NOT (${SALES_ONLY}))::float AS returns
      FROM "SalesDocument" s
      JOIN "Counterparty" c ON c.id = s."counterpartyId"
      WHERE ${SOURCE_FILTER}
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to} ${repCondition}
      GROUP BY c.name ORDER BY amount DESC LIMIT 15
    `,
  ]);

  const round = (n: number | null) => Math.round(n ?? 0);

  // Частку рахуємо від валу (нетто + повернення), а не від нетто: інакше
  // при поверненнях, більших за продажі, вийшло б понад 100%.
  const returnShare = (returns: number, net: number) => {
    const gross = net + returns;
    return gross > 0 ? Math.round((returns / gross) * 1000) / 10 : 0;
  };

  const totalReturns = round(totals[0]?.returns);
  const totalAmount = round(totals[0]?.amount);

  return {
    період_днів: days,
    підсумок: {
      сума: totalAmount,
      реалізацій: totals[0]?.docs ?? 0,
      середній_чек: round(totals[0]?.avg),
      унікальних_клієнтів: totals[0]?.clients ?? 0,
      повернення: totalReturns,
      частка_повернень_відсотків: returnShare(totalReturns, totalAmount),
    },
    торгові: byRep.map((r) => ({
      імя: r.rep,
      сума: round(r.amount),
      реалізацій: r.docs,
      середній_чек: r.docs > 0 ? round(r.amount / r.docs) : 0,
      повернення: round(r.returns),
      частка_повернень_відсотків: returnShare(round(r.returns), round(r.amount)),
    })),
    бренди: byBrand.map((b) => ({
      бренд: b.brand ?? "Без бренду",
      сума: round(b.amount),
      кількість: round(b.qty),
    })),
    по_тижнях: weekly.map((w) => ({
      тиждень: w.week.toISOString().slice(0, 10),
      сума: round(w.amount),
      реалізацій: w.docs,
    })),
    топ_клієнтів: topClients.map((c) => ({
      клієнт: c.client,
      сума: round(c.amount),
      реалізацій: c.docs,
      повернення: round(c.returns),
    })),
  };
}

type Focus = "reps" | "brands" | "clients" | "none";

/** Картка показника поруч із текстом відповіді. */
export type AskFact = {
  name: string;
  amount: number;
  docs: number;
  average: number;
  /** Частка від найбільшого у вибірці — довжина смуги в інтерфейсі. */
  share: number;
};

/**
 * Відділяє службовий JSON-заголовок від тексту для людини.
 *
 * Модель іноді загортає його у ```json — знімаємо й це. Якщо заголовка
 * немає або він побитий, показуємо текст як є: краще відповідь без
 * карток, ніж помилка на рівному місці.
 */
function splitFocus(raw: string): { answer: string; focus: Focus; names: string[] } {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const brace = cleaned.indexOf("{");
  const end = cleaned.indexOf("}");

  if (brace === 0 && end > 0) {
    try {
      const head = JSON.parse(cleaned.slice(0, end + 1)) as { focus?: string; names?: unknown };
      const focus: Focus = ["reps", "brands", "clients"].includes(head.focus ?? "")
        ? (head.focus as Focus)
        : "none";
      const names = Array.isArray(head.names)
        ? head.names.filter((n): n is string => typeof n === "string").slice(0, 6)
        : [];
      const answer = cleaned.slice(end + 1).trim();
      if (answer) return { answer, focus, names };
    } catch {
      // Побитий JSON — нижче віддамо весь текст без карток.
    }
  }

  // Заголовок є, але непридатний — прибираємо його з тексту, інакше
  // користувач побачить сирий JSON у відповіді.
  const stripped = brace === 0 && end > 0 ? cleaned.slice(end + 1).trim() : cleaned;
  return { answer: stripped || cleaned, focus: "none", names: [] };
}

/**
 * Числа для карток — з нашого зведення, а не зі слів моделі.
 *
 * Модель лише називає, ПРО КОГО йдеться; суми ми підставляємо з тих
 * самих рядків, що пішли в запит. Тому картка не може розійтися з базою,
 * навіть якщо модель помилилася в тексті.
 */
function buildFacts(
  summary: Awaited<ReturnType<typeof buildSummary>>,
  focus: Focus,
  names: string[]
): AskFact[] {
  if (focus === "none" || names.length === 0) return [];

  const pool: AskFact[] =
    focus === "reps"
      ? summary.торгові.map((r) => ({
          name: r.імя,
          amount: r.сума,
          docs: r.реалізацій,
          average: r.середній_чек,
          share: 0,
        }))
      : focus === "brands"
        ? summary.бренди.map((b) => ({
            name: b.бренд,
            amount: b.сума,
            docs: 0,
            average: 0,
            share: 0,
          }))
        : summary.топ_клієнтів.map((c) => ({
            name: c.клієнт,
            amount: c.сума,
            docs: c.реалізацій,
            average: c.реалізацій > 0 ? Math.round(c.сума / c.реалізацій) : 0,
            share: 0,
          }));

  // Зіставлення нестроге: модель пише «Кулик Дмитро», у базі може бути
  // «Кулик Дмитро Іванович». Але лише в один бік і по підрядку — щоб
  // випадкове «Олександр» не підтягнуло трьох різних людей, беремо
  // перший збіг на кожне ім'я.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const picked: AskFact[] = [];
  for (const name of names) {
    const key = norm(name);
    const hit =
      pool.find((p) => norm(p.name) === key) ??
      pool.find((p) => norm(p.name).includes(key) || key.includes(norm(p.name)));
    if (hit && !picked.some((p) => p.name === hit.name)) picked.push(hit);
  }

  const max = Math.max(...picked.map((p) => p.amount), 0);
  return picked
    .map((p) => ({ ...p, share: max > 0 ? (p.amount / max) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
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

  let body: { question?: string; days?: number; from?: string; to?: string };
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

  // Вікно беремо з from/to — тих самих, що в адресі сторінки. Інакше
  // помічник відповідав би за «останні N днів від сьогодні», а дашборд
  // поруч показував би інший відрізок, і цифри не сходилися б.
  const { from, to, days } = resolvePeriod(body.from, body.to, body.days);

  // Торговий бачить лише свої дані — обмеження на сервері, не в інтерфейсі.
  const restrictToRep = isFullAccess ? null : userId ?? null;

  const summary = await buildSummary(from, to, days, restrictToRep);

  // Порожній період: модель тут не потрібна, відповідь очевидна. Період
  // із самими поверненнями порожнім НЕ вважаємо — там є про що казати.
  if (summary.підсумок.реалізацій === 0 && summary.підсумок.повернення === 0) {
    return NextResponse.json({
      answer: `За обраний період (${days} дн.) продажів немає — відповідати нема на чому.`,
      facts: [],
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

  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    return NextResponse.json({ error: "Порожня відповідь моделі" }, { status: 502 });
  }

  const { answer, focus, names } = splitFocus(raw);

  return NextResponse.json({
    answer,
    facts: buildFacts(summary, focus, names),
    usedTokens: data.usage?.total_tokens ?? 0,
    period: { days, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
  });
}
