import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { confirmSalesDocument } from "@/lib/erp/sales";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { id } = await params;
    await confirmSalesDocument(id);

    // If confirmed by a SALES rep — notify all managers
    if (session.user.role === "SALES") {
      const doc = await prisma.salesDocument.findUnique({
        where: { id },
        select: { number: true, totalAmount: true, counterparty: { select: { name: true } } },
      });

      const managers = await prisma.user.findMany({
        where: { role: { in: ["ADMIN", "MANAGER"] } },
        select: { id: true },
      });

      if (doc && managers.length > 0) {
        const clientName = doc.counterparty?.name ?? "клієнта";
        await prisma.notification.createMany({
          data: managers.map((m) => ({
            userId: m.id,
            type: "SALES_DOC_CONFIRMED",
            title: "Нове замовлення потребує підтвердження",
            body: `${session.user.name} підтвердив замовлення №${doc.number} (${clientName}) на суму ${doc.totalAmount.toLocaleString("uk-UA", { style: "currency", currency: "UAH" })}`,
            relatedId: id,
          })),
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
