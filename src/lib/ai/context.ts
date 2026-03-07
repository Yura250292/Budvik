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

// Common stop words that pollute search results
const STOP_WORDS = new Set([
  // Ukrainian
  "що", "які", "яка", "який", "яке", "для", "при", "або", "але", "так",
  "дай", "дати", "дайте", "покажи", "покажіть", "порівняй", "порівняйте",
  "топ", "кращі", "краще", "найкращі", "найкращий", "найкраще",
  "хочу", "потрібно", "потрібен", "потрібна", "треба", "можна", "можеш",
  "порадь", "порадьте", "підкажи", "підкажіть", "розкажи", "розкажіть",
  "будь", "ласка", "давай", "давайте", "скільки", "коштує",
  "допоможи", "допоможіть", "варіант", "варіанти", "варіантів",
  "між", "межах", "грн", "гривень", "тис", "тисяч", "тисячі",
  "про", "мені", "мене", "нам", "нас", "цей", "ця", "це", "ці",
  "той", "та", "те", "ті", "від", "біл", "біля", "під", "над", "без",
  "ще", "вже", "теж", "також", "тут", "там", "дуже", "трохи",
  "всі", "усі", "все", "кожен", "інший", "інші", "інша", "ніж",
  "просто", "саме", "лише", "тільки", "зараз", "сьогодні",
  "добре", "гарно", "чудово", "окей", "ладно", "зрозумів", "дякую",
  "привіт", "вітаю", "здрастуйте",
  // Russian
  "что", "какой", "какая", "какие", "для", "или", "дай", "покажи",
  "лучший", "лучшие", "хочу", "нужно", "можно", "подскажи",
  "сколько", "стоит", "рублей", "тысяч",
]);

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function extractPriceRange(query: string): { min?: number; max?: number } {
  const result: { min?: number; max?: number } = {};

  // "2.5-3 тис" or "2500-3000"
  const rangeMatch = query.match(/(\d+[.,]?\d*)\s*[-–]\s*(\d+[.,]?\d*)\s*(тис|тисяч|тисячі)?/i);
  if (rangeMatch) {
    let min = parseFloat(rangeMatch[1].replace(",", "."));
    let max = parseFloat(rangeMatch[2].replace(",", "."));
    if (rangeMatch[3]) { min *= 1000; max *= 1000; }
    result.min = min;
    result.max = max;
    return result;
  }

  // "до 5000" or "до 5 тис"
  const upToMatch = query.match(/до\s+(\d+[.,]?\d*)\s*(тис|тисяч|тисячі)?/i);
  if (upToMatch) {
    let max = parseFloat(upToMatch[1].replace(",", "."));
    if (upToMatch[2]) max *= 1000;
    result.max = max;
    return result;
  }

  // "від 3000" or "від 3 тис"
  const fromMatch = query.match(/від\s+(\d+[.,]?\d*)\s*(тис|тисяч|тисячі)?/i);
  if (fromMatch) {
    let min = parseFloat(fromMatch[1].replace(",", "."));
    if (fromMatch[2]) min *= 1000;
    result.min = min;
  }

  return result;
}

