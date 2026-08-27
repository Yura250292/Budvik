/**
 * План по фірмах і заробіток у розрізі фірм — для кабінету торгового.
 *
 * Окремий ендпоінт існує з однієї причини: розкладу заробітку по брендах
 * немає ніде більше. rep/[repId] віддає earnings.lines як RuleResult[], а
 * там немає brandId — на клієнті ruleId → brandId не відновити.
 *
 * Чому не розширити rep/[repId]: він тягне 50 документів, timeline, 100
 * боржників, поїздки й паливо. Для шести кілець це ~200 КБ зайвого JSON
 * по мобільному інтернету, а торгові в полі саме з телефонів.
 *
 * Дві часові рамки, як і в зведеній:
 *   • план і його виконання — за КАЛЕНДАРНИЙ МІСЯЦЬ (план місячний);
 *   • зібране, кількість і заробіток — за обраний період.
 * Дебіторка сюди не входить взагалі — вона на екрані «Гроші».
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parsePeriod, parseMonth } from "@/lib/analytics/period";
import { revenueByRepBrand } from "@/lib/analytics/facts";
import { collectedByRepBrand, collectedByBrand, receivableRowsByRep } from "@/lib/analytics/money-facts";
import { earningsByRep, resolveSchemes } from "@/lib/motivation/period-facts";
import { attainmentPercent } from "@/lib/motivation/engine";
import { splitEarningsByBrand } from "@/lib/motivation/brand-earnings";
import { categoricalColor } from "@/lib/analytics/colors";
import { resolveIdentity } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

/** Брендовий жовтий заборонений у даних (contrast 1.35:1) — див. colors.ts. */
const BRAND_YELLOW = "#ffd600";

function brandColor(color: string | null, index: number): string {
  const clean = color && color.toLowerCase() !== BRAND_YELLOW ? color : null;
  return categoricalColor(index, clean);
}

export async function GET(req: NextRequest) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const role = me.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  if (!isFullAccess && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);
  const monthRange = parseMonth(period.toDay.slice(0, 7));
  const { month, periodStart } = monthRange;

  // Керівник може подивитися чужий розклад; торговий — тільки свій, хоч
  // би що передав у параметрі: інакше будь-хто підставив би чужий id.
  const requested = searchParams.get("repId");
  const repId = isFullAccess ? requested || me.userId : me.userId;

  const rep = await prisma.user.findUnique({
    where: { id: repId },
    select: { id: true, name: true },
  });
  if (!rep) {
    return NextResponse.json({ error: "Торгового не знайдено" }, { status: 404 });
  }

  const [plans, brands, monthRevByBrand, periodRevByBrand, collected, receivables, schemes] =
    await Promise.all([
      prisma.salesPlan.findMany({
        where: { period: "MONTH", metric: "REVENUE", periodStart, repId },
        select: { brandId: true, targetValue: true },
      }),
      prisma.brand.findMany({
        where: { isActive: true },
        select: { id: true, name: true, color: true },
        orderBy: [{ priority: "desc" }, { name: "asc" }],
      }),
      // Факт для плану — за МІСЯЦЬ: 40% виконання за третину місяця це
      // нормальний темп, а не провал.
      revenueByRepBrand(monthRange.from, monthRange.to, repId),
      // Кількість — за ПЕРІОД, як і решта «потокових» чисел.
      revenueByRepBrand(period.from, period.to, repId),
      collectedByRepBrand(period.from, period.to, repId),
      receivableRowsByRep(repId),
      // Схема потрібна окремо: саме звідси беремо rule.brandId для розкладу.
      resolveSchemes([repId], period.to),
    ]);

  // Рушій отримує вже завантажені зібране й борги — інакше ті самі два
  // важкі запити виконалися б удруге.
  const earnings = (
    await earningsByRep([repId], period, month, { collected, receivables })
  ).get(repId);

  const scheme = schemes.get(repId);
  const split = splitEarningsByBrand(earnings ?? null, scheme?.rules ?? []);

  const brandMeta = new Map(brands.map((b) => [b.id, b]));
  const planByBrand = new Map<string, number>();
  let totalTarget = 0;
  for (const p of plans) {
    if (p.brandId) planByBrand.set(p.brandId, p.targetValue);
    else totalTarget = p.targetValue;
  }

  const monthByBrand = new Map<string, number>();
  let monthActual = 0;
  for (const r of monthRevByBrand) {
    monthActual += r.amount;
    if (r.brandId) monthByBrand.set(r.brandId, r.amount);
  }

  const qtyByBrand = new Map<string, number>();
  for (const r of periodRevByBrand) {
    if (r.brandId) qtyByBrand.set(r.brandId, r.qty);
  }

  const collectedBrandMap = collectedByBrand(collected, repId);

  // Бренд потрапляє в список, якщо має план АБО продажі АБО правило
  // мотивації. Бренд із планом і нулем продажів — найважливіше кільце
  // на екрані, саме про нього розмова з керівником.
  const keys = new Set<string>([
    ...planByBrand.keys(),
    ...monthByBrand.keys(),
    ...qtyByBrand.keys(),
    ...split.byBrand.keys(),
  ]);

  const brandRows = Array.from(keys)
    .map((id) => {
      const target = planByBrand.get(id) ?? 0;
      const actual = monthByBrand.get(id) ?? 0;
      const earned = split.byBrand.get(id) ?? null;
      return {
        brandId: id,
        brandName: brandMeta.get(id)?.name ?? "Невідома фірма",
        rawColor: brandMeta.get(id)?.color ?? null,
        target,
        actual,
        attainment: attainmentPercent("REVENUE", actual, target),
        qty: qtyByBrand.get(id) ?? 0,
        collected: collectedBrandMap.get(id)?.collected ?? 0,
        /** null — за цією фірмою окремих правил у схемі немає */
        earned: earned ? earned.amount : null,
        earnedLines: earned ? earned.lines : [],
      };
    })
    // Спершу ті, де є план: вони й є предметом розмови.
    .sort((a, b) => b.target - a.target || b.actual - a.actual);

  // Індекс кольору рахуємо ОКРЕМО для фірм із планом.
  //
  // Палітра свідомо не циклиться: після восьмого ряду categoricalColor
  // віддає сірий, щоб два бренди не ділили один хюї. Торговий цілком може
  // мати 20+ фірм у продажах, і якщо роздавати індекси наскрізь, то фірма
  // з планом на дев'ятому місці отримала б сірий кружок — при тому, що
  // саме кільця з планом і треба розрізняти. Фірми без плану йдуть
  // списком, а не кільцями, тож сірий для них нічого не ламає.
  let plannedIndex = 0;
  const withColor = brandRows.map((b) => {
    const { rawColor, ...rest } = b;
    const index = b.target > 0 ? plannedIndex++ : Number.MAX_SAFE_INTEGER;
    return { ...rest, color: brandColor(rawColor, index) };
  });

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    month,
    rep,
    plan: {
      target: totalTarget,
      actual: monthActual,
      attainment: attainmentPercent("REVENUE", monthActual, totalTarget),
    },
    brands: withColor,
    earnings: earnings
      ? {
          schemeName: earnings.schemeName,
          total: earnings.total,
          gross: earnings.gross,
          penalties: earnings.penalties,
          byBrand: split.brandTotal,
          general: split.general,
          generalLines: split.generalLines,
          penaltyLines: split.penaltyLines,
        }
      : null,
    /** false — розклад не б'ється з підсумком рушія; UI має попередити */
    reconciles: split.reconciles,
  });
}
