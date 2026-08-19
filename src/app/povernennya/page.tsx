import Link from "next/link";

/**
 * Умови обміну та повернення.
 *
 * Сторінка потрібна не лише покупцю: Google Merchant Center вимагає
 * публічний URL з умовами повернення і звіряє його перед допуском товарів
 * у «Покупки». Тому текст тримається фактів і закону, без маркетингу.
 */
export const metadata = {
  title: "Обмін та повернення",
  description:
    "Умови обміну та повернення товарів у магазині БУДВІК27: 14 днів на повернення згідно із законом «Про захист прав споживачів», обмін і гарантійні випадки, порядок повернення коштів.",
  alternates: { canonical: "/povernennya" },
};

export default function ReturnsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <nav className="mb-4 flex items-center gap-2 text-sm text-[#9E9E9E]">
        <Link href="/" className="transition hover:text-[#FFB800]">Головна</Link>
        <span className="text-[#DADADA]">/</span>
        <span className="font-medium text-[#0A0A0A]">Обмін та повернення</span>
      </nav>

      <h1 className="mb-6 text-2xl font-bold text-[#0A0A0A] sm:text-3xl">Обмін та повернення</h1>

      <div className="space-y-6 text-[15px] leading-relaxed text-[#1A1A1A]">
        <section>
          <h2 className="mb-2 text-lg font-bold text-[#0A0A0A]">Повернення товару належної якості</h2>
          <p>
            Ви можете повернути або обміняти товар протягом <strong>14 днів</strong> з дня покупки
            (ст. 9 Закону України «Про захист прав споживачів»), якщо:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>товар не використовувався і не має слідів експлуатації;</li>
            <li>збережено товарний вигляд, пломби, ярлики та повну комплектацію;</li>
            <li>збережено упаковку виробника;</li>
            <li>є розрахунковий документ (чек або електронне підтвердження замовлення).</li>
          </ul>
          <p className="mt-2">
            Кошти повертаємо тим самим способом, яким було здійснено оплату, протягом
            <strong> 7 робочих днів</strong> після отримання й перевірки товару.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-[#0A0A0A]">Товари, що не підлягають поверненню</h2>
          <p>
            Згідно з постановою Кабінету Міністрів України № 172 від 19.03.1994, поверненню за
            умови належної якості не підлягають, зокрема: витратні матеріали з порушеною
            упаковкою (абразивні та відрізні круги, свердла, пильні полотна тощо, якщо їх
            заводську упаковку розкрито), елементи живлення, а також товари, виготовлені чи
            укомплектовані під індивідуальне замовлення.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-[#0A0A0A]">Товар із недоліком (гарантійний випадок)</h2>
          <p>
            Якщо у товарі виявлено виробничий дефект, протягом гарантійного строку ви маєте право
            на безоплатний ремонт, обмін на аналогічний товар або повернення коштів — відповідно
            до Закону України «Про захист прав споживачів». Звертайтеся з розрахунковим документом
            і гарантійним талоном (якщо він видавався). Гарантійний строк вказано виробником у
            документації до товару.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-[#0A0A0A]">Як повернути товар</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>У магазині:</strong> м. Львів, вул. Липинського, 36 — у робочі години.
            </li>
            <li>
              <strong>Поштою:</strong> попередньо зателефонуйте нам або напишіть — узгодимо
              відправлення «Новою поштою».
            </li>
          </ul>
          <p className="mt-2">
            Контакти: <a href="tel:+380772700027" className="font-medium text-[#B8860B] hover:underline">077 270 00 27</a>,{" "}
            <a href="tel:+380932700027" className="font-medium text-[#B8860B] hover:underline">093 270 00 27</a>,{" "}
            <a href="mailto:budvik27@gmail.com" className="font-medium text-[#B8860B] hover:underline">budvik27@gmail.com</a>.
          </p>
        </section>
      </div>
    </div>
  );
}
