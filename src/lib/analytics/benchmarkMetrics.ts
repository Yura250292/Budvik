/**
 * Опис метрик бенчмарку — спільний для сервера й клієнта.
 *
 * Живе окремо від `benchmark.ts` навмисно: той модуль тягне Prisma, і
 * якщо клієнтський компонент імпортує звідти значення (а не лише тип),
 * Prisma потрапляє у браузерний бандл і сторінка падає з
 * «sqltag is unable to run in this browser environment».
 */
export const METRICS = {
  revenue: { label: "Оборот", higherIsBetter: true, unit: "uah" },
  docs: { label: "Реалізацій", higherIsBetter: true, unit: "count" },
  clients: { label: "Клієнтів", higherIsBetter: true, unit: "count" },
  avgCheck: { label: "Середній чек", higherIsBetter: true, unit: "uah" },
  collected: { label: "Зібрано грошей", higherIsBetter: true, unit: "uah" },
  overdueRatio: { label: "Прострочена дебіторка", higherIsBetter: false, unit: "pct" },
  returnRatio: { label: "Частка повернень", higherIsBetter: false, unit: "pct" },
  skuPerClient: { label: "SKU на клієнта", higherIsBetter: true, unit: "count" },
  brandCount: { label: "Брендів у продажах", higherIsBetter: true, unit: "count" },
  newClients: { label: "Нових клієнтів", higherIsBetter: true, unit: "count" },
  lostClients: { label: "Втрачених клієнтів", higherIsBetter: false, unit: "count" },
  momentumPct: { label: "Динаміка обороту", higherIsBetter: true, unit: "pct" },
} as const;

export type MetricKey = keyof typeof METRICS;
