/**
 * Оболонка дріллів кабінету (/sales/analytics/money, /plan).
 *
 * Роль-гейт звідси прибрано — він тепер один на всю секцію, у
 * SalesGate (src/app/sales/layout.tsx). Відступ під навбар — теж там,
 * тому колишній pb-28 тут зайвий: він давав подвійний відступ.
 */
export default function SalesAnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {/* max-w-lg скроєний під телефон: на планшеті таблиця «План по фірмах»
          (5 колонок) у 512px не влазила і різала «Заробіток». */}
      <div className="mx-auto max-w-lg px-4 pt-4 sm:max-w-2xl">{children}</div>
    </div>
  );
}
