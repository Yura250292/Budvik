/**
 * АІ-аналіз фірми: одна секція за запит.
 *
 * GET  — віддає кеш (або порожньо, якщо ще не генерували).
 * GET ?facts=1 — зібрані факти без звернення до моделі: нею перевіряють
 *   цифри перед тим, як витрачати токени, і нею ж дивляться, чому висновок
 *   вийшов саме таким.
 * POST — рахує факти й генерує заново.
 *
 * Розділення те саме, що в інсайтах по торговому: генерація коштує грошей,
 * тож вона має бути явним натисканням, а не побічним ефектом відкриття
 * сторінки. Кеш живе добу — обмін із 1С іде вночі повним прогоном.
 *
 * Доступ лише ADMIN/MANAGER, без гілки для SALES: тут чужі маржі, борги
 * всієї бази і зарплати водіїв.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod, shiftDay, type Period } from "@/lib/analytics/period";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import {
  buildRepsSectionFacts,
  buildProductsSectionFacts,
  buildLogisticsSectionFacts,
  buildStrategySectionFacts,
} from "@/lib/analytics/company/company-facts";
import {
  generateCompanySection,
  companyInsightsConfigured,
  type CompanySection,
} from "@/lib/ai/company-insights";
import { readReport, writeReport, type CompanyKind } from "@/lib/ai/insight-cache";

export const dynamic = "force-dynamic";

/**
 * Секція «Торгові» — 11 блоків із чеклістами, до 16 тис. токенів виводу.
 * Стандартних 120 с їй мало; якщо хостинг обмежує менше, зменшувати треба
 * стелю виводу в company-insights.ts, а не кількість торгових.
 */
export const maxDuration = 300;

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

const SECTIONS: CompanySection[] = ["reps", "products", "logistics", "strategy"];

const KIND: Record<CompanySection, CompanyKind> = {
  reps: "company_reps",
  products: "company_products",
  logistics: "company_logistics",
  strategy: "company_strategy",
};

/**
 * Мінімум днів для товарної секції.
 *
 * ABC/XYZ рахує варіацію по місяцях: на вікні коротшому за місяць вона не
 * рахується взагалі, і секція вийшла б без половини змісту. Тому зовсім
 * короткі вікна розширюються, і про це чесно каже periodNote.
 *
 * Поріг саме 28 днів, а не «два місяці»: «цей місяць» і «30 днів» — це
 * свідомий вибір керівника, і мовчки підміняти його на 90 днів означало б
 * показувати не те, що людина попросила. Оборотність складу однаково
 * рахується за своїм вікном у 90 днів незалежно від періоду — вона про
 * залишки станом на зараз, і в фактах це підписано.
 */
const PRODUCTS_MIN_DAYS = 28;
const PRODUCTS_WIDE_DAYS = 90;

type Resolved = {
  /** Вікно, за яким рахуються факти. Для товарів може бути ширшим за обране. */
  period: Period;
  /**
   * Період, обраний керівником. Саме він — ключ кешу, навіть коли факти
   * рахувалися за ширшим вікном: інакше «Товари» за поточний місяць лягали б
   * у кеш під ключем 90 днів, і «Стратегія» за той самий місяць їх не
   * знаходила б — 409 «спершу згенеруйте Товари» на щойно згенерованих
   * товарах. Ключем має бути те, що людина обрала, а не те, що ми порахували.
   */
  keyPeriod: Period;
  note: string | null;
};

/** Період секції: для товарів вузьке вікно розширюється до 90 днів. */
function resolvePeriod(section: CompanySection, period: Period): Resolved {
  if (section !== "products" || period.days >= PRODUCTS_MIN_DAYS) {
    return { period, keyPeriod: period, note: null };
  }

  const fromDay = shiftDay(period.toDay, -(PRODUCTS_WIDE_DAYS - 1));
  return {
    period: {
      ...period,
      fromDay,
      from: kyivDayStart(fromDay),
      to: kyivDayEnd(period.toDay),
      days: PRODUCTS_WIDE_DAYS,
    },
    keyPeriod: period,
    note: `Продажі пораховані за ${PRODUCTS_WIDE_DAYS} днів (${fromDay} — ${period.toDay}): ABC і оборотність на коротшому вікні беззмістовні.`,
  };
}

