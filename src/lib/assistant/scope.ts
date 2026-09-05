/**
 * Чиї дані читає розмова.
 *
 * Мова тут про ЗВЕДЕННЯ по торговому — мої продажі, моя дебіторка, мій план
 * дня. Торговий бачить лише свої, і не тому, що інтерфейс ховає чуже, а
 * тому, що repId сюди приходить із розмови, а не з аргументів моделі. У
 * схемах інструментів параметра «торговий» немає взагалі: те, чого модель
 * не може попросити, вона не може й видати.
 *
 * Картки клієнтів і товарів цим не обмежені: торгові й водії — одна
 * команда, і питання «а що з цим магазином» законне про будь-яку точку
 * бази. Див. КОМАНДА ОДНА в prompt.ts.
 *
 * Керівник обирає торгового один раз, при створенні розмови. Міняти його
 * посеред діалогу не можна: половина реплік уже про іншу людину, і
 * відповідь на «а в нього як?» стала б відповіддю про третього.
 */

import { prisma } from "@/lib/prisma";
import type { Identity } from "@/lib/app/identity";
import type { AssistantKind, AssistantScope } from "@/lib/assistant/types";

const OFFICE = new Set(["ADMIN", "MANAGER"]);

/**
 * Який помічник відкривається людині.
 *
 * За роллю, а не за адресою сторінки: водій із кабінету торгового
 * однаково лишається водієм, і показувати йому звіти по продажах немає
 * сенсу — на нього їх не оформлюють. Офіс дивиться очима торгового, бо
 * саме за нього він і заходить.
 */
export function kindForRole(role: string): AssistantKind {
  return role === "DRIVER" ? "DRIVER" : "SALES";
}

/** Кого офіс має право обрати. SALES завжди дивиться на себе. */
export async function resolveRepForThread(
  me: Identity,
  requestedRepId: unknown
): Promise<{ repId: string; error?: string }> {
  if (!OFFICE.has(me.role)) return { repId: me.userId };

  const requested = typeof requestedRepId === "string" ? requestedRepId.trim() : "";
  if (!requested || requested === me.userId) return { repId: me.userId };

  const rep = await prisma.user.findUnique({
    where: { id: requested },
    select: { id: true, role: true },
  });
  if (!rep) return { repId: me.userId, error: "Такого торгового немає" };

  return { repId: rep.id };
}

export async function scopeOf(repId: string): Promise<AssistantScope> {
  const rep = await prisma.user.findUnique({
    where: { id: repId },
    select: { name: true },
  });
  return { repId, repName: rep?.name ?? "торговий" };
}
