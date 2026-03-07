import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const { email, password, name, phone } = await req.json();

  if (!email || !password || !name) {
    return NextResponse.json({ error: "Заповніть всі обов'язкові поля" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Користувач з таким email вже існує" }, { status: 400 });
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password: hashed, name, phone, role: "CLIENT", boltsBalance: 50 },
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
