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
import {
  lastOrders,
  orderSummary,
  ordersSince,
  recommendations,
  ORDERS_LIMIT,
  ORDER_MONTHS,
  type OrderMonths,
} from "@/lib/analytics/clientOrder";
import { kyivDate } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

/**
 * DRIVER теж читає: водій везе коробки й на місці чує «а це вже брали?».
 * Тільки читання — замовлень він не створює.
 */
const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES", "DRIVER"];

/**
 * Поради рахуються до 1.3 с у клієнта з великою історією (заміряно на
 * «КУВАЛДА ЛИПИНСЬКОГО»), а список замовлень — 0.2 с. Тому перемикання
 * періоду тягне ЛИШЕ замовлення: `only=orders`. Інакше кожен тап по «6
 * місяців» перераховував би поради, які від періоду не залежать взагалі.
 */
type Only = "orders" | "reco" | null;

export async function GET(
  req: NextRequest,
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
  const url = new URL(req.url);

  const onlyParam = url.searchParams.get("only");
  const only: Only = onlyParam === "orders" || onlyParam === "reco" ? onlyParam : null;

  // Невідоме значення зводимо до 0 («уся історія»), а не до помилки: період
  // приходить із перемикача, і зламаний URL не привід показати екран помилки.
  const raw = Number(url.searchParams.get("months"));
  const months: OrderMonths = (ORDER_MONTHS as readonly number[]).includes(raw)
    ? (raw as OrderMonths)
    : 0;
  const since = ordersSince(months);

  const [client, orders, summary, recos] = await Promise.all([
    prisma.counterparty.findUnique({
      where: { id: counterpartyId },
      select: { id: true, name: true },
    }),
    only === "reco" ? Promise.resolve(null) : lastOrders(counterpartyId, { since }),
    only === "reco" ? Promise.resolve(null) : orderSummary(counterpartyId, since),
    only === "orders" ? Promise.resolve(null) : recommendations(counterpartyId),
  ]);

  if (!client) {
    return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });
  }

  // Порожня історія — не помилка: у клієнта може не бути жодної реалізації
  // з 1С. Модалка покаже це текстом, а не екраном помилки.
  return NextResponse.json({
    client,
    ...(orders
      ? {
          orders,
          summary,
          period: {
            months,
            sinceDay: kyivDate(since),
            /** Список обрізано стелею — підсумок вище все одно за весь період. */
            truncated: orders.length >= ORDERS_LIMIT,
            limit: ORDERS_LIMIT,
          },
        }
      : {}),
    ...(recos ? { recommendations: recos } : {}),
    source: "Проведені реалізації та повернення з 1С",
  });
}
