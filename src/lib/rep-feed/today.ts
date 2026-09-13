/**
 * «Сьогодні в цифрах» для головної торгового.
 *
 * Замовлення — з тим самим підрахунком, що й на карті дня
 * (`ordersSummaryForRep`): чернетки окремо, бо офіс проводить документ
 * годинами пізніше, і «0 ₴ до вечора» було б неправдою.
 *
 * Зібране — рознесені на торгового оплати з датою ПКО за сьогодні. Дата
 * 1С лежить як київський час у UTC, тож межі дня беруться як UTC-доба
 * (див. docDayBounds). Оплата без дати — за моментом, коли її отримав сайт.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { ordersSummaryForRep, type OrdersSummary } from "@/lib/track/orders-today";
import { docDayBounds } from "./format";

export type RepToday = {
  day: string;
  orders: OrdersSummary;
  collectedUah: number;
  collectedCount: number;
};

export async function repToday(repId: string, now = new Date()): Promise<RepToday> {
  const day = kyivDate(now);
  const doc = docDayBounds(day);

  const [orders, collected] = await Promise.all([
    ordersSummaryForRep(repId, day),
    prisma.paymentAllocation.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: {
        repId,
        payment: {
          OR: [
            { paidAt: { gte: doc.from, lte: doc.to } },
            { paidAt: null, createdAt: { gte: kyivDayStart(day), lte: kyivDayEnd(day) } },
          ],
        },
      },
    }),
  ]);

  return {
    day,
    orders,
    collectedUah: Math.round(collected._sum.amount ?? 0),
    collectedCount: collected._count._all,
  };
}
