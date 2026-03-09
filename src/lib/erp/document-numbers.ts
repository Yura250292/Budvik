import { prisma } from "@/lib/prisma";

const SEQUENCES = {
  PO: { prefix: "ПН" },   // Прихідна накладна
  SD: { prefix: "ПР" },   // Продаж
  INV: { prefix: "ВН" },  // Видаткова накладна
} as const;

type SequenceType = keyof typeof SEQUENCES;

export async function getNextDocumentNumber(type: SequenceType): Promise<string> {
  const seq = await prisma.documentSequence.upsert({
    where: { id: type },
    update: { last: { increment: 1 } },
    create: { id: type, prefix: SEQUENCES[type].prefix, last: 1 },
  });

  const num = String(seq.last).padStart(6, "0");
  return `${seq.prefix}-${num}`;
}
