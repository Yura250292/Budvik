/**
 * Кеш АІ-інсайтів.
 *
 * Спільне для роутів «по торговому» і «по команді»: обидва читають кеш за
 * тим самим ключем (вид, торговий, межі періоду) і однаково вирішують, чи
 * він ще свіжий.
 *
 * Кеш тут не заради швидкості, а заради грошей: генерація коштує токенів,
 * а керівник за день відкриває картку десяток разів. GET віддає збережене,
 * POST — перегенеровує явним натисканням.
 */

import { prisma } from "@/lib/prisma";
import type { Insight, InsightKind } from "@/lib/ai/insights";

/**
 * Види звітів АІ-аналізу фірми.
 *
 * Лежать у тій самій таблиці й під тим самим ключем, що звіти по торговому
 * й команді: складений унікальний індекс (вид, торговий, межі періоду) це
 * вміщає без міграції, а repId у них завжди null — секція описує всю фірму.
 *
 * Payload у них не Insight[], а власна структура секції (блоки по людях,
 * списки дій), тому нижче тип поля ослаблений до unknown, а старі виклики
 * лишили свій Insight[] через дженерик.
 */
export type CompanyKind =
  | "company_reps"
  | "company_products"
  | "company_logistics"
  | "company_strategy";

export type ReportKind = InsightKind | CompanyKind;

/**
 * Скільки живе звіт. Доба, бо обмін із 1С іде вночі повним прогоном: до
 * ранку цифри однаково ті самі, а вранці вже нові.
 */
export const CACHE_TTL_HOURS = 24;

export type CachedReport<T = Insight[]> = {
  insights: T;
  facts: unknown;
  model: string;
  tokens: number;
  generatedAt: string;
  /** false — звіт старший за добу, варто оновити */
  fresh: boolean;
};

export async function readReport<T = Insight[]>(
  kind: ReportKind,
  repId: string | null,
  fromDay: string,
  toDay: string
): Promise<CachedReport<T> | null> {
  // findFirst, а не findUnique: у складеному ключі є nullable repId (null у
  // командного звіту), а Prisma не приймає null у where складеного унікального
  // індексу. Та сама причина, що в sales-plans.
  const row = await prisma.aiInsightReport.findFirst({
    where: { kind, repId, fromDay, toDay },
  });
  if (!row) return null;

  const ageHours = (Date.now() - row.createdAt.getTime()) / 3_600_000;

  return {
    insights: (row.insights as unknown as T) ?? ([] as unknown as T),
    facts: row.facts,
    model: row.model,
    tokens: row.tokens,
    generatedAt: row.createdAt.toISOString(),
    fresh: ageHours < CACHE_TTL_HOURS,
  };
}

export async function writeReport(input: {
  kind: ReportKind;
  repId: string | null;
  fromDay: string;
  toDay: string;
  insights: unknown;
  facts: unknown;
  model: string;
  tokens: number;
}): Promise<string> {
  const data = {
    insights: input.insights as unknown as object,
    facts: input.facts as object,
    model: input.model,
    tokens: input.tokens,
    // Явно оновлюємо, бо саме за нею рахується свіжість, а @default(now())
    // спрацьовує лише при створенні.
    createdAt: new Date(),
  };

  // findFirst → update/create замість upsert: у складеному ключі є nullable
  // repId, а Postgres рахує NULL різними значеннями, тож upsert плодив би
  // дублікати командних звітів. Той самий обхід, що в sales-plans.
  const existing = await prisma.aiInsightReport.findFirst({
    where: {
      kind: input.kind,
      repId: input.repId,
      fromDay: input.fromDay,
      toDay: input.toDay,
    },
    select: { id: true },
  });

  const row = existing
    ? await prisma.aiInsightReport.update({ where: { id: existing.id }, data })
    : await prisma.aiInsightReport.create({
        data: {
          kind: input.kind,
          repId: input.repId,
          fromDay: input.fromDay,
          toDay: input.toDay,
          ...data,
        },
      });

  return row.createdAt.toISOString();
}
