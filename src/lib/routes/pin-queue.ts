/**
 * Черга «Точки з треку»: клієнти, чию точку можна поставити за стоянками
 * торгового, — керівникові на підтвердження одним тапом.
 *
 * Навіщо. З 12.08 до 23.09.2026 екран уточнення точки показував галочку ще
 * до запису (фікс 39e0aa3), і частина точок, які торгові ставили біля
 * магазину, у базу не потрапила. Сліду тих спроб немає ніде — ні в базі, ні
 * в логах. Лишився трек: торговий стояв біля магазину, коли набивав
 * замовлення, і pinCandidates знаходить ці стоянки.
 *
 * Хто в черзі:
 * - приблизні (CITY) з документами торгового за 90 днів;
 * - ручні, які автор ставив не з місця (pin-audit: AT_BASE, ELSEWHERE) —
 *   точку могли посунути пальцем за 10–30 км від себе.
 *
 * Сама нічого не пише: «Поставити» — звичайний PATCH /api/admin/client-map/[id].
 */

import { prisma } from "@/lib/prisma";
import { auditManualPins, type PinVerdict } from "@/lib/geo/pin-audit";
import { pinCandidates, type PinCandidatesResult, type PlacesCache, type StopsCache } from "./pin-candidates";
import { queueOrder } from "./pin-queue-order";

export type PinQueueItem = {
  counterpartyId: string;
  name: string;
  address: string | null;
  geoSource: string;
  /** Чому в черзі. */
  reason: "CITY" | Exclude<PinVerdict, "ON_SITE" | "NO_TRACK">;
  result: PinCandidatesResult;
};

export type PinQueue = {
  items: PinQueueItem[];
  /** Усього клієнтів у вибірці. */
  total: number;
  /** З якого наступного продовжувати, або null — пройшли всіх. */
  nextOffset: number | null;
  /** Скільки перевірених без жодного кандидата (трек мовчить). */
  empty: number;
};

/** Ручна точка, яку трек підтверджує з такою точністю, у черзі не потрібна. */
const CONFIRMED_M = 150;

export async function pinQueue(opts: { deadlineMs?: number; offset?: number } = {}): Promise<PinQueue> {
  const started = Date.now();
  const deadline = opts.deadlineMs ?? Infinity;

  const cityRows = await prisma.$queryRaw<Array<{ id: string; name: string; address: string | null }>>`
    SELECT c.id, c.name, c.address
    FROM "Counterparty" c
    WHERE c."geoSource" = 'CITY' AND c."deliveryLat" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "SalesDocument" s
        WHERE s."counterpartyId" = c.id AND s."salesRepId" IS NOT NULL
          AND s."docType" IN ('ORDER', 'REALIZATION')
          AND s."createdAt" > NOW() - INTERVAL '90 days'
      )
    ORDER BY c.name`;

  const doubtful = (await auditManualPins()).filter((a) => a.verdict === "AT_BASE" || a.verdict === "ELSEWHERE");

  type Entry = {
    id: string;
    name: string;
    address: string | null;
    geoSource: string;
    reason: PinQueueItem["reason"];
    /** Де стояв автор сумнівної ручної точки — запасний центр пошуку. */
    author?: { lat: number; lng: number };
  };
  const all: Entry[] = [
    ...doubtful.map((a) => ({
      id: a.counterpartyId,
      name: a.name,
      address: a.address,
      geoSource: "MANUAL",
      reason: a.verdict as PinQueueItem["reason"],
      author: a.authorLat != null && a.authorLng != null ? { lat: a.authorLat, lng: a.authorLng } : undefined,
    })),
    ...cityRows.map((r) => ({ ...r, geoSource: "CITY", reason: "CITY" as const })),
  ];

  const cache: StopsCache = new Map();
  const places: PlacesCache = new Map();
  const items: PinQueueItem[] = [];
  let i = opts.offset ?? 0;
  let empty = 0;
  for (; i < all.length; i++) {
    if (Date.now() - started > deadline) break;
    const c = all[i];
    let result = await pinCandidates(c.id, { cache, places });
    // Пін посунули пальцем за 10–30 км: довкола нього (8 км) стоянок немає,
    // тож шукаємо довкола місця, де автор стояв, коли його ставив.
    if (c.author && (!result || result.candidates.length === 0)) {
      result = await pinCandidates(c.id, { cache, places, around: c.author });
    }
    if (!result || result.candidates.length === 0) {
      empty++;
      continue;
    }
    // Пересунули пальцем, але туди, де торговий і стояв, — точка правильна.
    if (c.reason !== "CITY" && result.candidates[0].distanceM <= CONFIRMED_M) continue;
    items.push({ counterpartyId: c.id, name: c.name, address: c.address, geoSource: c.geoSource, reason: c.reason, result });
  }

  items.sort(queueOrder);
  return { items, total: all.length, nextOffset: i < all.length ? i : null, empty };
}
