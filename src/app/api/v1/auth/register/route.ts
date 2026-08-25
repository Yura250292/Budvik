/**
 * Реєстрація з застосунку.
 *
 * Відрізняється від /api/register одним, але важливим: одразу віддає токен.
 * На сайті після реєстрації людина потрапляє на форму входу й вводить те саме
 * ще раз — у застосунку такий крок читався б як «щось пішло не так», та й
 * набирати пароль на телефоні двічі нікому не хочеться.
 *
 * Куки реферала тут немає: QR торгового веде на сайт і ставить її браузеру.
 * Реєстрація із застосунку лишається без прив'язки, і createOrder усе одно
 * дожене її при першому замовленні, якщо людина колись відкривала QR.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { BCRYPT_COST, MIN_PASSWORD_LENGTH, EMAIL_RE } from "@/lib/auth/credentials";
import { normalizePhone } from "@/lib/phone";
import { issueShopToken } from "@/lib/shop/app-token";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/shop/rate-limit";

export const dynamic = "force-dynamic";

/** Вітальні Болти — стільки ж, скільки дає реєстрація на сайті. */
const WELCOME_BOLTS = 50;

export async function POST(req: Request) {
  /**
   * Стеля на реєстрацію: без неї відкритий роут — це безкоштовний спосіб
   * набити базу тисячами акаунтів, кожен із яких отримає 50 вітальних Болтів.
   */
  const limit = await rateLimit(`register:ip:${clientIp(req)}`, 5, 3600);
  if (!limit.allowed) return tooManyRequests();

  const { email, password, name, phone, deviceName } = await req
    .json()
    .catch(() => ({}));

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Вкажіть імʼя" }, { status: 400 });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "Вкажіть коректний email" }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Пароль має бути не коротшим за ${MIN_PASSWORD_LENGTH} символів` },
      { status: 400 }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Користувач з таким email вже існує" },
      { status: 409 }
    );
  }

  const hashed = await bcrypt.hash(password, BCRYPT_COST);

  /**
   * Користувач і вітальні Болти — однією транзакцією.
   *
   * На сайті це два послідовні запити, і збій між ними лишав би акаунт із
   * балансом 50 у полі, але без рядка в історії — людина бачила б Болти, яких
   * «нізвідки не приходило».
   */
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: normalizedEmail,
        password: hashed,
        name: name.trim(),
        phone: normalizePhone(typeof phone === "string" ? phone : ""),
        role: "CLIENT",
        boltsBalance: WELCOME_BOLTS,
      },
      select: { id: true, name: true, email: true, role: true, boltsBalance: true },
    });

    await tx.boltsTransaction.create({
      data: {
        userId: created.id,
        amount: WELCOME_BOLTS,
        type: "EARNED",
        description: "Вітальний бонус при реєстрації",
      },
    });

    return created;
  });

  const token = await issueShopToken(user.id, typeof deviceName === "string" ? deviceName : null);

  return NextResponse.json(
    { token, user },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
