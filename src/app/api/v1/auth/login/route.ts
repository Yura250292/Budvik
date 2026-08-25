/**
 * Вхід у застосунок покупця.
 *
 * Дзеркалить /api/device/login, але видає токен іншої області: той контур
 * обслуговує планшети торгових і пускає лише TRACK_ROLES, цей — покупців.
 * Розділення саме на рівні токена, а не ролі: ADMIN присутній в обох списках
 * ролей, і без області його токен із застосунку відкривав би доступ до
 * чужого треку й змін.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { issueShopToken, SHOP_ROLES } from "@/lib/shop/app-token";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/shop/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, password, deviceName } = await req.json().catch(() => ({}));

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return NextResponse.json({ error: "Вкажіть email і пароль" }, { status: 400 });
  }

  // Email у базі зберігається в нижньому регістрі — без нормалізації вхід із
  // клавіатури телефона, яка автоматично робить першу літеру великою, мовчки
  // не спрацьовував би.
  const normalizedEmail = email.trim().toLowerCase();

  /**
   * Дві стелі, бо вони ловлять різні напади.
   *
   * За адресою — коли з одного місця перебирають багато акаунтів.
   * За email — коли той самий акаунт довбають із ботнета, де кожна спроба
   * приходить зі своєї адреси, і стеля за IP не спрацьовує ніколи.
   *
   * Числа нещедрі: людина, яка справді забула пароль, робить три-чотири
   * спроби й іде відновлювати, а не двадцяту поспіль.
   */
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`login:ip:${clientIp(req)}`, 20, 300),
    rateLimit(`login:email:${normalizedEmail}`, 10, 300),
  ]);
  if (!byIp.allowed || !byEmail.allowed) return tooManyRequests();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, name: true, email: true, password: true, role: true, boltsBalance: true },
  });

  /**
   * Одна відповідь на всі причини: немає такого email, порожній пароль
   * (акаунт заведений через Google), невірний пароль, не та роль. Різні
   * тексти підказували б, які адреси існують.
   */
  const invalid = NextResponse.json({ error: "Невірний email або пароль" }, { status: 401 });

  if (!user?.password) return invalid;
  if (!SHOP_ROLES.includes(user.role)) return invalid;
  if (!(await bcrypt.compare(password, user.password))) return invalid;

  const token = await issueShopToken(user.id, typeof deviceName === "string" ? deviceName : null);

  return NextResponse.json(
    {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        boltsBalance: user.boltsBalance,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
