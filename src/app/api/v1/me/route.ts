/**
 * Профіль покупця в застосунку: хто я, скільки Болтів і за що вони прийшли.
 *
 * Один виклик замість двох (/api/account/profile + /api/user/bolts): холодний
 * старт кабінету на 3G не має бути двома походами по мережі.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { shopIdentity, unauthorized } from "@/lib/shop/api";
import { revokeAllShopTokens } from "@/lib/shop/app-token";
import { rateLimit, tooManyRequests } from "@/lib/shop/rate-limit";

export const dynamic = "force-dynamic";

/** Скільки рухів по Болтах показувати. Далі — окремий екран історії. */
const BOLTS_TAKE = 20;

export async function GET(req: Request) {
  const me = await shopIdentity(req);
  if (!me) return unauthorized();

  const [user, transactions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: me.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        boltsBalance: true,
        avatarUrl: true,
      },
    }),
    prisma.boltsTransaction.findMany({
      where: { userId: me.userId },
      orderBy: { createdAt: "desc" },
      take: BOLTS_TAKE,
      select: { id: true, amount: true, type: true, description: true, createdAt: true },
    }),
  ]);

  // Токен живий, а користувача немає — акаунт видалили, поки телефон лежав у
  // кишені. Це саме 401: застосунок має показати екран входу, а не помилку.
  if (!user) return unauthorized();

  return NextResponse.json(
    { user, bolts: { balance: user.boltsBalance, transactions } },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Видалення акаунта із застосунку.
 *
 * Обидва магазини вимагають, щоб людина могла видалити акаунт **усередині**
 * застосунку, а не листом у підтримку. Але справжній DELETE тут неможливий:
 * Order.userId — зовнішній ключ, і каскад знищив би замовлення, тобто
 * бухгалтерські записи про реальні відвантаження.
 *
 * Тому видалення мʼяке: особисті дані затираються, доступ гаситься, а
 * замовлення лишаються. Вони й спроєктовані так, щоб пережити це — contactName,
 * phone, city і address зберігаються в самому замовленні знімком на момент
 * оформлення, тож менеджер довезе те, що вже в дорозі, а історія продажів не
 * розсиплеться.
 */
export async function DELETE(req: Request) {
  const me = await shopIdentity(req);
  if (!me) return unauthorized();

  /**
   * Тут теж перевіряється пароль, тобто це ще одні двері для підбору —
   * і вони гірші за вхід, бо вдала спроба не логінить, а стирає акаунт.
   */
  const limit = await rateLimit(`delete:user:${me.userId}`, 5, 900);
  if (!limit.allowed) return tooManyRequests();

  const { password } = await req.json().catch(() => ({}));

  const user = await prisma.user.findUnique({
    where: { id: me.userId },
    select: { id: true, password: true, boltsBalance: true },
  });
  if (!user) return unauthorized();

  /**
   * Пароль — підтвердження, а не другий фактор.
   *
   * Телефон могли взяти з рук розблокованим; видалення акаунта незворотне, і
   * єдиний крок «так, це справді я» тут доречний. Акаунт без пароля (заведений
   * через Google) підтверджувати нічим — пропускаємо, інакше людина не змогла б
   * видалитися взагалі, а це вже порушення вимоги магазину.
   */
  if (user.password) {
    if (typeof password !== "string" || !(await bcrypt.compare(password, user.password))) {
      return NextResponse.json({ error: "Невірний пароль" }, { status: 403 });
    }
  }

  await prisma.$transaction(async (tx) => {
    /**
     * Email мусить лишитись унікальним, тож замість порожнього — технічна
     * адреса з id. Домен неіснуючий навмисно: на нього нічого не піде, навіть
     * якщо колись зʼявиться розсилка.
     */
    await tx.user.update({
      where: { id: user.id },
      data: {
        email: `deleted-${user.id}@deleted.budvik27.local`,
        name: "Видалений акаунт",
        password: null,
        phone: null,
        avatarUrl: null,
        telegramId: null,
        boltsBalance: 0,
      },
    });

    // Болти згорають разом з акаунтом, але слід у книзі лишається: інакше
    // баланс просто зник би, і розібратися в історії було б неможливо.
    if (user.boltsBalance > 0) {
      await tx.boltsTransaction.create({
        data: {
          userId: user.id,
          amount: -user.boltsBalance,
          type: "SPENT",
          description: "Списано при видаленні акаунта",
        },
      });
    }

    // Обране — це особисті дані, а не бізнес-запис. Іде разом з акаунтом.
    await tx.wishlistItem.deleteMany({ where: { userId: user.id } });

    // Пуші мають замовкнути негайно: людина видалила акаунт і не має отримати
    // сповіщення про своє ж останнє замовлення.
    await tx.pushToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  /**
   * Токени гасимо після коміту й усі — не лише той, яким прийшов запит:
   * інші телефони цієї людини мають вилетіти теж.
   *
   * Трекінгові токени не чіпаємо: у ролей CLIENT і WHOLESALE їх не буває, а
   * якщо колись зʼявиться суміщення — гасити чужий контур звідси було б
   * несподіванкою.
   */
  await revokeAllShopTokens(user.id);

  return NextResponse.json({ ok: true });
}
