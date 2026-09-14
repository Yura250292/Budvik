/**
 * Пропозиції цін від агента — раз на тиждень, на затвердження адміну.
 *
 * Для кожного товару в наявності, для якого є ринкові ціни, агент бере
 * найнижчу придатну ціну і пропонує стати на undercut дешевше (типово на 1 %),
 * але не дешевше підлоги: роздріб строго дорожчий за опт.
 *
 * «Придатна» — не будь-яка знайдена. Сайти бувають порожні: сторінка без ціни,
 * товар без наявності, набір замість штуки, сторінка, що зникла. Такі джерела
 * не йдуть у розрахунок, але йдуть у докази: кожна пропозиція зберігає стан
 * усіх джерел на момент складання, щоб адмін бачив, звідки оцінка і що з
 * рештою сайтів.
 *
 * Ціна вітрини тут не змінюється. Пропозиція стає ціною лише після
 * затвердження (decide.ts → ApprovedPrice → рушій).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MARKET_RATIO_HIGH, MARKET_RATIO_LOW, UNIT_RATIO_HIGH, UNIT_RATIO_LOW, proposePrice } from "../compute";
import { loadPolicies, policyFor } from "../policy";
import { MARKET_FRESH_DAYS } from "./constants";

const DAY_MS = 86_400_000;
/** Зміна, менша за 0,5 % (і за 1 ₴), — не привід турбувати адміна. */
const MIN_CHANGE = 0.005;
const BIG_CHANGE = 0.2;

export type ProposalFlag = "market_below_floor" | "only_out_of_stock" | "single_source" | "big_change" | "price_up";

export type EvidenceRow = {
  source: string;
  url: string;
  title: string | null;
  price: number;
  inStock: boolean | null;
  status: string;
  seenAt: string;
  checkedAt: string;
  foundBy: string | null;
  /** Чи годиться для розрахунку. */
  usable: boolean;
  /** Саме з цього джерела взято ринкову ціну. */
  chosen: boolean;
  /** Що з джерелом не так — людською мовою. */
  note: string | null;
};

export type BuildProposalsResult = {
  week: string;
  candidates: number;
  created: number;
  kept: number;
  superseded: number;
  unchanged: number;
  noUsableMarket: number;
  unitMismatch: number;
  cheaper: number;
  dearer: number;
  belowFloor: number;
  pendingTotal: number;
  /** Лише в пробі: що було б створено. */
  preview?: Prisma.PriceProposalCreateManyInput[];
};

/** ISO-тиждень: «2026-W38». */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const STATUS_NOTE: Record<string, string> = {
  no_price: "на сторінці немає ціни",
  error: "сторінка не відкрилась",
  http_403: "сайт не пускає",
  http_404: "сторінку видалено",
  http_410: "сторінку видалено",
};

const kyivDate = (d: Date) => d.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" });

