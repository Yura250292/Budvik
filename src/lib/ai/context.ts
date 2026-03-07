import { prisma } from "@/lib/prisma";

export async function getProductCatalogContext(): Promise<string> {
  const categories = await prisma.category.findMany({
    include: { _count: { select: { products: { where: { isActive: true } } } } },
  });

  let context = "КАТАЛОГ BUDVIK — КАТЕГОРІЇ ТОВАРІВ:\n";
  for (const c of categories) {
    context += `- ${c.name} (${c._count.products} товарів)\n`;
  }
  context += `\nЗагалом товарів в магазині: ${categories.reduce((s, c) => s + c._count.products, 0)}\n`;
  context += "\nПримітка: Щоб знайти конкретні товари для клієнта, використовуй дані з розділу РЕЗУЛЬТАТИ ПОШУКУ нижче.\n";

  return context;
}

export async function searchProductsForAI(query: string): Promise<string> {
  // Extract keywords from query (split by spaces, filter short words)
  const keywords = query
    .toLowerCase()
    .replace(/[^\wа-яіїєґ\s]/gi, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (keywords.length === 0) return "";

  // Search by each keyword with OR
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: keywords.flatMap((kw) => [
        { name: { contains: kw, mode: "insensitive" as const } },
        { description: { contains: kw, mode: "insensitive" as const } },
        { category: { name: { contains: kw, mode: "insensitive" as const } } },
      ]),
    },
    include: { category: true },
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: 50,
  });

  if (products.length === 0) return "\nРЕЗУЛЬТАТИ ПОШУКУ: Нічого не знайдено за запитом.\n";

  let context = `\nРЕЗУЛЬТАТИ ПОШУКУ (знайдено ${products.length} товарів):\n`;
  for (const p of products) {
    const stock = p.stock > 0 ? `В наявності: ${p.stock} шт` : "Немає в наявності";
    context += `- ${p.name} | ${p.category.name} | Ціна: ${p.price} грн | ${stock} | ${p.description?.slice(0, 100) || ""}\n`;
  }

  return context;
}

export async function getCategoriesContext(): Promise<string> {
  const categories = await prisma.category.findMany({
    include: { _count: { select: { products: true } } },
  });

  return categories
    .map((c) => `${c.name} (${c._count.products} товарів)`)
    .join(", ");
}