export async function searchProductsForAI(query: string): Promise<string> {
  // Extract meaningful keywords, filtering stop words
  const keywords = query
    .toLowerCase()
    .replace(/[^\wа-яіїєґ\s]/gi, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Deduplicate
  const unique = [...new Set(keywords)];

  if (unique.length === 0) return "";

  // Extract price range from query
  const priceRange = extractPriceRange(query);

  // Build price filter
  const priceFilter: Record<string, number> = {};
  if (priceRange.min) priceFilter.gte = priceRange.min;
  if (priceRange.max) priceFilter.lte = priceRange.max;

  // Search by each keyword with OR
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(Object.keys(priceFilter).length > 0 ? { price: priceFilter } : {}),
      OR: unique.flatMap((kw) => [
        { name: { contains: kw, mode: "insensitive" as const } },
        { description: { contains: kw, mode: "insensitive" as const } },
        { category: { name: { contains: kw, mode: "insensitive" as const } } },
      ]),
    },
    include: { category: true },
    orderBy: [{ stock: "desc" }, { price: "asc" }],
    take: 50,
  });

  // If price-filtered search returned nothing, try without price filter
  let finalProducts = products;
  if (products.length === 0 && Object.keys(priceFilter).length > 0) {
    finalProducts = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: unique.flatMap((kw) => [
          { name: { contains: kw, mode: "insensitive" as const } },
          { description: { contains: kw, mode: "insensitive" as const } },
          { category: { name: { contains: kw, mode: "insensitive" as const } } },
        ]),
      },
      include: { category: true },
      orderBy: [{ stock: "desc" }, { price: "asc" }],
      take: 50,
    });
  }

  if (finalProducts.length === 0) return "\nРЕЗУЛЬТАТИ ПОШУКУ: Нічого не знайдено за запитом.\n";

  // Score products by relevance (how many keywords match in name)
  const scored = finalProducts.map((p) => {
    const nameLower = p.name.toLowerCase();
    const catLower = p.category.name.toLowerCase();
    let score = 0;
    for (const kw of unique) {
      if (nameLower.includes(kw)) score += 3;
      if (catLower.includes(kw)) score += 2;
    }
    if (p.stock > 0) score += 1;
    return { product: p, score };
  });

  // Sort by score descending, then by price
  scored.sort((a, b) => b.score - a.score || a.product.price - b.product.price);

  // Take top 30 most relevant
  const topProducts = scored.slice(0, 30);

  // Group by category for better AI understanding
  const byCategory: Record<string, typeof topProducts> = {};
  for (const item of topProducts) {
    const cat = item.product.category.name;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  }

  let context = `\nРЕЗУЛЬТАТИ ПОШУКУ (знайдено ${finalProducts.length}, показано ${topProducts.length} найрелевантніших):\n`;

  for (const [category, items] of Object.entries(byCategory)) {
    context += `\n📁 ${category} (${items.length} товарів):\n`;
    for (const { product: p } of items) {
      const stock = p.stock > 0 ? `✅ ${p.stock} шт` : "❌ Немає";
      const promo = p.isPromo && p.promoPrice ? ` | 🔥 Акція: ${p.promoPrice} грн` : "";
      const desc = stripHtml(p.description || "").slice(0, 150);
      context += `  - ${p.name} | ${p.price} грн${promo} | ${stock} | ${desc}\n`;
    }
  }

  if (priceRange.min || priceRange.max) {
    context += `\nЦіновий фільтр: ${priceRange.min ? `від ${priceRange.min} грн` : ""}${priceRange.min && priceRange.max ? " " : ""}${priceRange.max ? `до ${priceRange.max} грн` : ""}\n`;
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
Ти розмовляєш українською мовою. Ти експерт з інструментів.

ГОЛОВНІ ПРАВИЛА:
1. Відповідай ТІЛЬКИ на основі наданих результатів пошуку — не вигадуй товари
2. Рекомендуй конкретні товари з каталогу з ТОЧНИМИ цінами та назвами
3. Завжди вказуй наявність на складі
4. Враховуй бюджет клієнта — якщо вказано ціновий діапазон, дотримуйся його
5. Якщо товар має акційну ціну — обов'язково зазнач це
6. Якщо нічого не знайдено — чесно скажи і запропонуй розширити пошук
7. Будь конкретним, уникай загальних фраз без прив'язки до товарів

СТРУКТУРА ВІДПОВІДІ (коли рекомендуєш товари):

1. Короткий вступ (1 речення)
2. Для кожного товару:
   ### 🥇/🥈/🥉 [Назва товару]
   - **Ціна:** X грн (якщо акція — вказати стару і нову ціну)
   - **Категорія:** назва
   - **Наявність:** X шт
   - **Ключові характеристики:** витягни з опису (потужність, розмір, матеріал тощо)
   - **Для кого:** коротко хто цільовий покупець
3. Порівняльна таблиця (якщо 2+ товари)
4. Фінальна рекомендація — який товар і чому обрати

ФОРМАТ ТАБЛИЦІ:
| Параметр | Товар 1 | Товар 2 | Товар 3 |
|---|---|---|---|
| Ціна | 1000 грн | 2000 грн | 3000 грн |
| Бренд | YATO | SIGMA | Makita |
| Наявність | ✅ 5 шт | ✅ 12 шт | ❌ Немає |
| Рекомендація | Для дому | Універсальний | Професійний |

ВАЖЛИВО:
- Не обрізай відповідь — завжди завершуй думку
- Якщо клієнт просить ТОП-3 — дай рівно 3 товари з повною інформацією
- Ціни бери ТІЛЬКИ з результатів пошуку, не округлюй і не вигадуй
- Використовуй emoji для наочності: ✅ ❌ ⚡ 🔧 💰
- Якщо товар поза бюджетом — позначай це явно
- ПОРІВНЮЙ ТІЛЬКИ однотипні товари! Результати пошуку згруповані по категоріях (📁). Порівнюй товари ТІЛЬКИ з однієї категорії. Наприклад, не порівнюй набір викруток з одиночною викруткою, дриль з болгаркою тощо
- Обирай для порівняння товари схожого призначення, розміру та цінової категорії
- Якщо рекомендуєш 2-3 товари — обов'язково додай порівняльну таблицю`,

    wizard: `Ти — AI-помічник з підбору інструментів BUDVIK.
Ти розмовляєш українською мовою. Ти експерт з інструментів.

КРИТИЧНЕ ПРАВИЛО: Рекомендуй ТІЛЬКИ реальні товари з розділу РЕЗУЛЬТАТИ ПОШУКУ.
НІКОЛИ не вигадуй назви, моделі чи ціни товарів. Якщо в результатах пошуку немає підходящих товарів — чесно скажи це.

Твоя задача — підібрати найкращі інструменти на основі:
1. Типу роботи
2. Частоти використання
3. Бюджету

СТРУКТУРА ВІДПОВІДІ:
1. Короткий вступ (що підібрав і чому)
2. Для кожного товару (3-5 штук):
   ### 🥇/🥈/🥉 [ТОЧНА назва з каталогу]
   - **Ціна:** точна ціна з результатів
   - **Наявність:** кількість на складі
   - **Переваги:** 2-3 пункти (витягни з характеристик)
   - **Недоліки:** 1-2 пункти
   - **Для кого:** цільова аудиторія
3. Порівняльна таблиця (markdown) — порівнюй ТІЛЬКИ однотипні товари з однієї категорії
4. Фінальна рекомендація з поясненням

ВАЖЛИВО: Порівнюй лише однотипні товари. Результати згруповані по категоріях (📁) — бери товари з однієї категорії.
Використовуй emoji: ✅ ❌ ⚡ 🔧 💰 🏠 🏗️`,

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
