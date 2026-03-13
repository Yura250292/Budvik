import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { amount, method, notes } = body;

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Вкажіть суму оплати" }, { status: 400 });
  }

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  const newPaidAmount = invoice.paidAmount + amount;
  const paymentStatus = newPaidAmount >= invoice.totalAmount ? "PAID" : "PARTIAL";

  await prisma.$transaction([
    prisma.payment.create({
      data: {
        invoiceId: id,
        amount,
        method: method || "bank_transfer",
        notes: notes || null,
      },
    }),
    prisma.invoice.update({
      where: { id },
      data: {
        paidAmount: newPaidAmount,
        paymentStatus,
      },
    }),
  ]);

  return NextResponse.json({ ok: true, paidAmount: newPaidAmount, paymentStatus });
}
