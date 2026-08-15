/**
 * Подача: дорога від бази торгового до маршруту й назад.
 *
 * Навіщо. Шаблон маршруту — це кілометри МІЖ ПУНКТАМИ («Стрий» = 246 км).
 * Але торговий не ночує в першому пункті: вранці він виїжджає з дому або
 * зі складу, а ввечері повертається. Ці два плечі в кожного свої — хтось
 * живе за 5 км від початку напрямку, хтось за 60 — і без них план та факт
 * міряють різні речі. Порівняння голого маршруту з одометром системно
 * робило б порушником того, хто просто живе далі.
 *
 * Чому кешуємо. База торгового і пункти маршруту змінюються раз на місяці,
 * а список змін відкривають щодня. OSRM у нас публічний демо-сервер без
 * ключа: він лімітує й падає під навантаженням, і рахувати подачу на
 * кожен перегляд означало б класти його власними руками. Тому результат
 * лежить у SalesVehicle.baseLegsKm і перераховується лише при зміні бази.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRoute } from "@/lib/geo/osrm";

/** Плечі подачі для одного маршруту. */
export type BaseLegs = {
  /** База → перший пункт, км */
  toFirstKm: number;
  /** Останній пункт → база, км */
  fromLastKm: number;
  /** Разом — саме це додається до планових км маршруту */
  totalKm: number;
};

type CacheShape = Record<string, { toFirstKm: number; fromLastKm: number }>;

/**
 * Читає подачу з кешу. null означає «не рахували», а не «нуль».
 *
 * Різниця принципова: нуль додався б до плану мовчки й зробив би цифру
 * неправдивою, а null дає UI підставу написати, що подача не врахована.
 */
export function readCachedLegs(
  cache: unknown,
  templateId: string
): BaseLegs | null {
  const map = cache as CacheShape | null;
  const hit = map?.[templateId];
  if (!hit || !Number.isFinite(hit.toFirstKm) || !Number.isFinite(hit.fromLastKm)) {
    return null;
  }
  return {
    toFirstKm: hit.toFirstKm,
    fromLastKm: hit.fromLastKm,
    totalKm: Math.round((hit.toFirstKm + hit.fromLastKm) * 10) / 10,
  };
}

/**
 * Рахує подачу через OSRM і кладе в кеш.
 *
 * Помилка OSRM не валить виклик: повертаємо null, і панель просто скаже,
 * що подача не врахована. Зіпсувати наявний кеш невдалим запитом було б
 * гірше, ніж не оновити його зовсім.
 */
export async function computeAndCacheLegs(
  repId: string,
  templateId: string,
  base: { lat: number; lng: number },
  stops: Array<{ lat: number; lng: number }>
): Promise<BaseLegs | null> {
  if (stops.length === 0) return null;

  const first = stops[0];
  const last = stops[stops.length - 1];

  try {
    // Два окремі запити, а не один наскрізний: нас цікавлять саме плечі,
    // і рахувати весь маршрут ще раз (він уже порахований у шаблоні)
    // означало б платити за ту саму відповідь двічі.
    const [there, back] = await Promise.all([
      getRoute([
        [base.lng, base.lat],
        [first.lng, first.lat],
      ]),
      getRoute([
        [last.lng, last.lat],
        [base.lng, base.lat],
      ]),
    ]);

    const legs: BaseLegs = {
      toFirstKm: there.totalDistanceKm,
      fromLastKm: back.totalDistanceKm,
      totalKm: Math.round((there.totalDistanceKm + back.totalDistanceKm) * 10) / 10,
    };

    const vehicle = await prisma.salesVehicle.findUnique({
      where: { repId },
      select: { baseLegsKm: true },
    });

    const next: CacheShape = {
      ...((vehicle?.baseLegsKm as CacheShape | null) ?? {}),
      [templateId]: { toFirstKm: legs.toFirstKm, fromLastKm: legs.fromLastKm },
    };

    await prisma.salesVehicle.update({
      where: { repId },
      data: { baseLegsKm: next },
    });

    return legs;
  } catch {
    return null;
  }
}

/**
 * Подача з кешу, а якщо її там немає — рахує і кешує.
 *
 * Саме цим користуються API: перший перегляд зміни оплачує один похід до
 * OSRM, усі наступні беруть готове.
 */
export async function resolveLegs(
  repId: string,
  templateId: string,
  base: { lat: number; lng: number } | null,
  stops: Array<{ lat: number; lng: number }>,
  cache: unknown
): Promise<BaseLegs | null> {
  if (!base) return null;

  const cached = readCachedLegs(cache, templateId);
  if (cached) return cached;

  return computeAndCacheLegs(repId, templateId, base, stops);
}

/** Скидає кеш подачі — база переїхала, старі плечі більше не правда. */
export async function invalidateLegs(repId: string): Promise<void> {
  await prisma.salesVehicle.updateMany({
    where: { repId },
    data: { baseLegsKm: Prisma.DbNull },
  });
}