export async function getUserOrdersContext(userId: string): Promise<string> {
  const orders = await prisma.order.findMany({
    where: { userId },
    include: {
      items: { include: { product: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (orders.length === 0) return "У користувача немає замовлень.";

  let context = "ЗАМОВЛЕННЯ КОРИСТУВАЧА:\n";
  for (const order of orders) {
    context += `\nЗамовлення #${order.id.slice(-6)} від ${order.createdAt.toLocaleDateString("uk-UA")}:\n`;
    context += `  Статус: ${order.status}\n`;
    context += `  Сума: ${order.totalAmount} грн\n`;
    context += `  Товари:\n`;
    for (const item of order.items) {
      context += `    - ${item.product.name} x${item.quantity} (${item.price} грн)\n`;
    }
  }

  return context;
}

export async function getSalesAnalyticsContext(): Promise<string> {
  const [orders, products, lowStock] = await Promise.all([
    prisma.order.findMany({
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.product.findMany({
      where: { isActive: true },
      include: { category: true, orderItems: true },
    }),
    prisma.product.findMany({
      where: { isActive: true, stock: { lte: 5 } },
      include: { category: true },
      orderBy: { stock: "asc" },
    }),
  ]);

  let context = "АНАЛІТИКА ПРОДАЖІВ:\n\n";

  // Total stats
  const totalRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);
  const totalOrders = orders.length;
  context += `Загальний дохід (останні 100 замовлень): ${totalRevenue} грн\n`;
  context += `Кількість замовлень: ${totalOrders}\n\n`;

  // Product popularity
  const productSales: Record<string, { name: string; qty: number; revenue: number }> = {};
  for (const order of orders) {
    for (const item of order.items) {
      const key = item.productId;
      if (!productSales[key]) {
        productSales[key] = { name: item.product.name, qty: 0, revenue: 0 };
      }
      productSales[key].qty += item.quantity;
      productSales[key].revenue += item.price * item.quantity;
    }
  }

  const sorted = Object.values(productSales).sort((a, b) => b.qty - a.qty);
  context += "ТОП ПРОДАЖІВ:\n";
  sorted.slice(0, 10).forEach((p, i) => {
    context += `${i + 1}. ${p.name} — ${p.qty} шт, ${p.revenue} грн\n`;
  });

  // Slow movers
  const slowMovers = products
    .filter((p) => p.orderItems.length === 0)
    .slice(0, 10);
  if (slowMovers.length > 0) {
    context += "\nТОВАРИ БЕЗ ПРОДАЖІВ:\n";
    slowMovers.forEach((p) => {
      context += `- ${p.name} (${p.category.name}) — на складі: ${p.stock} шт\n`;
    });
  }

  // Low stock alerts
  if (lowStock.length > 0) {
    context += "\nНИЗЬКИЙ ЗАЛИШОК (<=5 шт):\n";
    lowStock.forEach((p) => {
      context += `- ${p.name} — ${p.stock} шт\n`;
    });
  }

  // Monthly breakdown
  const monthly: Record<string, { orders: number; revenue: number }> = {};
  for (const order of orders) {
    const key = order.createdAt.toISOString().slice(0, 7);
    if (!monthly[key]) monthly[key] = { orders: 0, revenue: 0 };
    monthly[key].orders++;
    monthly[key].revenue += order.totalAmount;
  }
  context += "\nПРОДАЖІ ПО МІСЯЦЯХ:\n";
  Object.entries(monthly)
    .sort(([a], [b]) => b.localeCompare(a))
    .forEach(([month, data]) => {
      context += `${month}: ${data.orders} замовлень, ${data.revenue} грн\n`;
    });

  return context;
}

export function getSystemPrompt(role: string): string {
  const prompts: Record<string, string> = {
    consultant: `Ти — AI-консультант інтернет-магазину інструментів BUDVIK.
Ти розмовляєш українською мовою.
Ти допомагаєш клієнтам обрати інструмент для їхніх потреб.

Правила:
1. Відповідай ТІЛЬКИ на основі наданого каталогу товарів
2. Рекомендуй конкретні товари з каталогу з цінами
3. Порівнюй товари коли це доречно
4. Вказуй переваги та недоліки
5. Враховуй бюджет клієнта
6. Якщо товару немає в каталозі — чесно скажи про це
7. Будь дружнім та професійним
8. Відповідай структуровано з форматуванням markdown

Форматування:
- Використовуй **жирний** для назв товарів та цін
- Використовуй списки для переваг і недоліків
- ОБОВ'ЯЗКОВО будуй порівняльні таблиці коли клієнт порівнює 2+ товари або просить порекомендувати кілька варіантів
- Формат таблиці (markdown GFM):

| Характеристика | Товар 1 | Товар 2 | Товар 3 |
|---|---|---|---|
| Ціна | 1000 грн | 2000 грн | 3000 грн |
| Потужність | 500 Вт | 800 Вт | 1200 Вт |
| Наявність | В наявності | В наявності | Немає |
| Рекомендація | Для дому | Універсальний | Професійний |

- В кінці таблиці завжди додавай рядок "Рекомендація" або "Висновок"
- Після таблиці додай коротку фінальну рекомендацію`,

    wizard: `Ти — AI-помічник з підбору інструментів BUDVIK.
Ти розмовляєш українською мовою.

Твоя задача — підібрати найкращі інструменти на основі:
1. Типу роботи (дерево/метал/бетон/плитка тощо)
2. Частоти використання (дім/ремонт/професійне)
3. Бюджету

Формат відповіді:
- ТОП 3-5 товарів
- Для кожного: назва, ціна, переваги, недоліки
- Порівняльна таблиця (markdown)
- Фінальна рекомендація`,

    support: `Ти — AI-помічник підтримки клієнтів BUDVIK.
Ти розмовляєш українською мовою.

Ти можеш допомогти з:
1. Статусом замовлення
2. Інформацією про доставку
3. Гарантійними питаннями
4. Питаннями щодо використання товарів

Правила:
- Використовуй надані дані про замовлення
- Будь ввічливим та корисним
- Якщо не знаєш відповіді — порадь звернутися до менеджера
- Гарантія на електроінструмент: 2 роки, ручний інструмент: 1 рік`,

    analytics: `Ти — AI-аналітик продажів BUDVIK.
Ти розмовляєш українською мовою.

Аналізуй надані дані та генеруй:
1. Тренди продажів
2. Сезонний попит
3. Аналіз залишків
4. Рекомендації щодо закупівель
5. Прогнози
6. Товари для промоакцій

Формат: структурований звіт з конкретними цифрами та рекомендаціями.`,

    content: `Ти — AI-копірайтер для інтернет-магазину інструментів BUDVIK.
Ти розмовляєш українською мовою.

Генеруй:
1. Опис товару (200-300 слів)
2. Переваги (5-7 пунктів)
3. Недоліки (2-3 пункти, чесно)
4. Сценарії використання
5. SEO-текст з ключовими словами

Стиль: професійний, зрозумілий, орієнтований на покупця.`,
  };

  return prompts[role] || prompts.consultant;
}
