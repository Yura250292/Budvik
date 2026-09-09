/**
 * Ряд товарів на головній.
 *
 * До 09.09.2026 на головній не було ні одного товару: банери розділів, вітрина
 * брендів і зміст — усе про навігацію, і купити щось звідси було неможливо без
 * двох кліків углиб. Дві сітки («Хіти продажу» і «Популярні товари») звідси
 * колись прибрали, і не помилково: замовлень у базі шість, тож «хіти» нічого
 * не означали, а «популярне» відбиралось за словами в назві навмання.
 *
 * Тому цей ряд не вигадує популярності. Він показує ту саму сезонну добірку,
 * яку вже обіцяє банер над ним, — тобто рівно те, за що магазин ручається:
 * або товари, заведені в акцію в адмінці (SeasonalPromo.productIds), або
 * сезонні ключові слова. Банер і ряд говорять одне й те саме.
 */

import Link from "next/link";
import ProductCard from "@/components/ProductCard";

type Product = React.ComponentProps<typeof ProductCard>;

export default function HomeProductRow({
  title,
  href,
  products,
}: {
  title: string;
  href: string;
  products: Product[];
}) {
  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-3 pt-8 sm:px-4 sm:pt-10">
      <div className="mb-3 flex items-end justify-between gap-3 sm:mb-4">
        <h2 className="text-xl font-bold text-[#0A0A0A] sm:text-2xl">{title}</h2>
        <Link
          href={href}
          className="flex-shrink-0 text-sm font-medium text-[#6B6B6B] transition hover:text-[#0A0A0A]"
        >
          Усі товари <span aria-hidden="true">→</span>
        </Link>
      </div>

      {/* Дві в ряд на телефоні, чотири на екрані — під вибірку з восьми
          рівно два повні рядки в обох випадках, без сироти в хвості. */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.id} {...p} />
        ))}
      </div>
    </section>
  );
}
