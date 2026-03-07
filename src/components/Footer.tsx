import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400 mt-auto hidden md:block">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-xl font-bold text-orange-500 mb-3">BUDVIK</h3>
            <p className="text-sm">
              Ваш надійний партнер у світі інструментів. Електро та ручний інструмент
              від провідних виробників.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-3">Навігація</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/catalog" className="hover:text-orange-400 transition">Каталог</Link></li>
              <li><Link href="/dashboard/orders" className="hover:text-orange-400 transition">Мої замовлення</Link></li>
              <li><Link href="/dashboard/loyalty" className="hover:text-orange-400 transition">Програма лояльності</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-white mb-3">Контакти</h4>
            <ul className="space-y-2 text-sm">
              <li>+380 (50) 123-45-67</li>
              <li>info@budvik.ua</li>
              <li>м. Київ, вул. Інструментальна, 1</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 mt-8 pt-4 text-center text-sm">
          &copy; 2026 Budvik. Усі права захищені.
        </div>
      </div>
    </footer>
  );
}
