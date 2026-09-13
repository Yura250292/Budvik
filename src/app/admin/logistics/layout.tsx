import { Suspense } from "react";
import { LogisticsNav } from "./components/LogisticsNav";

/**
 * Розділ «Логістика»: усе про рух торгових і водіїв в одному місці.
 *
 * До 13.09.2026 це жило в чотирьох кутках адмінки: вкладка «Логістика» в
 * аналітиці продажів (поруч із КПІ, до яких вона не має стосунку), «Аналітика
 * водіїв» (там же захована єдина карта, що бачить водіїв), «Маршрути» доставки
 * й пульт треку. Тепер кожен підрозділ — окрема адреса під спільною шапкою.
 *
 * Адреси, а не ?tab=: сайдбар, вкладки шелла й крихти знають лише шлях, а
 * «Доставка» вже тримає власний ?tab=day|journal|map.
 *
 * Контейнер задає layout, сторінки всередині — без власного: інакше кожна
 * з восьми мала б свій відступ і заголовок стрибав би при перемиканні.
 */
export default function LogisticsLayout({ children }: LayoutProps<"/admin/logistics">) {
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6">
      <div>
        <h1 className="text-xl font-bold text-bk sm:text-2xl">Логістика</h1>
        <p className="mt-0.5 text-sm text-g500">
          Хто де їде, маршрути водіїв і напрямки торгових, пробіг, паливо й каса
        </p>
      </div>
      {/* Смужка читає ?from=&to=, щоб перенести період між сторінками, —
          а useSearchParams вимагає межі Suspense. */}
      <Suspense fallback={<div className="h-[34px] border-b border-g200" />}>
        <LogisticsNav />
      </Suspense>
      <>{children}</>
    </div>
  );
}
