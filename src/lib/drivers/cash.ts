/**
 * Каса водія за день: скільки зібрав, скільки здав, скільки на руках.
 *
 * Одне місце правди навмисно: суму бачить водій на екрані дня, вона ж
 * лягає в expectedAmount при здачі і показується адміну в звірці. Три
 * незалежні підрахунки розійшлися б на першому ж крайньому випадку
 * (знята відмітка, друга здача за день).
 */

import { prisma } from "@/lib/prisma";

export type DayCash = {
  /** Сума з відміток візитів за день, ₴ */
  collected: number;
  /** Скільки водій заявив як здане, ₴ */
  handed: number;
  /** collected − handed; від'ємне означає, що здав більше, ніж відмітив */
  onHands: number;
};

export type HandoverBrief = {
  id: string;
  amount: number;
  handedAt: Date;
  confirmedAt: Date | null;
  confirmedAmount: number | null;
  comment: string | null;
};

/** Підсумок каси за одну добу (day — вже kyivDayStart). */
export async function cashForDay(driverId: string, day: Date): Promise<DayCash> {
  const [visits, handovers] = await Promise.all([
    prisma.visit.aggregate({
      where: { userId: driverId, day },
      _sum: { collectedAmount: true },
    }),
    prisma.cashHandover.aggregate({
      where: { driverId, day },
      _sum: { amount: true },
    }),
  ]);

  const collected = round(visits._sum.collectedAmount ?? 0);
  const handed = round(handovers._sum.amount ?? 0);

  return { collected, handed, onHands: round(collected - handed) };
}

/** Здачі за добу — списком, щоб екран дня показав час і статус. */
export async function handoversForDay(
  driverId: string,
  day: Date
): Promise<HandoverBrief[]> {
  return prisma.cashHandover.findMany({
    where: { driverId, day },
    orderBy: { handedAt: "asc" },
    select: {
      id: true,
      amount: true,
      handedAt: true,
      confirmedAt: true,
      confirmedAmount: true,
      comment: true,
    },
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
