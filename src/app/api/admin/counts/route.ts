import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Лічильники для стат-віджетів дашборду.
 *
 * Раніше віджети тягнули чотири повні списки (/api/orders із товарами в
 * кожній позиції, /api/admin/users, /api/products, /api/admin/wholesale)
 * лише щоб порахувати .length — мегабайти заради шести чисел. Тут ті самі
 * числа рахує база: шість count() за один запит до роуту.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Список користувачів для SALES закритий (див. middleware), але самі
  // цифри «скільки клієнтів» не розкривають нічого персонального.
  const [orders, activeOrders, products, clients, wholesale, pendingWholesale] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: { notIn: ["DELIVERED", "CANCELLED"] } } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.user.count({ where: { role: "CLIENT" } }),
    prisma.user.count({ where: { role: "WHOLESALE" } }),
    prisma.wholesaleApplication.count({ where: { status: "PENDING" } }),
  ]);

  return NextResponse.json({ orders, activeOrders, products, clients, wholesale, pendingWholesale });
}
