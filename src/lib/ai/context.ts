import { prisma } from "@/lib/prisma";
import { semanticSearch } from "@/lib/ai/embeddings";

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
  // Adjectives that are not product names
  "надійний", "надійна", "надійне", "надійну", "надійні", "надійного",
  "хороший", "хороша", "хороше", "хорошу", "хороші",
  "гарний", "гарна", "гарне", "гарну", "гарні",
  "якісний", "якісна", "якісне", "якісну", "якісні",
  "потужний", "потужна", "потужне", "потужну", "потужні",
  "дешевий", "дешева", "дешеве", "дешеву", "дешеві",
  "дорогий", "дорога", "дороге", "дорогу", "дорогі",
  "професійний", "професійна", "професійне", "професійну", "професійні",
  "домашній", "домашня", "домашнє", "домашню", "домашні",
  "нормальний", "нормальна", "нормальне", "нормальну", "нормальні",
  "порекомендуй", "порекомендуйте", "підбери", "підберіть",
  // Russian
  "что", "какой", "какая", "какие", "для", "или", "дай", "покажи",
  "лучший", "лучшие", "хочу", "нужно", "можно", "подскажи",
  "сколько", "стоит", "рублей", "тысяч",
]);

// Synonyms: user term → additional search terms to expand results
const SYNONYMS: Record<string, string[]> = {
  "болгарка": ["кшм", "кутова шліфмашина", "шліфмашина", "ушм"],
  "болгарку": ["кшм", "кутова шліфмашина", "шліфмашина", "ушм", "болгарка"],
  "болгарки": ["кшм", "кутова шліфмашина", "шліфмашина", "ушм", "болгарка"],
  "кшм": ["болгарка", "кутова шліфмашина", "шліфмашина"],
  "дриль": ["дрель", "шуруповерт", "дриль-шуруповерт"],
  "дрель": ["дриль", "шуруповерт", "дриль-шуруповерт"],
  "шуруповерт": ["дриль-шуруповерт", "дриль", "шурупокрут"],
  "перфоратор": ["перф", "бурхаммер"],
  "лобзик": ["електролобзик", "лобзікова пила"],
  "електролобзик": ["лобзик"],
  "пила": ["циркулярка", "циркулярна пила", "дискова пила", "торцювальна пила"],
  "циркулярка": ["циркулярна пила", "дискова пила", "пила"],
  "фрезер": ["фрезерна машина", "кромочний фрезер"],
  "рубанок": ["електрорубанок"],
  "електрорубанок": ["рубанок"],
  "шліфмашина": ["шліфмашинка", "болгарка", "кшм"],
  "фен": ["технічний фен", "будівельний фен", "термофен"],
  "степлер": ["будівельний степлер", "скобозабивач"],
  "краскопульт": ["пульверизатор", "фарборозпилювач"],
  "компресор": ["компресор повітряний"],
  "генератор": ["електрогенератор", "бензогенератор"],
  "зварювальний": ["зварювальний апарат", "зварка", "інвертор"],
  "зварка": ["зварювальний апарат", "зварювальний", "інвертор"],
};

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
  // Support "keyword query | natural language query" format
  // The part after | is used for semantic search for better intent understanding
  const parts = query.split("|").map((s) => s.trim());
  const keywordQuery = parts[0];
  const semanticQuery = parts[1] || parts[0]; // fallback to same query

  // Extract meaningful keywords, filtering stop words
  const keywords = keywordQuery
    .toLowerCase()
    .replace(/[^\wа-яіїєґ\s]/gi, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Expand with synonyms
  const expanded: string[] = [...keywords];
  for (const kw of keywords) {
    const syns = SYNONYMS[kw];
    if (syns) expanded.push(...syns);
  }

  // Deduplicate
  const unique = [...new Set(expanded)];

  if (unique.length === 0) return "";

  // Extract price range from query
  const priceRange = extractPriceRange(keywordQuery);

  // Build price filter
  const priceFilter: Record<string, number> = {};
  if (priceRange.min) priceFilter.gte = priceRange.min;
  if (priceRange.max) priceFilter.lte = priceRange.max;

  // Run keyword search AND semantic search in parallel
  const keywordSearchPromise = prisma.product.findMany({
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

  // Semantic search uses the natural language query for better intent understanding
  const semanticSearchPromise = semanticSearch(semanticQuery, 20).catch(() => [] as { productId: string; score: number }[]);

  const [keywordProducts, semanticResults] = await Promise.all([
    keywordSearchPromise,
    semanticSearchPromise,
  ]);

  // Fetch semantic search products
  let semanticProducts: typeof keywordProducts = [];
  const semanticScoreMap = new Map<string, number>();
  if (semanticResults.length > 0) {
    const relevant = semanticResults.filter((r) => r.score >= 0.55);
    if (relevant.length > 0) {
      for (const r of relevant) semanticScoreMap.set(r.productId, r.score);
      const semanticIds = relevant.map((r) => r.productId);
      semanticProducts = await prisma.product.findMany({
        where: {
          id: { in: semanticIds },
          isActive: true,
          ...(Object.keys(priceFilter).length > 0 ? { price: priceFilter } : {}),
        },
        include: { category: true },
      });
    }
  }

  // Merge keyword + semantic results (dedup by id)
  const seenIds = new Set<string>();
  const allProducts: typeof keywordProducts = [];
  // Add keyword results first
  for (const p of keywordProducts) {
    if (!seenIds.has(p.id)) {
      seenIds.add(p.id);
      allProducts.push(p);
    }
  }
  // Add semantic-only results
  for (const p of semanticProducts) {
    if (!seenIds.has(p.id)) {
      seenIds.add(p.id);
      allProducts.push(p);
    }
  }

  // If price-filtered search returned nothing, try without price filter
  let finalProducts = allProducts;
  if (allProducts.length === 0 && Object.keys(priceFilter).length > 0) {
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

  // Detect if user is asking for a TOOL (not an accessory)
  // Original keywords (before synonym expansion) determine user intent
  const toolKeywords = new Set([
    "болгарка", "болгарку", "болгарки", "кшм", "шліфмашина", "шліфмашину",
    "дриль", "дрель", "шуруповерт", "перфоратор",
    "лобзик", "електролобзик", "пила", "пилу", "циркулярка",
    "фрезер", "рубанок", "електрорубанок",
    "фен", "степлер", "краскопульт", "компресор", "генератор",
    "зварка", "зварювальний", "інвертор",
    "реноватор", "гайковерт", "міксер", "різак",
  ]);
  const userWantsTool = keywords.some((kw) => toolKeywords.has(kw));

  // Tool category whitelist — categories that contain actual power tools
  const toolCategoryPatterns = /болгарк|кшм|шліфмашин|дрил|перфоратор|шуруповерт|лобзик|пил[аиі]|фрезер|рубанок|фен|зварюв|компресор|генератор|електроінструмент|гайковерт|реноватор|повітродув|тример|кущоріз|секатор|відбійн/i;

  // Accessory indicators — check both category AND product name
  const accessoryCategoryPatterns = /круг|диск|щітк|свердл|біт[іи\s]|насад|коронк|бур[иі\s]|патрон|зачис|відріз|витратн|ріжуч|плашк|мітчик|зубил|чаша/i;
  const accessoryNamePatterns = /круг |диск |щітка|щітк[аи]|коронк|чаша |тримач кола|бур\s|свердл|полотн|ланцюг для|зірочка для|цанг|цанк|ролик для|фільтр для/i;

  // Determine if a product is an actual tool vs accessory/consumable
  function isActualTool(catName: string, productName: string): boolean {
    const cat = catName.toLowerCase();
    const name = productName.toLowerCase();
    // FIRST check accessory patterns — "Диски для болгарки" contains "болгарк" but is NOT a tool!
    if (accessoryCategoryPatterns.test(cat)) return false;
    if (accessoryNamePatterns.test(name)) return false;
    // Then check if category is a tool category
    if (toolCategoryPatterns.test(cat)) return true;
    // Default: not clearly a tool
    return false;
  }

  // Score products by relevance: keyword matches + semantic score bonus
  const scored = finalProducts.map((p) => {
    const nameLower = p.name.toLowerCase();
    const descLower = (p.description || "").toLowerCase();
    const catLower = p.category.name.toLowerCase();
    let score = 0;

    // Keyword matching — NAME match is worth much more than description match
    let nameMatch = false;
    let matchedKeywords = 0;
    for (const kw of unique) {
      let matched = false;
      if (nameLower.includes(kw)) { score += 10; matched = true; nameMatch = true; }
      if (catLower.includes(kw)) { score += 6; matched = true; }
      if (descLower.includes(kw)) { score += 1; matched = true; }
      if (matched) matchedKeywords++;
    }

    // Bonus for matching many keywords (product is more relevant)
    if (unique.length > 1 && matchedKeywords === unique.length) {
      score += 15;
    } else if (unique.length > 2 && matchedKeywords >= unique.length - 1) {
      score += 8;
    }

    // CRITICAL: When user asks for a TOOL, heavily boost actual tools and penalize accessories
    const isTool = isActualTool(p.category.name, p.name);
    if (userWantsTool) {
      if (isTool) {
        score += 50;
      } else {
        score -= 30;
      }
    }

    // Semantic relevance bonus (products AI considers similar to the query)
    const semanticScore = semanticScoreMap.get(p.id);
    if (semanticScore) {
      score += Math.round(semanticScore * 20); // 0.55-1.0 → 11-20 bonus points
    }

    // Heavily prioritize in-stock items
    if (p.stock > 0) score += 20;
    return { product: p, score, isTool };
  });

  // Sort by score descending, then by price
  scored.sort((a, b) => b.score - a.score || a.product.price - b.product.price);

  // When user wants a TOOL: separate tools from accessories, show tools first
  let topProducts: typeof scored;
  if (userWantsTool) {
    const tools = scored.filter((s) => s.isTool);
    const accessories = scored.filter((s) => !s.isTool);
    // Show ALL tools first, then max 3 accessories as supplement
    const toolsInStock = tools.filter((s) => s.product.stock > 0).slice(0, 20);
    const toolsOutOfStock = tools.filter((s) => s.product.stock <= 0).slice(0, 3);
    const accInStock = accessories.filter((s) => s.product.stock > 0).slice(0, 3);
    topProducts = [...toolsInStock, ...toolsOutOfStock, ...accInStock].slice(0, 25);
  } else {
    const inStock = scored.filter((s) => s.product.stock > 0).slice(0, 25);
    const outOfStock = scored.filter((s) => s.product.stock <= 0).slice(0, 5);
    topProducts = [...inStock, ...outOfStock].slice(0, 30);
  }

  // Group by category for better AI understanding
  const byCategory: Record<string, typeof topProducts> = {};
  for (const item of topProducts) {
    const cat = item.product.category.name;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  }

  let context = `\nРЕЗУЛЬТАТИ ПОШУКУ (знайдено ${finalProducts.length}, показано ${topProducts.length} найрелевантніших):\n`;
  context += `УВАГА: Використовуй ТІЛЬКИ товари з цього списку. Копіюй назви ТОЧНО як написано.\n`;
  context += `ВАЖЛИВО: Рекомендуй ТІЛЬКИ товари з позначкою ✅ (в наявності). Товари з ❌ (немає) — НЕ рекомендуй, якщо є альтернативи в наявності.\n`;
  if (userWantsTool) {
    context += `⚡ КЛІЄНТ ШУКАЄ ІНСТРУМЕНТ — рекомендуй ІНСТРУМЕНТИ (позначені 🔧), а НЕ витратні матеріали (позначені 🔩)!\n`;
  }

  for (const [category, items] of Object.entries(byCategory)) {
    context += `\n📁 ${category} (${items.length} товарів):\n`;
    for (const { product: p } of items) {
      const stock = p.stock > 0 ? `✅ ${p.stock} шт` : "❌ Немає";
      const promo = p.isPromo && p.promoPrice ? ` | 🔥 Акція: ${p.promoPrice} грн` : "";
      const desc = stripHtml(p.description || "").slice(0, 150);
      const itemIsTool = isActualTool(p.category.name, p.name);
      const typeTag = userWantsTool ? (itemIsTool ? "🔧" : "🔩") : "";
      context += `  - ${typeTag}[ID:${p.id.slice(-8)}] ${p.name} | ${p.price} грн${promo} | ${stock} | ${desc}\n`;
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
    consultant: `Ти — Вікінг, AI-консультант інтернет-магазину інструментів та будівельних матеріалів BUDVIK.
Ти розмовляєш українською мовою. Ти СПРАВЖНІЙ ЕКСПЕРТ з інструментів з багаторічним досвідом.

ХТО ТИ:
Ти — досвідчений консультант який ЗНАЄ інструменти, бренди, їх характеристики, призначення та відмінності. Ти працюєш з реальною базою товарів магазину BUDVIK і допомагаєш клієнтам:
- Обрати правильний інструмент під задачу
- Порівняти моделі та бренди
- Пояснити характеристики (потужність, обороти, діаметр, тип патрона тощо)
- Порадити аксесуари та витратні матеріали
- Відповісти на будь-яке питання про інструменти та їх використання

СТИЛЬ СПІЛКУВАННЯ:
- Дружній, впевнений, як досвідчений продавець в магазині
- Говори просто і зрозуміло, без канцеляризмів
- Можеш жартувати в тему, але завжди по суті
- Звертайся на "ти" як до друга

СТРАТЕГІЯ ВІДПОВІДІ:
1. ЗАВЖДИ починай з корисної поради/відповіді (не з "на жаль не знайшов")
2. Якщо клієнт питає про інструмент — рекомендуй 2-3 КОНКРЕТНІ моделі з результатів пошуку
3. Якщо питають "що краще" — дай ЕКСПЕРТНЕ порівняння з реальними аргументами
4. Якщо питають про характеристики — поясни як експерт
5. Питання про використання інструменту — дай практичну пораду
6. Максимум 1 уточнююче питання, і ТІЛЬКИ якщо запит зовсім незрозумілий

ПРІОРИТЕТ ТОВАРІВ:
- Електроінструменти (болгарки, дрилі, шуруповерти, пили) — ГОЛОВНИЙ пріоритет
- НЕ рекомендуй вугільні щітки, диски, окуляри замість самого інструменту
- Аксесуари — тільки як ДОДАТОК до основного інструменту, або якщо клієнт прямо просить
- Якщо є і інструмент і витратники — рекомендуй ІНСТРУМЕНТ

ФОРМАТ (до 300 слів):
1. Експертна порада (2-4 речення — чому саме цей інструмент, на що звернути увагу)
2. Рекомендації: **Назва** — ціна, наявність, ключова перевага
3. Висновок або коротка рекомендація

ПРАВИЛА РОБОТИ З ТОВАРАМИ:
- Рекомендуй ТІЛЬКИ товари з розділу РЕЗУЛЬТАТИ ПОШУКУ
- Копіюй назви ТОЧНО як написано в результатах
- Завжди вказуй ціну та наявність
- НЕ рекомендуй товари з ❌ (немає в наявності) якщо є альтернативи з ✅
- Акційні товари — зазначай акцію

КРИТИЧНО — БЛОК ТОВАРІВ:
В САМОМУ КІНЦІ відповіді ОБОВ'ЯЗКОВО додай (інакше картки НЕ з'являться):
\`\`\`products
Точна Назва Товару 1
Точна Назва Товару 2
\`\`\`
Назви копіюй СИМВОЛ-В-СИМВОЛ з результатів пошуку.

ЯКЩО ТОВАР НЕ ЗНАЙДЕНО:
- НЕ кажи "нічого не знайшов" і не здавайся
- Дай ЕКСПЕРТНУ пораду по темі питання (характеристики, на що звертати увагу)
- Порадь звернутися до менеджера для підбору конкретної моделі
- Запропонуй подивитися суміжні категорії якщо є щось схоже

ЗАБОРОНЕНО:
- Вигадувати товари/ціни яких немає в результатах
- Рекомендувати витратники замість інструменту
- Здаватися і казати "не знайшов" якщо є хоч щось релевантне
- Ігнорувати питання — на БУДЬ-ЯКЕ питання про інструменти давай корисну відповідь`,

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
- Додавати моделі яких немає в нашому магазині
- Рекомендувати товари яких НЕМАЄ В НАЯВНОСТІ (❌), якщо є альтернативи в наявності (✅)`,

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
