/**
 * Кого стосується задача з наради: клієнт і виконавець.
 *
 * Неправильна прив'язка гірша за відсутню. Задача «забрати повернення» не
 * тому ФОП Химичу — це поїздка водія в інше село, тож автоматично
 * прив'язуємо лише однозначне, а решту лишаємо людині з кандидатами.
 *
 * Пошук — той самий, що в помічнику торгового (findClients): основи слів,
 * транслітерація брендів, адреса. А от pickOneClient для автозв'язку свідомо
 * НЕ використовуємо: на двох активних однофамільцях він вибирає одного, бо в
 * маршруті зупиняти людину питанням не можна. Тут можна — керівник однаково
 * підтверджує задачу.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { prisma } from "@/lib/prisma";
import { findClients, pickOneClient, type ClientHit } from "@/lib/assistant/facts/client-search";
import type { ClientCandidate } from "./types";

/** Скільки днів назад дивитись на «Ответственный» документів, коли закріплення немає. */
const REP_BY_DOCS_DAYS = 180;

export type ClientResolution = {
  counterpartyId: string | null;
  /** 0,9 — єдиний збіг; 0,8 — уточнено містом чи вулицею; 0,7 — єдиний «свій» для торгового; 0 — не прив'язано. */
  confidence: number;
  candidates: ClientCandidate[];
};

function toCandidate(h: ClientHit): ClientCandidate {
  return { id: h.id, name: h.name, address: h.address, mine: !!h.mine };
}

/** «Стрий, Шевченка» → основи слів для звірки з назвою й адресою. */
function hintStems(hint: string): string[] {
  return hint
    .toLowerCase()
    .split(/[\s,.;:«»"()]+/)
    .filter((w) => w.length >= 3)
    .map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w));
}

export async function resolveClient(input: {
  nameHeard: string;
  hint: string | null;
  /** Чиїм портфелем ранжувати: торговий-виконавець або автор наради. */
  repId: string;
  repIsSales: boolean;
}): Promise<ClientResolution> {
  const none: ClientResolution = { counterpartyId: null, confidence: 0, candidates: [] };
  const query = input.nameHeard.replace(/[«»"]/g, " ").replace(/\s+/g, " ").trim();
  if (query.length < 2) return none;

  let hits: ClientHit[];
  try {
    hits = await findClients(query, input.repId, { limit: 5 });
  } catch (e) {
    console.warn("[meetings] пошук клієнта впав:", e instanceof Error ? e.message : e);
    return none;
  }
  if (hits.length === 0) return none;
  if (hits.length === 1) return { counterpartyId: hits[0].id, confidence: 0.9, candidates: [toCandidate(hits[0])] };

  if (input.hint) {
    const stems = hintStems(input.hint);
    const narrowed = stems.length
      ? hits.filter((h) => {
          const hay = `${h.name} ${h.address ?? ""}`.toLowerCase();
          return stems.every((s) => hay.includes(s));
        })
      : [];
    if (narrowed.length === 1) {
      return { counterpartyId: narrowed[0].id, confidence: 0.8, candidates: [toCandidate(narrowed[0])] };
    }
  }

  // Торговий сказав «мій Химич», а в його портфелі Химич один — це він.
  if (input.repIsSales) {
    const mine = hits.filter((h) => h.mine);
    if (mine.length === 1) {
      return { counterpartyId: mine[0].id, confidence: 0.7, candidates: hits.map(toCandidate) };
    }
  }

  // Кілька — вирішує людина. Найімовірнішого ставимо першим у пікері.
  const suggested = pickOneClient(hits);
  const ordered = suggested ? [suggested, ...hits.filter((h) => h.id !== suggested.id)] : hits;
  return { counterpartyId: null, confidence: 0, candidates: ordered.map(toCandidate) };
}

/**
 * Чий клієнт — коли на нараді не сказали, кому доручено.
 *
 * Та сама драбина, що в стрічці торгового (rep-feed/events.ts resolveReps):
 * закріплення клієнта, перше за id, → відповідальний останньої накладної за
 * пів року. Обидва мусять бути торговими: «Ответственный» у 1С часто офіс.
 */
export async function repForClient(counterpartyId: string): Promise<string | null> {
  const since = new Date(Date.now() - REP_BY_DOCS_DAYS * 86_400_000);
  const [links, doc] = await Promise.all([
    prisma.salesRepClient.findMany({
      where: { counterpartyId },
      orderBy: { id: "asc" },
      select: { salesRepId: true },
    }),
    prisma.salesDocument.findFirst({
      where: { counterpartyId, salesRepId: { not: null }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { salesRepId: true },
    }),
  ]);

  const ids = [...links.map((l) => l.salesRepId), ...(doc?.salesRepId ? [doc.salesRepId] : [])];
  if (ids.length === 0) return null;
  const sales = new Set(
    (await prisma.user.findMany({ where: { id: { in: ids }, role: "SALES" }, select: { id: true } })).map((u) => u.id)
  );
  for (const l of links) if (sales.has(l.salesRepId)) return l.salesRepId;
  if (doc?.salesRepId && sales.has(doc.salesRepId)) return doc.salesRepId;
  return null;
}
