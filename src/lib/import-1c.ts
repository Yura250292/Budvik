import { XMLParser } from "fast-xml-parser";

// ---- CommerceML XML Parser ----

export interface ParsedProduct {
  sku: string;
  name: string;
  description?: string;
  price?: number;
  stock?: number;
  category?: string;
  image?: string;
}

export interface ParsedCategory {
  id: string;
  name: string;
}

export interface CommerceMLResult {
  categories: ParsedCategory[];
  products: ParsedProduct[];
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export function parseCommerceML(xml: string): CommerceMLResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });
  const doc = parser.parse(xml);

  // YML (Yandex Market Language) format — used by many Ukrainian 1C exports
  if (doc["yml_catalog"]) {
    return parseYML(doc["yml_catalog"]);
  }

  const categories: ParsedCategory[] = [];
  const products: ParsedProduct[] = [];

  // Try to find catalog in КоммерческаяИнформация / КоммерческаяІнформація
  const root =
    doc["КоммерческаяИнформация"] ||
    doc["КоммерческаяІнформація"] ||
    doc["commerceml"] ||
    doc["CommerceInfo"] ||
    doc;

  // Parse categories (Группы / Категорії)
  const catalog = root["Каталог"] || root["Catalog"] || root;
  const groups =
    catalog["Группы"]?.["Группа"] ||
    catalog["Категорії"]?.["Категорія"] ||
    catalog["Groups"]?.["Group"] ||
    [];
  for (const g of ensureArray(groups)) {
    categories.push({
      id: g["Ид"] || g["Ід"] || g["Id"] || g["@_id"] || "",
      name: g["Наименование"] || g["Найменування"] || g["Name"] || g["@_name"] || "",
    });
  }

  // Parse products (Товары / Товари)
  const goods =
    catalog["Товары"]?.["Товар"] ||
    catalog["Товари"]?.["Товар"] ||
    catalog["Products"]?.["Product"] ||
    root["Товары"]?.["Товар"] ||
    root["Товари"]?.["Товар"] ||
    root["Products"]?.["Product"] ||
    [];

  for (const p of ensureArray(goods)) {
    const sku = p["Ид"] || p["Ід"] || p["Id"] || p["Артикул"] || p["SKU"] || p["@_id"] || "";
    const name = p["Наименование"] || p["Найменування"] || p["Name"] || p["@_name"] || "";
    const description = p["Описание"] || p["Опис"] || p["Description"] || "";

    // Price can be nested
    let price: number | undefined;
    const priceNode = p["Цены"]?.["Цена"] || p["Prices"]?.["Price"] || p["Цена"] || p["Ціна"] || p["Price"];
    if (priceNode) {
      const priceVal = Array.isArray(priceNode) ? priceNode[0] : priceNode;
      price = parseFloat(
        priceVal["ЦенаЗаЕдиницу"] || priceVal["PricePerUnit"] || priceVal["#text"] || priceVal
      );
    }

    // Stock
    let stock: number | undefined;
    const stockNode = p["Остатки"]?.["Остаток"] || p["Stocks"]?.["Stock"] || p["Количество"] || p["Кількість"] || p["Залишок"] || p["Quantity"];
    if (stockNode !== undefined) {
      const stockVal = Array.isArray(stockNode) ? stockNode[0] : stockNode;
      stock = parseInt(
        stockVal["Количество"] || stockVal["Quantity"] || stockVal["#text"] || stockVal,
        10
      );
    }

    // Category reference
    const categoryRef = p["Группы"]?.["Ид"] || p["Groups"]?.["Id"] || p["Категорія"] || p["КатегорияИд"] || "";

    products.push({
      sku: String(sku),
      name: String(name),
      description: description ? String(description) : undefined,
      price: isNaN(price as number) ? undefined : price,
      stock: isNaN(stock as number) ? undefined : stock,
      category: categoryRef ? String(categoryRef) : undefined,
    });
  }

  return { categories, products };
}

