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
 *
 * Не обрав нікого — це не «розмова ні про кого», а розмова про ВСЮ фірму
 * (вид ADMIN, scope.company). Тому наявні розмови офісу «Я сам», у яких
 * зведення й так виходили порожні, з цієї зміни стають розмовами про
 * фірму — і в списку вони підписані «Уся фірма».
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
 * сенсу — на нього їх не оформлюють. Те саме зі складовщиком.
 */
export function kindForRole(role: string): AssistantKind {
  if (role === "DRIVER") return "DRIVER";
  if (role === "WAREHOUSE") return "WAREHOUSE";
  return "SALES";
}

/**
 * Вид помічника для КОНКРЕТНОЇ розмови.
 *
 * У офісу їх два, і розрізняє їх не роль, а те, кого обрали при створенні
 * розмови. Обрав торгового — розмова «очима торгового», зі скоупом на
 * нього: план дня, його борги, його клієнти. Не обрав нікого (repId — він
 * сам) — розмова про всю фірму: команда, водії, склад, обмін.
 *
 * Так само з цього виходить, що вид не міняється посеред діалогу: repId
 * прибитий до розмови, а половина реплік уже про когось конкретного.
 */
export function kindForThread(role: string, threadRepId: string, userId: string): AssistantKind {
  if (OFFICE.has(role) && threadRepId === userId) return "ADMIN";
  return kindForRole(role);
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

export async function scopeOf(repId: string, company = false): Promise<AssistantScope> {
  const rep = await prisma.user.findUnique({
    where: { id: repId },
    select: { name: true },
  });
  return { repId, repName: rep?.name ?? (company ? "керівник" : "торговий"), company };
}
