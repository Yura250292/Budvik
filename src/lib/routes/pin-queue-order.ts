/**
 * Порядок черги «Точки з треку» — окремо від pin-queue.ts, бо потрібен і
 * сторінці (порції приходять частинами), а той модуль тягне Prisma.
 *
 * Спершу впевнені, далі ті, за кого голосувало кілька замовлень: «100% з
 * одного» — це одна стоянка, а не місце.
 */

import type { PinCandidatesResult } from "./pin-candidates";

export function queueOrder(a: { result: PinCandidatesResult }, b: { result: PinCandidatesResult }): number {
  const weight = (x: { result: PinCandidatesResult }) =>
    (x.result.confident ? 10 : 0) + Math.min(x.result.votedDocs, 3) * (x.result.candidates[0]?.share ?? 0);
  return weight(b) - weight(a);
}