// ---- YML (Yandex Market Language) Parser ----

function parseYML(yml: any): CommerceMLResult {
  const categories: ParsedCategory[] = [];
  const products: ParsedProduct[] = [];

  const shop = yml["shop"] || yml;

  // Parse categories: <categories><category id="1">Name</category></categories>
  const cats = shop["categories"]?.["category"] || [];
  const categoryMap = new Map<string, string>();
  for (const c of ensureArray(cats)) {
    const id = String(c["@_id"] || "");
    const name = String(c["#text"] || c["@_name"] || c || "");
    if (id && name) {
      categories.push({ id, name });
      categoryMap.set(id, name);
    }
  }

  // Parse offers: <offers><offer id="123">...</offer></offers>
  const offers = shop["offers"]?.["offer"] || [];
  for (const o of ensureArray(offers)) {
    const sku = String(o["@_id"] || o["vendorCode"] || o["article"] || o["sku"] || "");
    const name = String(o["name"] || o["model"] || o["title"] || "");
    if (!sku || !name) continue;

    const description = o["description"] || "";
    const price = o["price"] !== undefined ? parseFloat(String(o["price"])) : undefined;
    const stock = o["stock"] !== undefined ? parseInt(String(o["stock"]), 10)
      : o["quantity"] !== undefined ? parseInt(String(o["quantity"]), 10)
      : o["@_available"] === "true" ? undefined
      : o["@_available"] === "false" ? 0
      : undefined;

    // Category — resolve name from categoryMap
    const catId = String(o["categoryId"] || "");
    const categoryName = categoryMap.get(catId) || catId || undefined;

    // Image
    const imgNode = o["picture"];
    const image = imgNode ? String(Array.isArray(imgNode) ? imgNode[0] : imgNode) : undefined;

    products.push({
      sku,
      name,
      description: description ? String(description) : undefined,
      price: price !== undefined && !isNaN(price) ? price : undefined,
      stock: stock !== undefined && !isNaN(stock) ? stock : undefined,
      category: categoryName,
      image,
    });
  }

  return { categories, products };
}

// ---- CSV Parser ----

export function parseCSV(csv: string): ParsedProduct[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"(.*)"$/, "$1").toLowerCase());

  const skuIdx = headers.findIndex((h) => ["sku", "артикул", "код", "id", "ід"].includes(h));
  const nameIdx = headers.findIndex((h) => ["name", "найменування", "наименование", "назва", "товар"].includes(h));
  const priceIdx = headers.findIndex((h) => ["price", "ціна", "цена"].includes(h));
  const stockIdx = headers.findIndex((h) => ["stock", "залишок", "остаток", "кількість", "количество"].includes(h));
  const descIdx = headers.findIndex((h) => ["description", "опис", "описание"].includes(h));
  const catIdx = headers.findIndex((h) => ["category", "категорія", "категория"].includes(h));

  if (skuIdx === -1 || nameIdx === -1) return [];

  const products: ParsedProduct[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line, sep);
    const sku = cols[skuIdx]?.trim();
    const name = cols[nameIdx]?.trim();
    if (!sku || !name) continue;

    products.push({
      sku,
      name,
      description: descIdx >= 0 ? cols[descIdx]?.trim() : undefined,
      price: priceIdx >= 0 ? parseFloat(cols[priceIdx]?.replace(",", ".").replace(/\s/g, "")) : undefined,
      stock: stockIdx >= 0 ? parseInt(cols[stockIdx]?.trim(), 10) : undefined,
      category: catIdx >= 0 ? cols[catIdx]?.trim() : undefined,
    });
  }

  return products;
}

function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ---- Slug generator ----

const translitMap: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye",
  ж: "zh", з: "z", и: "y", і: "i", ї: "yi", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "",
  ю: "yu", я: "ya", э: "e", ы: "y", ъ: "",
};

export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .map((ch) => translitMap[ch] || ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
