/**
 * Рішення адміна щодо пропозицій агента.
 *
 * Затвердження записує ціну в ApprovedPrice і одразу перераховує товар: рушій
 * ставить затверджену ціну на вітрину, якщо вона строго дорожча за опт (інакше
 * — підлогу з позначкою). Відхилення нічого на вітрині не змінює.
 */
import { prisma } from "@/lib/prisma";
import { repriceProducts } from "../engine";

export type DecisionResult = { decided: number; priceChanged: number };

export async function approveProposals(ids: string[], userId: string): Promise<DecisionResult> {
  if (ids.length === 0) return { decided: 0, priceChanged: 0 };
  const rows = await prisma.priceProposal.findMany({
    where: { id: { in: ids }, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true, productId: true, proposedPrice: true, market: true, marketSource: true },
  });
  // На товар діє найсвіжіша з вибраних пропозицій.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.productId)) latest.set(r.productId, r);

  const now = new Date();
  await prisma.$transaction([
    ...[...latest.values()].map((r) => {
      const data = {
        price: r.proposedPrice,
        proposalId: r.id,
        market: r.market,
        marketSource: r.marketSource,
        approvedById: userId,
        approvedAt: now,
      };
      return prisma.approvedPrice.upsert({
        where: { productId: r.productId },
        create: { productId: r.productId, ...data },
        update: data,
      });
    }),
    prisma.priceProposal.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: "APPROVED", decidedAt: now, decidedById: userId },
    }),
  ]);

  const repriced = await repriceProducts({ productIds: [...latest.keys()] });
  return { decided: rows.length, priceChanged: repriced.priceChanged };
}

export async function rejectProposals(ids: string[], userId: string): Promise<DecisionResult> {
  if (ids.length === 0) return { decided: 0, priceChanged: 0 };
  const res = await prisma.priceProposal.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "REJECTED", decidedAt: new Date(), decidedById: userId },
  });
  return { decided: res.count, priceChanged: 0 };
}

/** Зняти затверджену ціну — товар повертається на опт + націнку. */
export async function revertApproved(productIds: string[]): Promise<DecisionResult> {
  if (productIds.length === 0) return { decided: 0, priceChanged: 0 };
  const res = await prisma.approvedPrice.deleteMany({ where: { productId: { in: productIds } } });
  const repriced = await repriceProducts({ productIds });
  return { decided: res.count, priceChanged: repriced.priceChanged };
}
