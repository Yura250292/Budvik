/**
 * Стеля на частоту запитів для відкритого мобільного API.
 *
 * Другий рядок захисту, а не перший. Перший — правило Rate Limit у фаєрволі
 * Vercel: воно гасить зловживання ще до виклику функції, тобто безкоштовно.
 * Але воно живе в дашборді, а не в репозиторії, і його можна забути
 * налаштувати — тому найчутливіші роути мають власну стелю.
 *
 * Свідомо не покриває каталог і пошук: там кожен запит коштував би зайвого
 * походу в базу заради захисту від того, від чого краще захищає фаєрвол.
 * Тут — вхід, реєстрація і видалення акаунта, тобто підбір пароля.
 */

import { prisma } from "@/lib/prisma";

export type RateLimitResult = {
  allowed: boolean;
  /** Скільки спроб лишилось у поточному вікні. */
  remaining: number;
};

/**
 * Один атомарний запит замість «прочитати → порахувати → записати».
 *
 * Читання з наступним записом дало б гонку рівно там, де вона потрібна тому,
 * хто підбирає пароль: двадцять паралельних спроб прочитали б однаковий
 * лічильник і всі пройшли б. ON CONFLICT робить це одним кроком у базі.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" ("key", "count", "windowAt")
      VALUES (${key}, 1, now())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimit"."windowAt" < now() - make_interval(secs => ${windowSeconds}::double precision)
          THEN 1
          ELSE "RateLimit"."count" + 1
        END,
        "windowAt" = CASE
          WHEN "RateLimit"."windowAt" < now() - make_interval(secs => ${windowSeconds}::double precision)
          THEN now()
          ELSE "RateLimit"."windowAt"
        END
      RETURNING "count";
    `;

    const count = rows[0]?.count ?? 0;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch (e) {
    /**
     * База не відповіла — пропускаємо.
     *
     * Стеля на частоту не має ставати єдиною точкою відмови всього входу:
     * заблокувати всіх покупців через збій допоміжної таблиці гірше, ніж
     * пропустити кілька спроб підбору.
     */
    console.error("[rate-limit] не спрацював, пропускаємо:", e);
    return { allowed: true, remaining: limit };
  }
}

/**
 * Адреса, з якої прийшов запит.
 *
 * За проксі Vercel реальний клієнт — перший у списку x-forwarded-for; решта
 * там це вже проміжні вузли. Без адреси ключем стає "unknown", і стеля
 * працює на всіх разом — грубо, але краще, ніж не працювати зовсім.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Готова відповідь: без деталей про те, скільки саме лишилось чекати. */
export function tooManyRequests() {
  return Response.json(
    { error: "Забагато спроб. Спробуйте за кілька хвилин." },
    { status: 429, headers: { "Cache-Control": "no-store" } }
  );
}
