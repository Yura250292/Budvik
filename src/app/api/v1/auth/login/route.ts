/**
 * Вхід у застосунок — один на покупця й на працівника.
 *
 * Застосунок один, але контури за ним різні, і людина потрапляє в той,
 * якого заслуговує її роль: покупець — у нативний магазин, торговий,
 * водій чи адмін — у свій робочий кабінет.
 *
 * Область токена при цьому НЕ спільна. Покупець отримує shop-токен,
 * працівник — track-токен, і кожна сторона перевіряє свою область явно.
 * Один токен «на все» був би дірою: ADMIN присутній в обох списках
 * ролей, і його покупецький токен відкривав би доступ до чужого треку
 * й змін. Тому саме тут, у місці видачі, контури й розходяться.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { issueShopToken, SHOP_ROLES } from "@/lib/shop/app-token";
import { issueDeviceToken, revokeOtherDeviceTokens, TRACK_ROLES } from "@/lib/track/device-token";
import { defaultTargetFor } from "@/lib/app/role-target";
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

  /**
   * Покупця пізнаємо першим: списки не перетинаються, але якщо колись
   * почнуть, магазин має лишитися магазином. Роль поза обома списками
   * (наприклад, комірник) у застосунок не заходить взагалі.
   */
  const isShopper = SHOP_ROLES.includes(user.role);
  const isStaff = !isShopper && TRACK_ROLES.includes(user.role);
  if (!isShopper && !isStaff) return invalid;

  if (!(await bcrypt.compare(password, user.password))) return invalid;

  const device = typeof deviceName === "string" ? deviceName : null;
  const token = isShopper
    ? await issueShopToken(user.id, device)
    : await issueDeviceToken(user.id, device);

  /**
   * Вхід із робочої збірки гасить решту робочих токенів цієї людини.
   *
   * Поки в полі співіснують старий Kotlin-трекер і нова збірка, обидва з живими
   * токенами писали б трек одночасно — у дні виходили б дві пачки точок від
   * однієї людини, і пробіг подвоївся б. Старий застосунок на 401 сам зупиняє
   * службу й показує форму входу, тож це вимикач попереднього застосунку без
   * жодної правки в ньому.
   *
   * Прив'язка саме до заголовка, а не до ролі: заголовок шле лише робоча
   * збірка, тож вхід із сайту чи зі старого трекера нікого не вимикає.
   */
  if (isStaff && req.headers.get("x-budvik-app")?.startsWith("staff/")) {
    await revokeOtherDeviceTokens(user.id, token);
  }

  return NextResponse.json(
    {
      token,
      /**
       * Область токена — щоб застосунок не вгадував її з ролі. Від неї
       * залежить, куди він має слати запити: у /api/v1/* чи в робочі
       * роути кабінету.
       */
      scope: isShopper ? "shop" : "track",
      /**
       * Домівка працівника на сайті. Порожня для покупця: його екрани
       * нативні, і вести його нікуди не треба.
       */
      target: isStaff ? defaultTargetFor(user.role) : null,
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
