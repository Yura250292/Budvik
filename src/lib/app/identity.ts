/**
 * Хто робить запит: кукі NextAuth або токен пристрою — одна відповідь на обидва.
 *
 * Кабінет торгового й водія живе у двох контурах одночасно. У браузері й у
 * WebView застосунку сторінка ходить під кукі NextAuth; нативний екран кукі не
 * має взагалі — він шле `Authorization: Bearer bdvk_…`. Досі це вміли рівно три
 * роути, а решта кабінету була закрита для нативного клієнта, і кожен новий
 * екран довелося б відкривати окремою правкою в кожному роуті.
 *
 * Шість байт-у-байт однакових `resolveUser` у /api/shift/* — те, що з цього
 * виростало: кожен повертав лише userId, тож роль губилася, і роути, які
 * звужують видачу торговому («лише свої документи»), скористатися ними не могли.
 *
 * Модуль лежить у lib/app/ поруч із role-target.ts — це вже спільний простір
 * «сайт ↔ застосунок»; у device-token.ts його класти не можна (той навмисно не
 * знає про next-auth, бо його імпортують чисті токенні шляхи), а в auth.ts —
 * теж (authOptions імпортує половина роутів, вийшов би цикл).
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyDeviceToken } from "@/lib/track/device-token";

/**
 * Набори ролей замість інлайн-літералів.
 *
 * Назви кажуть, ХТО це, а не куди пускають: той самий набір стоїть на роутах із
 * різних розділів, і назва на кшталт SALES_API_ROLES розійшлася б із дійсністю
 * на першому ж роуті, який знадобився водієві.
 */
/** Офіс: бачить усе і за всіх. */
export const OFFICE_ROLES = ["ADMIN", "MANAGER"] as const;
/** Кабінет торгового: офіс плюс сам торговий (зазвичай — лише своє). */
export const CABINET_ROLES = ["ADMIN", "MANAGER", "SALES"] as const;
/** Кабінет водія. */
export const DRIVER_ROLES = ["ADMIN", "MANAGER", "DRIVER"] as const;
/**
 * Хто працює в полі. Збігається з TRACK_ROLES із device-token.ts — і мусить
 * збігатися: саме цим людям видають токен пристрою.
 */
export const FIELD_ROLES = ["ADMIN", "MANAGER", "SALES", "DRIVER"] as const;
/** Будь-хто з персоналу, включно зі складом. */
export const STAFF_ROLES = ["ADMIN", "MANAGER", "SALES", "WAREHOUSE", "DRIVER"] as const;

export type Identity = {
  userId: string;
  role: string;
  /** Яким шляхом упізнали. Потрібно там, де відповідь залежить від контуру. */
  via: "cookie" | "device";
  /** Лише при { withProfile: true }. */
  name?: string;
  email?: string | null;
  /** Тільки для токена пристрою — щоб /api/device/logout мав що відкликати. */
  tokenId?: string;
};

export type Guard = { ok: true; me: Identity } | { ok: false; response: NextResponse };

type ResolveOptions = {
  /**
   * Дотягнути ім'я та email.
   *
   * За замовчуванням вимкнено: кукі несе їх безкоштовно, а токен пристрою — ні
   * (verifyDeviceToken свідомо читає з бази лише id і роль, бо його смикає кожна
   * пачка координат). Вмикати там, де ім'я справді потрапляє у відповідь чи в
   * запис — інакше кожен роут кабінету платив би зайвим запитом за поле, якого
   * не показує.
   */
  withProfile?: boolean;
};

/**
 * Упізнає того, хто стукає. null — не впізнали, і роут має віддати 401.
 *
 * Порядок: спершу Bearer, потім кукі. Якщо заголовок Authorization присутній,
 * але токен невалідний чи відкликаний — на кукі НЕ падаємо: інакше планшет із
 * погашеним токеном далі працював би, поки в WebView жива стара сесія, і
 * «вимкнути загублений пристрій» переставало б означати те, що означає.
 */
export async function resolveIdentity(
  req: Request,
  opts: ResolveOptions = {}
): Promise<Identity | null> {
  const authHeader = req.headers.get("authorization");

  if (authHeader) {
    const device = await verifyDeviceToken(authHeader);
    if (!device) return null;

    const identity: Identity = {
      userId: device.userId,
      role: device.role,
      via: "device",
      tokenId: device.tokenId,
    };

    if (opts.withProfile) {
      const user = await prisma.user.findUnique({
        where: { id: device.userId },
        select: { name: true, email: true },
      });
      identity.name = user?.name ?? undefined;
      identity.email = user?.email ?? null;
    }

    return identity;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  return {
    userId: session.user.id,
    role: session.user.role,
    via: "cookie",
    ...(opts.withProfile ? { name: session.user.name, email: session.user.email } : {}),
  };
}

/** 401 однаковим текстом на будь-яку причину — щоб не підказувати, що саме не так. */
function unauthorized() {
  return NextResponse.json(
    { error: "Потрібно увійти" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

function forbidden() {
  return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
}

/**
 * Впізнати й перевірити роль однією дією.
 *
 * Розрізняє 401 і 403 навмисно, хоч частина роутів раніше віддавала 403 на
 * обидва випадки. Для застосунку це різні події: 401 означає «токен мертвий,
 * зітри його й покажи вхід», 403 — «увійшов, але сюди тобі не можна». Зі
 * склеєними кодами клієнт на кожній забороні викидав би людину з акаунта.
 */
export async function requireRoles(
  req: Request,
  allow: readonly string[],
  opts: ResolveOptions = {}
): Promise<Guard> {
  const me = await resolveIdentity(req, opts);
  if (!me) return { ok: false, response: unauthorized() };
  if (!allow.includes(me.role)) return { ok: false, response: forbidden() };
  return { ok: true, me };
}

/**
 * Чиї дані показувати: свої чи запитані.
 *
 * Польові ролі бачать лише себе — параметр із запиту для них не існує, навіть
 * якщо його підставили руками. Офіс може запитати конкретну людину, а без
 * параметра дивиться на себе.
 *
 * Це єдиний шматок бізнес-скоупу, який тут доречний, бо він повторювався
 * дослівно в десятку роутів. Решта (`where.salesRepId`, `mine=1`, статуси для
 * складу) лишається в роутах: цей модуль відповідає на питання «хто це», а не
 * «що йому видно».
 */
export function scopeToSelf(
  me: Identity,
  requested: string | null | undefined,
  selfOnly: readonly string[] = ["SALES", "DRIVER"]
): string {
  if (selfOnly.includes(me.role)) return me.userId;
  return requested || me.userId;
}
