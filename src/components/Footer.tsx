import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-[#0A0A0A] text-[#9E9E9E] mt-auto hidden md:block">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-xl font-bold text-[#FFD600] mb-4">BUDVIK</h3>
            <p className="text-sm leading-relaxed">
              Ваш надійний партнер у світі інструментів. Електро та ручний інструмент
              від провідних виробників.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-4">Навігація</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/catalog" className="hover:text-[#FFD600] transition duration-200">Каталог</Link></li>
              <li><Link href="/dashboard/orders" className="hover:text-[#FFD600] transition duration-200">Мої замовлення</Link></li>
              <li><Link href="/dashboard/loyalty" className="hover:text-[#FFD600] transition duration-200">Програма лояльності</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-4">Контакти</h4>
            <ul className="space-y-2.5 text-sm">
              <li>+380 (50) 123-45-67</li>
              <li>info@budvik.ua</li>
              <li>м. Київ, вул. Інструментальна, 1</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[#1A1A1A] mt-10 pt-6 text-center text-sm text-[#9E9E9E]">
          &copy; 2026 Budvik. Усі права захищені.
        </div>
      </div>
    </footer>
  );
}
