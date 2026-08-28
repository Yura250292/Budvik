/**
 * Оболонка дріллів кабінету (/sales/analytics/money, /plan).
 *
 * Роль-гейт звідси прибрано — він тепер один на всю секцію, у
 * SalesGate (src/app/sales/layout.tsx). Відступ під навбар — теж там,
 * тому колишній pb-28 тут зайвий: він давав подвійний відступ.
 */
export default function SalesAnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    // Фон дає секція (/sales/layout.tsx) — тут він лише перебивався б на білий.
    // max-w-lg скроєний під телефон; на планшеті ширше, бо там поруч уміщається
    // і назва фірми, і обидві суми.
    <div className="mx-auto flex max-w-lg flex-col gap-3 px-4 py-4 sm:max-w-2xl">{children}</div>
  );
}
