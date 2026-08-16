import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { findSalesRepByRefCode, REF_COOKIE } from "@/lib/ref-code";

export async function POST(req: NextRequest) {
  const { email, password, name, phone } = await req.json();

  if (!email || !password || !name) {
    return NextResponse.json({ error: "Заповніть всі обов'язкові поля" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "Користувач з таким email вже існує" }, { status: 400 });
  }

  // Клієнт прийшов за QR торгового — закріплюємо його одразу при створенні
  const rep = await findSalesRepByRefCode(req.cookies.get(REF_COOKIE)?.value);

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      password: hashed,
      name,
      phone,
      role: "CLIENT",
      boltsBalance: 50,
      referredBySalesRepId: rep?.id ?? null,
    },
  });

  await prisma.boltsTransaction.create({
    data: {
      userId: user.id,
      amount: 50,
      type: "EARNED",
      description: "Вітальний бонус при реєстрації",
    },
  });

  return NextResponse.json({ message: "Реєстрація успішна" });
}
