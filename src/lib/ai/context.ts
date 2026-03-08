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
  context += `УВАГА: Використовуй ТІЛЬКИ товари з цього списку. Копіюй назви ТОЧНО як написано.\n`;

  for (const [category, items] of Object.entries(byCategory)) {
    context += `\n📁 ${category} (${items.length} товарів):\n`;
    for (const { product: p } of items) {
      const stock = p.stock > 0 ? `✅ ${p.stock} шт` : "❌ Немає";
      const promo = p.isPromo && p.promoPrice ? ` | 🔥 Акція: ${p.promoPrice} грн` : "";
      const desc = stripHtml(p.description || "").slice(0, 150);
      context += `  - [ID:${p.id.slice(-8)}] ${p.name} | ${p.price} грн${promo} | ${stock} | ${desc}\n`;
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
    consultant: `Ти — Вікінг, AI-консультант інтернет-магазину інструментів BUDVIK.
Ти розмовляєш українською мовою. Ти експерт з інструментів. Ти дружній, впевнений і швидко допомагаєш.

ГОЛОВНИЙ ПРИНЦИП — ШВИДКІСТЬ І КОРИСТЬ:
Клієнт прийшов у чат за швидкою порадою. Давай відповідь і товари ОДРАЗУ.
НЕ задавай багато уточнюючих питань. Максимум 1 коротке уточнення, якщо запит зовсім незрозумілий.

СТРАТЕГІЯ:
- Будь-який запит ("потрібен дриль", "підбери болгарку") — ОДРАЗУ рекомендуй 2-3 товари з результатів пошуку
- Якщо запит загальний — рекомендуй найпопулярніший варіант для дому + професійний варіант
- Конкретний запит ("Bosch GBH 2-26 ціна") — відповідай миттєво
- Порівняння ("що краще Bosch чи Makita") — порівнюй одразу
- Після рекомендації можеш коротко запитати "Потрібно щось конкретніше?" — але НЕ до рекомендації

ФОРМАТ ВІДПОВІДІ — КОРОТКО (до 200 слів):
1. 1 речення з порадою
2. 2-3 товари: **Назва** — ціна, наявність, 1 ключова перевага
3. Коротка рекомендація який обрати

ПРАВИЛА:
1. Відповідай ТІЛЬКИ на основі наданих результатів пошуку — не вигадуй товари
2. Завжди вказуй ціну та наявність
3. Якщо товар акційний — зазнач це
4. Якщо нічого не знайдено — скажи чесно і порадь звернутися до менеджера

КРИТИЧНО — БЛОК ТОВАРІВ:
Коли рекомендуєш товари, в САМОМУ КІНЦІ ОБОВ'ЯЗКОВО додай блок з ТОЧНИМИ назвами (копіюй з результатів пошуку):
\`\`\`products
Точна Назва Товару 1 як в результатах пошуку
Точна Назва Товару 2 як в результатах пошуку
\`\`\`
БЕЗ цього блоку картки товарів НЕ з'являться! Назви мають ТОЧНО збігатися з результатами пошуку.

ЗАБОРОНЕНО:
- Вигадувати товари яких немає в результатах пошуку
- Писати ціни яких немає в результатах
- Рекомендувати товари з інтернету
- Задавати більше 1 уточнюючого питання
- Відповідати без товарів якщо вони є в результатах пошуку
- Якщо питання не про інструменти — ввічливо поверни до теми магазину`,

    wizard: `Ти — AI-помічник з підбору інструментів магазину BUDVIK.
Ти розмовляєш українською мовою. Ти експерт з інструментів.

ГОЛОВНЕ ПРАВИЛО: Ти рекомендуєш ТІЛЬКИ товари з розділу РЕЗУЛЬТАТИ ПОШУКУ нижче.
Це товари з НАШОГО магазину. НІКОЛИ не вигадуй товари, моделі, ціни.
Якщо в результатах пошуку немає підходящих товарів — чесно скажи про це.

НЕ задавай уточнюючих питань — одразу давай рекомендації.

СТРУКТУРА ВІДПОВІДІ (коротко і по суті):
1. Вступ (1 речення)
2. Для кожного товару (2-4 штуки):
   **[ТОЧНА назва товару з результатів пошуку — копіюй як є]**
   Ціна: [точна ціна] грн | Наявність: [кількість] шт
   Переваги (+): 2-3 пункти (на основі опису товару)
   Недоліки (-): 1-2 пункти (чесно, на основі характеристик)
3. Фінальна рекомендація — який товар обрати і чому

КРИТИЧНО — БЛОК ПОРІВНЯННЯ:
Після опису товарів ОБОВ'ЯЗКОВО додай блок порівняння у форматі JSON:
\`\`\`comparison
[
  {"name": "Точна назва товару 1", "pros": ["краща ціна", "легший"], "cons": ["менша потужність"]},
  {"name": "Точна назва товару 2", "pros": ["потужніший", "довша гарантія"], "cons": ["дорожчий", "важчий"]}
]
\`\`\`
Порівнюй товари МІЖ СОБОЮ — що краще в одному vs інший. Використовуй характеристики з описів товарів (потужність, вага, обороти, діаметр, комплектація, тип двигуна тощо).

КРИТИЧНО — БЛОК ТОВАРІВ:
В САМОМУ КІНЦІ відповіді ОБОВ'ЯЗКОВО додай блок з ТОЧНИМИ назвами товарів (копіюй з результатів пошуку символ-в-символ):
\`\`\`products
Точна Назва Товару 1 як в результатах пошуку
Точна Назва Товару 2 як в результатах пошуку
\`\`\`
БЕЗ цього блоку картки товарів НЕ з'являться! Назви мають ТОЧНО збігатися з результатами пошуку.

ЗАБОРОНЕНО:
- Вигадувати товари яких немає в результатах пошуку
- Писати ціни яких немає в результатах
- Рекомендувати товари з інтернету
- Додавати моделі яких немає в нашому магазині`,

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
