/**
 * Пам'ять про клієнта: те, чого немає в жодному документі.
 *
 * Чому окремо від ClientComment, а не ще одна стрічка: коментар — це
 * подія на дату («заїжджав, зачинено»), і список із них розпухає, а
 * читати його треба знизу вгору. Факт живе далі («платить лише готівкою
 * після 15-го», «директор торгується, вирішує дружина»), його правлять, а
 * не дописують — і саме його треба показати за секунду перед дверима
 * магазину.
 *
 * Модуль спільний для двох входів: форма на картці клієнта і інструмент
 * помічника remember_client. Тому валідація тут, а не в роуті — інакше
 * модель змогла б записати те, чого людині записати не дають.
 */

import { prisma } from "@/lib/prisma";
import type { ClientMemoryKind, ClientMemorySource } from "@prisma/client";

export const MEMORY_KINDS = [
  "PAYMENT",
  "RELATIONSHIP",
  "PREFERENCE",
  "LOGISTICS",
  "COMPETITOR",
  "OTHER",
] as const;

export const KIND_LABELS: Record<ClientMemoryKind, string> = {
  PAYMENT: "Оплата",
  RELATIONSHIP: "Стосунки",
  PREFERENCE: "Уподобання",
  LOGISTICS: "Логістика",
  COMPETITOR: "Конкуренти",
  OTHER: "Інше",
};

/**
 * Довжина факту.
 *
 * Знизу 3 — щоб «ок» не ставало записом. Згори 500: усе довше — це вже
 * не факт, а розповідь, і в контексті моделі вона витіснить решту
 * клієнтів. Довгій історії місце в коментарях.
 */
export const TEXT_MIN = 3;
export const TEXT_MAX = 500;

export class MemoryError extends Error {}

export function assertKind(raw: unknown): ClientMemoryKind {
  const value = String(raw ?? "OTHER").toUpperCase();
  if (!(MEMORY_KINDS as readonly string[]).includes(value)) {
    throw new MemoryError(`Вид має бути одним із: ${MEMORY_KINDS.join(", ")}`);
  }
  return value as ClientMemoryKind;
}

export function assertText(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < TEXT_MIN) throw new MemoryError("Запис закороткий");
  if (value.length > TEXT_MAX) throw new MemoryError(`Запис задовгий (максимум ${TEXT_MAX})`);
  return value;
}

export type MemoryFact = {
  id: string;
  kind: ClientMemoryKind;
  text: string;
  source: ClientMemorySource;
  author: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

/** Живі факти клієнта, свіжі згори. */
export async function listMemory(counterpartyId: string, limit = 50): Promise<MemoryFact[]> {
  const rows = await prisma.clientMemory.findMany({
    where: { counterpartyId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      text: true,
      source: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    source: r.source,
    author: r.author,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Новий факт. Дубль того самого тексту не створюємо.
 *
 * Помічник охоче записує те саме двічі: торговий перепитує «запам'ятай,
 * що він платить готівкою» у наступній розмові, і без цієї перевірки на
 * картці виростає стовпчик однакових рядків.
 */
export async function createMemory(input: {
  counterpartyId: string;
  authorId: string | null;
  kind: unknown;
  text: unknown;
  source: ClientMemorySource;
}): Promise<MemoryFact> {
  const kind = assertKind(input.kind);
  const text = assertText(input.text);

  const existing = await prisma.clientMemory.findFirst({
    where: {
      counterpartyId: input.counterpartyId,
      archivedAt: null,
      text: { equals: text, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existing) {
    const [fact] = await listMemoryByIds([existing.id]);
    return fact;
  }

  const created = await prisma.clientMemory.create({
    data: {
      counterpartyId: input.counterpartyId,
      authorId: input.authorId,
      kind,
      text,
      source: input.source,
    },
    select: { id: true },
  });
  const [fact] = await listMemoryByIds([created.id]);
  return fact;
}

async function listMemoryByIds(ids: string[]): Promise<MemoryFact[]> {
  const rows = await prisma.clientMemory.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      kind: true,
      text: true,
      source: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    source: r.source,
    author: r.author,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function updateMemory(
  id: string,
  patch: { kind?: unknown; text?: unknown }
): Promise<MemoryFact> {
  const data: { kind?: ClientMemoryKind; text?: string } = {};
  if (patch.kind !== undefined) data.kind = assertKind(patch.kind);
  if (patch.text !== undefined) data.text = assertText(patch.text);
  if (Object.keys(data).length === 0) throw new MemoryError("Нічого змінювати");

  await prisma.clientMemory.update({ where: { id }, data });
  const [fact] = await listMemoryByIds([id]);
  return fact;
}

/**
 * М'яке видалення: факт зникає зі списку, але лишається в базі.
 *
 * «Хто це стер і чому» — питання, яке виникає рівно тоді, коли відповіді
 * вже немає. Рядок коштує байти, відновлення пам'яті клієнта — місяці.
 */
export async function archiveMemory(id: string): Promise<void> {
  await prisma.clientMemory.update({ where: { id }, data: { archivedAt: new Date() } });
}