async function guard(req: NextRequest, sectionParam: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Не авторизовано" }, { status: 401 }) };
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return { error: NextResponse.json({ error: "Немає доступу" }, { status: 403 }) };
  }

  const section = SECTIONS.find((s) => s === sectionParam);
  if (!section) {
    return { error: NextResponse.json({ error: "Невідомий розділ аналізу" }, { status: 404 }) };
  }

  const { searchParams } = new URL(req.url);
  return { section, ...resolvePeriod(section, parsePeriod(searchParams)) };
}

/**
 * Факти секції. Для стратегії може повернутися «спершу згенеруйте інші».
 *
 * `period` — вікно розрахунку, `keyPeriod` — обраний керівником період, за
 * яким шукаються сусідні секції в кеші. Для всіх секцій, крім товарів, вони
 * збігаються.
 */
async function buildFacts(section: CompanySection, period: Period, keyPeriod: Period) {
  if (section === "reps") return { ok: true as const, facts: await buildRepsSectionFacts(period) };
  if (section === "products")
    return { ok: true as const, facts: await buildProductsSectionFacts(period) };
  if (section === "logistics")
    return { ok: true as const, facts: await buildLogisticsSectionFacts(period) };

  const strategy = await buildStrategySectionFacts(keyPeriod);
  return strategy.ok
    ? { ok: true as const, facts: strategy.facts }
    : { ok: false as const, missing: strategy.missing };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ section: string }> }) {
  const { section: sectionParam } = await ctx.params;
  const checked = await guard(req, sectionParam);
  if ("error" in checked) return checked.error;

  const { section, period, keyPeriod, note } = checked;

  // ?facts=1 — подивитися цифри, не витрачаючи токенів. Для стратегії це
  // ще й спосіб побачити, яких секцій бракує, не натискаючи «Згенерувати».
  if (new URL(req.url).searchParams.get("facts") === "1") {
    const built = await buildFacts(section, period, keyPeriod);
    return NextResponse.json({
      section,
      period: { from: period.fromDay, to: period.toDay, days: period.days },
      periodNote: note,
      ...(built.ok ? { facts: built.facts } : { missing: built.missing }),
    });
  }

  const cached = await readReport(KIND[section], null, keyPeriod.fromDay, keyPeriod.toDay);

  return NextResponse.json({
    section,
    configured: companyInsightsConfigured(),
    report: cached,
    period: { from: keyPeriod.fromDay, to: keyPeriod.toDay, days: keyPeriod.days },
    periodNote: note,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ section: string }> }) {
  const { section: sectionParam } = await ctx.params;
  const checked = await guard(req, sectionParam);
  if ("error" in checked) return checked.error;

  const { section, period, keyPeriod, note } = checked;

  if (!companyInsightsConfigured()) {
    return NextResponse.json(
      { error: "АІ-аналіз не налаштований: бракує ANTHROPIC_API_KEY" },
      { status: 503 }
    );
  }

  const built = await buildFacts(section, period, keyPeriod);
  if (!built.ok) {
    // 409, а не 400: запит правильний, просто ще не час. Стратегія
    // будується на висновках інших секцій, і без них вона була б переказом
    // сирих цифр — гіршим за самі секції.
    return NextResponse.json(
      {
        error: `Спершу згенеруйте розділи за цей період: ${built.missing.join(", ")}`,
        missing: built.missing,
      },
      { status: 409 }
    );
  }

  let result;
  try {
    result = await generateCompanySection({ section, facts: built.facts });
  } catch (e) {
    console.error(`ai-analysis ${section}`, e);
    return NextResponse.json(
      { error: `Модель не відповіла: ${(e as Error).message}` },
      { status: 502 }
    );
  }

  const generatedAt = await writeReport({
    kind: KIND[section],
    repId: null,
    fromDay: keyPeriod.fromDay,
    toDay: keyPeriod.toDay,
    insights: result.payload,
    facts: built.facts,
    model: result.model,
    tokens: result.tokens,
  });

  return NextResponse.json({
    section,
    configured: true,
    report: {
      insights: result.payload,
      facts: built.facts,
      model: result.model,
      tokens: result.tokens,
      generatedAt,
      fresh: true,
    },
    period: { from: keyPeriod.fromDay, to: keyPeriod.toDay, days: keyPeriod.days },
    periodNote: note,
    rejected: result.rejected,
  });
}
