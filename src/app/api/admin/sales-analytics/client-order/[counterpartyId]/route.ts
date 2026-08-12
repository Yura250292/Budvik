/**
 * Картка клієнта на карті: що брав минулого разу і що запропонувати далі.
 *
 * Окремим роутом, а не полем у /client-map: заміряно, що зібрати останні
 * документи всіх 725 клієнтів коштує 1.3 с, і карта, яка зараз відкривається
 * одразу, чекала б на дані, потрібні для одного піна. Тут — по кліку, на
 * одного клієнта, за одиниці мілісекунд.
 *
 * Доступ ширший, ніж у самої карти (ADMIN/MANAGER): SALES теж пускаємо, бо
 * саме торговий готується до візиту. Для SALES навмисно НЕ фільтруємо по
 * salesRepId: у 1С торговий проставлений не в усіх документах (див.
 * clientPortfolioAll), і такий фільтр приховав би від людини половину
 * історії її ж клієнта.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lastOrders, recommendations } from "@/lib/analytics/clientOrder";

export const dynamic = "force-dynamic";

const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!STAFF_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { counterpartyId } = await params;

  const [client, orders, recos] = await Promise.all([
    prisma.counterparty.findUnique({
      where: { id: counterpartyId },
      select: { id: true, name: true },
    }),
    lastOrders(counterpartyId),
    recommendations(counterpartyId),
  ]);

  if (!client) {
    return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  }

  // Порожня історія — не помилка: у клієнта може не бути жодної реалізації
  // з 1С. Модалка покаже це текстом, а не екраном помилки.
  return NextResponse.json({
    client,
    orders,
    recommendations: recos,
    source: "Проведені реалізації та повернення з 1С",
  });
}