export async function buildProposals(opts: { now?: Date; dry?: boolean } = {}): Promise<BuildProposalsResult> {
  const now = opts.now ?? new Date();
  const week = isoWeek(now);
  const freshFrom = new Date(now.getTime() - MARKET_FRESH_DAYS * DAY_MS);
  const policies = await loadPolicies();
  const out: BuildProposalsResult = {
    week, candidates: 0, created: 0, kept: 0, superseded: 0, unchanged: 0, noUsableMarket: 0,
    unitMismatch: 0, cheaper: 0, dearer: 0, belowFloor: 0, pendingTotal: 0,
  };

  const products = await prisma.$queryRaw<
    { id: string; brandId: string | null; wholesale: number; retail1C: number | null; current: number }[]
  >`
    SELECT p.id, p."brandId", w.price AS wholesale, r.price AS "retail1C", COALESCE(s.price, p.price) AS current
    FROM "Product" p
    JOIN "Price1C" w ON w."productId" = p.id AND w.kind = 'WHOLESALE'
    LEFT JOIN "Price1C" r ON r."productId" = p.id AND r.kind = 'RETAIL'
    LEFT JOIN "SitePrice" s ON s."productId" = p.id
    WHERE p."isActive" AND p.stock > 0
      AND EXISTS (SELECT 1 FROM "MarketPrice" m WHERE m."productId" = p.id)
  `;
  const ids = products.map((p) => p.id);

  const [sources, pending] = await Promise.all([
    prisma.marketPrice.findMany({
      where: { productId: { in: ids } },
      select: {
        productId: true, source: true, url: true, title: true, price: true, inStock: true,
        lastStatus: true, seenAt: true, checkedAt: true, foundBy: true,
      },
    }),
    prisma.priceProposal.findMany({
      where: { status: "PENDING", productId: { in: ids } },
      select: { id: true, productId: true, proposedPrice: true },
    }),
  ]);

  const group = <T extends { productId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(r.productId, [...(map.get(r.productId) ?? []), r]);
    return map;
  };
  const sourcesBy = group(sources);
  const pendingBy = group(pending);

  const toCreate: Prisma.PriceProposalCreateManyInput[] = [];
  const toSupersede = new Set<string>();

  for (const p of products) {
    out.candidates++;
    const pend = pendingBy.get(p.id) ?? [];

    if (p.retail1C !== null) {
      const ratio = p.retail1C / p.wholesale;
      if (ratio < UNIT_RATIO_LOW || ratio > UNIT_RATIO_HIGH) {
        out.unitMismatch++;
        pend.forEach((x) => toSupersede.add(x.id));
        continue;
      }
    }

    const evidence: EvidenceRow[] = (sourcesBy.get(p.id) ?? []).map((r) => {
      const status = r.lastStatus ?? "ok";
      const ratio = r.price / p.wholesale;
      let note: string | null = null;
      let usable = true;
      if (status !== "ok" && status !== "out_of_stock") {
        usable = false;
        note = STATUS_NOTE[status] ?? (status.startsWith("http_") ? `сайт відповів ${status.slice(5)}` : status);
      } else if (r.seenAt < freshFrom) {
        usable = false;
        note = `ціну бачили востаннє ${kyivDate(r.seenAt)}`;
      } else if (ratio < MARKET_RATIO_LOW || ratio > MARKET_RATIO_HIGH) {
        usable = false;
        note = `ціна в ${ratio.toFixed(2).replace(".", ",")} раза від опту — схоже на інший товар чи упаковку`;
      } else if (status === "out_of_stock" || r.inStock === false) {
        note = "немає в наявності";
      }
      return {
        source: r.source, url: r.url, title: r.title, price: r.price, inStock: r.inStock, status,
        seenAt: r.seenAt.toISOString(), checkedAt: r.checkedAt.toISOString(), foundBy: r.foundBy,
        usable, chosen: false, note,
      };
    });

    const usable = evidence.filter((e) => e.usable);
    const available = usable.filter((e) => e.inStock !== false && e.status !== "out_of_stock");
    const basis = available.length ? available : usable;
    if (basis.length === 0) {
      out.noUsableMarket++;
      continue;
    }

    const best = basis.reduce((a, b) => (b.price < a.price ? b : a));
    best.chosen = true;
    const policy = policyFor(policies, p.brandId);
    const proposal = proposePrice(p.wholesale, best.price, policy);
    const diff = proposal.price - p.current;
    const minStep = Math.max(p.current < 10 ? 0.01 : 1, p.current * MIN_CHANGE);

    if (p.current > 0 && Math.abs(diff) < minStep) {
      out.unchanged++;
      pend.forEach((x) => toSupersede.add(x.id));
      continue;
    }

    const same = pend.find((x) => Math.abs(x.proposedPrice - proposal.price) < 0.005);
    if (same) {
      out.kept++;
      pend.filter((x) => x !== same).forEach((x) => toSupersede.add(x.id));
      continue;
    }
    pend.forEach((x) => toSupersede.add(x.id));

    const flags: ProposalFlag[] = [];
    if (proposal.clamped) flags.push("market_below_floor");
    if (available.length === 0) flags.push("only_out_of_stock");
    if (new Set(basis.map((e) => e.source)).size === 1) flags.push("single_source");
    if (p.current > 0 && Math.abs(diff) / p.current > BIG_CHANGE) flags.push("big_change");
    if (diff > 0) flags.push("price_up");

    if (diff > 0) out.dearer++;
    else out.cheaper++;
    if (proposal.clamped) out.belowFloor++;

    toCreate.push({
      productId: p.id,
      currentPrice: p.current,
      proposedPrice: proposal.price,
      wholesale: p.wholesale,
      market: best.price,
      marketSource: best.source,
      marketUrl: best.url,
      undercut: policy.undercut,
      flags,
      evidence: evidence as unknown as Prisma.InputJsonValue,
      week,
    });
  }

  out.created = toCreate.length;
  out.superseded = toSupersede.size;

  if (!opts.dry) {
    if (toSupersede.size > 0) {
      await prisma.priceProposal.updateMany({
        where: { id: { in: [...toSupersede] }, status: "PENDING" },
        data: { status: "SUPERSEDED", decidedAt: now },
      });
    }
    for (let i = 0; i < toCreate.length; i += 500) {
      await prisma.priceProposal.createMany({ data: toCreate.slice(i, i + 500) });
    }
    out.pendingTotal = await prisma.priceProposal.count({ where: { status: "PENDING" } });
  } else {
    out.pendingTotal = pending.length - toSupersede.size + toCreate.length;
    out.preview = toCreate;
  }
  return out;
}
