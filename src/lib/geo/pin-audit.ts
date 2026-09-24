/**
 * Чи стояв торговий біля магазину, коли ставив точку, — чи тегав з дому.
 *
 * Точка з кнопки «Я зараз тут» — це позиція телефона. Якщо натиснути її
 * вдома, клієнт «переїжджає» до торгового на кухню, і ніщо цього не
 * покаже: geoSource=MANUAL, автор є, точність GPS добра. Правду знає трек:
 * де був автор у момент запису (geoAt).
 *
 * Вердикти:
 * - ON_SITE — трек автора в той момент поруч із точкою;
 * - AT_BASE — автор стояв удома (база з довідника або вивчена з ранків) чи
 *   на складі, а точка далеко від нього: тегав не з місця;
 * - ELSEWHERE — автор був деінде, не біля бази й не біля точки;
 * - NO_TRACK — треку в цей момент немає (керівник з офісу, телефон без
 *   служби) — судити нема з чого.
 *
 * Лише читання.
 */

import { prisma } from "@/lib/prisma";
import { haversineM } from "@/lib/track/geo";
import { repPlaces } from "@/lib/track/rep-places";

/** Скільки хвилин довкола geoAt шукаємо точку треку. */
const WINDOW_MIN = 10;
/**
 * Точка ближче за це до автора — ставив на місці. GPS у приміщенні гуляє, а
 * пін часто підсувають пальцем на кілька будинків: 24.09 чотири точки в Стрию
 * лягли за 240–350 м від треку, і всі чотири — правильні магазини.
 */
const ON_SITE_M = 500;
/** Автор ближче за це до своєї бази чи складу — був «вдома». */
const AT_BASE_M = 400;

export type PinVerdict = "ON_SITE" | "AT_BASE" | "ELSEWHERE" | "NO_TRACK";

export type PinAudit = {
  counterpartyId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  geoAt: Date;
  byGps: boolean;
  authorId: string;
  authorName: string;
  verdict: PinVerdict;
  /** Де був автор (найближча в часі точка треку). */
  authorLat: number | null;
  authorLng: number | null;
  /** Відстань автор ↔ точка, м. */
  distanceM: number | null;
  /** Зсув точки треку від geoAt, хв. */
  lagMin: number | null;
  /** Біля чого стояв автор, якщо AT_BASE. */
  baseLabel: string | null;
};

type Row = {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  geoAt: Date;
  geoAccuracyM: number | null;
  authorId: string;
  authorName: string | null;
  tLat: number | null;
  tLng: number | null;
  tAt: Date | null;
};

export async function auditManualPins(opts: { counterpartyIds?: string[] } = {}): Promise<PinAudit[]> {
  const ids = opts.counterpartyIds ?? null;
  // Найближча в часі точка треку автора в межах вікна — одним LATERAL.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT c.id, c.name, c.address, c."deliveryLat" AS lat, c."deliveryLng" AS lng,
           c."geoAt", c."geoAccuracyM", c."geoById" AS "authorId", u.name AS "authorName",
           t.lat AS "tLat", t.lng AS "tLng", t."recordedAt" AS "tAt"
    FROM "Counterparty" c
    LEFT JOIN "User" u ON u.id = c."geoById"
    LEFT JOIN LATERAL (
      SELECT p.lat, p.lng, p."recordedAt"
      FROM "TrackPoint" p
      WHERE p."userId" = c."geoById"
        AND p."recordedAt" BETWEEN c."geoAt" - make_interval(mins => ${WINDOW_MIN}::int)
                               AND c."geoAt" + make_interval(mins => ${WINDOW_MIN}::int)
      ORDER BY ABS(EXTRACT(EPOCH FROM (p."recordedAt" - c."geoAt")))
      LIMIT 1
    ) t ON TRUE
    WHERE c."geoSource" = 'MANUAL' AND c."geoById" IS NOT NULL AND c."geoAt" IS NOT NULL
      AND c."deliveryLat" IS NOT NULL
      AND (${ids}::text[] IS NULL OR c.id = ANY(${ids}::text[]))
    ORDER BY c."geoAt"`;

  const places = await repPlaces(rows.map((r) => r.authorId));
  const basesOf = (userId: string) => places.get(userId) ?? [];

  return rows.map((r) => {
    const base = {
      counterpartyId: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      geoAt: r.geoAt,
      byGps: r.geoAccuracyM != null,
      authorId: r.authorId,
      authorName: r.authorName ?? "?",
    };
    if (r.tLat == null || r.tLng == null || !r.tAt) {
      return { ...base, verdict: "NO_TRACK", authorLat: null, authorLng: null, distanceM: null, lagMin: null, baseLabel: null };
    }
    const distanceM = Math.round(haversineM(r.tLat, r.tLng, r.lat, r.lng));
    const lagMin = Math.round((r.tAt.getTime() - r.geoAt.getTime()) / 60000);
    let verdict: PinVerdict = "ELSEWHERE";
    let baseLabel: string | null = null;
    if (distanceM <= ON_SITE_M) {
      verdict = "ON_SITE";
    } else {
      const near = basesOf(r.authorId).find((b) => haversineM(b.lat, b.lng, r.tLat!, r.tLng!) <= AT_BASE_M);
      if (near) {
        verdict = "AT_BASE";
        baseLabel = near.label;
      }
    }
    return { ...base, verdict, authorLat: r.tLat, authorLng: r.tLng, distanceM, lagMin, baseLabel };
  });
}
