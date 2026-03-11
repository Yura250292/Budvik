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
      : o["@_available"] === "true" ? 1
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

// ---- ERP Import Parsers ----

export interface ParsedCounterparty {
  code: string;
  name: string;
  type?: "SUPPLIER" | "CUSTOMER" | "BOTH";
  phone?: string;
  email?: string;
  address?: string;
  contactPerson?: string;
}

export interface ParsedPurchaseDocument {
  number: string;
  date: string;
  supplierCode: string;
  items: { sku: string; quantity: number; purchasePrice: number }[];
  notes?: string;
}

export interface ParsedSalesDocumentImport {
  number: string;
  date: string;
  customerCode?: string;
  items: { sku: string; quantity: number; sellingPrice: number; purchasePrice?: number }[];
  notes?: string;
}

export function parseCounterpartiesXML(xml: string): ParsedCounterparty[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });
  const doc = parser.parse(xml);
  const result: ParsedCounterparty[] = [];

  // Try common 1C structures
  const root = doc["КоммерческаяИнформация"] || doc["КоммерческаяІнформація"] || doc;
  const agents =
    root["Контрагенты"]?.["Контрагент"] ||
    root["Контрагенти"]?.["Контрагент"] ||
    root["Counterparties"]?.["Counterparty"] ||
    root["counterparties"]?.["counterparty"] ||
    [];

  for (const a of ensureArray(agents)) {
    const code = String(a["Ид"] || a["Ід"] || a["Код"] || a["Code"] || a["ЕДРПОУ"] || a["ЄДРПОУ"] || a["@_id"] || "");
    const name = String(a["Наименование"] || a["Найменування"] || a["Name"] || a["@_name"] || "");
    if (!code || !name) continue;

    const typeStr = String(a["Тип"] || a["Type"] || "").toUpperCase();
    let type: "SUPPLIER" | "CUSTOMER" | "BOTH" = "BOTH";
    if (typeStr.includes("ПОСТАЧ") || typeStr.includes("SUPPLIER")) type = "SUPPLIER";
    else if (typeStr.includes("ПОКУП") || typeStr.includes("CUSTOMER") || typeStr.includes("КЛІЄНТ")) type = "CUSTOMER";

    result.push({
      code,
      name,
      type,
      phone: a["Телефон"] || a["Phone"] || undefined,
      email: a["Email"] || a["Пошта"] || undefined,
      address: a["Адрес"] || a["Адреса"] || a["Address"] || undefined,
      contactPerson: a["КонтактнаОсоба"] || a["КонтактноеЛицо"] || a["ContactPerson"] || undefined,
    });
  }

  return result;
}

export function parseCounterpartiesCSV(csv: string): ParsedCounterparty[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"(.*)"$/, "$1").toLowerCase());

  const codeIdx = headers.findIndex((h) => ["код", "code", "єдрпоу", "едрпоу", "id", "ід"].includes(h));
  const nameIdx = headers.findIndex((h) => ["назва", "наименование", "найменування", "name", "counterparty_name", "full_name"].includes(h));
  const typeIdx = headers.findIndex((h) => ["тип", "type"].includes(h));
  const phoneIdx = headers.findIndex((h) => ["телефон", "phone"].includes(h));
  const emailIdx = headers.findIndex((h) => ["email", "пошта", "e-mail"].includes(h));
  const addressIdx = headers.findIndex((h) => ["адреса", "адрес", "address"].includes(h));
  const contactIdx = headers.findIndex((h) => ["контакт", "контактна особа", "contactperson"].includes(h));

  // Support single-column format (just name, no code)
  if (nameIdx === -1) return [];

  const result: ParsedCounterparty[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line, sep);
    const name = cols[nameIdx]?.trim();
    if (!name || name.length < 3) continue;

    // Auto-generate code if not present
    const code = codeIdx >= 0 ? cols[codeIdx]?.trim() : undefined;
    const autoCode = code || `1C-${String(i).padStart(4, "0")}`;

    let type: "SUPPLIER" | "CUSTOMER" | "BOTH" = "BOTH";
    if (typeIdx >= 0) {
      const t = (cols[typeIdx] || "").toUpperCase();
      if (t.includes("ПОСТАЧ") || t.includes("SUPPLIER")) type = "SUPPLIER";
      else if (t.includes("ПОКУП") || t.includes("CUSTOMER")) type = "CUSTOMER";
    }

    result.push({
      code: autoCode,
      name,
      type,
      phone: phoneIdx >= 0 ? cols[phoneIdx]?.trim() || undefined : undefined,
      email: emailIdx >= 0 ? cols[emailIdx]?.trim() || undefined : undefined,
      address: addressIdx >= 0 ? cols[addressIdx]?.trim() || undefined : undefined,
      contactPerson: contactIdx >= 0 ? cols[contactIdx]?.trim() || undefined : undefined,
    });
  }

  return result;
}

export function parsePurchaseDocumentsXML(xml: string): ParsedPurchaseDocument[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });
  const doc = parser.parse(xml);
  const result: ParsedPurchaseDocument[] = [];

  const root = doc["КоммерческаяИнформация"] || doc["КоммерческаяІнформація"] || doc;
  const documents =
    root["Документы"]?.["Документ"] ||
    root["Документи"]?.["Документ"] ||
    root["Documents"]?.["Document"] ||
    [];

  for (const d of ensureArray(documents)) {
    const number = String(d["Номер"] || d["Number"] || d["@_number"] || "");
    const date = String(d["Дата"] || d["Date"] || d["@_date"] || "");
    const supplierCode = String(d["КонтрагентИд"] || d["КонтрагентІд"] || d["CounterpartyCode"] || d["Контрагент"]?.["Ид"] || "");

    const itemsRaw = d["Товары"]?.["Товар"] || d["Товари"]?.["Товар"] || d["Items"]?.["Item"] || [];
    const items = ensureArray(itemsRaw).map((item: any) => ({
      sku: String(item["Артикул"] || item["Ід"] || item["Ид"] || item["SKU"] || ""),
      quantity: parseInt(String(item["Кількість"] || item["Количество"] || item["Quantity"] || "0"), 10),
      purchasePrice: parseFloat(String(item["Ціна"] || item["Цена"] || item["Price"] || "0").replace(",", ".")),
    })).filter((i) => i.sku && i.quantity > 0);

    if (number && items.length > 0) {
      result.push({ number, date, supplierCode, items, notes: d["Коментар"] || d["Комментарий"] || undefined });
    }
  }

  return result;
}

export function parseSalesDocumentsXML(xml: string): ParsedSalesDocumentImport[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });
  const doc = parser.parse(xml);
  const result: ParsedSalesDocumentImport[] = [];

  const root = doc["КоммерческаяИнформация"] || doc["КоммерческаяІнформація"] || doc;
  const documents =
    root["Документы"]?.["Документ"] ||
    root["Документи"]?.["Документ"] ||
    root["Documents"]?.["Document"] ||
    [];

  for (const d of ensureArray(documents)) {
    const number = String(d["Номер"] || d["Number"] || d["@_number"] || "");
    const date = String(d["Дата"] || d["Date"] || d["@_date"] || "");
    const customerCode = String(d["КонтрагентИд"] || d["КонтрагентІд"] || d["CounterpartyCode"] || d["Контрагент"]?.["Ид"] || "");

    const itemsRaw = d["Товары"]?.["Товар"] || d["Товари"]?.["Товар"] || d["Items"]?.["Item"] || [];
    const items = ensureArray(itemsRaw).map((item: any) => ({
      sku: String(item["Артикул"] || item["Ід"] || item["Ид"] || item["SKU"] || ""),
      quantity: parseInt(String(item["Кількість"] || item["Количество"] || item["Quantity"] || "0"), 10),
      sellingPrice: parseFloat(String(item["Ціна"] || item["Цена"] || item["Price"] || "0").replace(",", ".")),
      purchasePrice: item["Собівартість"] || item["Себестоимость"] || item["Cost"]
        ? parseFloat(String(item["Собівартість"] || item["Себестоимость"] || item["Cost"]).replace(",", "."))
        : undefined,
    })).filter((i) => i.sku && i.quantity > 0);

    if (number && items.length > 0) {
      result.push({ number, date, customerCode: customerCode || undefined, items, notes: d["Коментар"] || d["Комментарий"] || undefined });
    }
  }

  return result;
}

// ---- CSV Document Parsers ----

export function parsePurchaseDocumentsCSV(csv: string): ParsedPurchaseDocument[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"(.*)"$/, "$1").toLowerCase());

  const numIdx = headers.findIndex((h) => ["doc_number", "номер", "number", "№"].includes(h));
  const dateIdx = headers.findIndex((h) => ["date", "дата"].includes(h));
  const counterpartyIdx = headers.findIndex((h) => ["counterparty", "контрагент", "постачальник", "supplier"].includes(h));
  const productIdx = headers.findIndex((h) => ["product_name", "товар", "назва", "name"].includes(h));
  const skuIdx = headers.findIndex((h) => ["sku", "артикул", "код"].includes(h));
  const qtyIdx = headers.findIndex((h) => ["quantity", "кількість", "количество", "к-сть"].includes(h));
  const amountIdx = headers.findIndex((h) => ["amount", "сума", "сумма", "price", "ціна"].includes(h));

  if (numIdx === -1) return [];

  // Group rows by doc_number into documents
  const docMap = new Map<string, ParsedPurchaseDocument>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line, sep);
    const docNumber = cols[numIdx]?.trim().replace(/^"(.*)"$/, "$1");
    if (!docNumber) continue;

    if (!docMap.has(docNumber)) {
      const date = dateIdx >= 0 ? cols[dateIdx]?.trim().replace(/^"(.*)"$/, "$1") : "";
      const counterparty = counterpartyIdx >= 0 ? cols[counterpartyIdx]?.trim().replace(/^"(.*)"$/, "$1") : "";
      docMap.set(docNumber, {
        number: docNumber,
        date: parseDate1C(date),
        supplierCode: counterparty,
        items: [],
      });
    }

    const doc = docMap.get(docNumber)!;
    const sku = skuIdx >= 0 ? cols[skuIdx]?.trim().replace(/^"(.*)"$/, "$1") : "";
    const qty = qtyIdx >= 0 ? parseInt(cols[qtyIdx]?.replace(/\s/g, ""), 10) : 0;
    const amount = amountIdx >= 0 ? parseFloat(cols[amountIdx]?.replace(",", ".").replace(/\s/g, "")) : 0;
    const purchasePrice = qty > 0 ? amount / qty : amount;

    if (sku && qty > 0) {
      doc.items.push({ sku, quantity: qty, purchasePrice: Math.round(purchasePrice * 100) / 100 });
    }
  }

  return Array.from(docMap.values()).filter((d) => d.items.length > 0);
}

export function parseSalesDocumentsCSV(csv: string): ParsedSalesDocumentImport[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"(.*)"$/, "$1").toLowerCase());

  const numIdx = headers.findIndex((h) => ["doc_number", "номер", "number", "№"].includes(h));
  const dateIdx = headers.findIndex((h) => ["date", "дата"].includes(h));
  const counterpartyIdx = headers.findIndex((h) => ["counterparty", "контрагент", "покупець", "customer", "клієнт"].includes(h));
  const productNameIdx = headers.findIndex((h) => ["product_name", "товар", "назва", "name"].includes(h));
  const skuIdx = headers.findIndex((h) => ["sku", "артикул", "код"].includes(h));
  const qtyIdx = headers.findIndex((h) => ["quantity", "кількість", "количество", "к-сть"].includes(h));
  const amountIdx = headers.findIndex((h) => ["amount", "сума", "сумма"].includes(h));
  // selling_price = per-unit price (no need to divide by qty)
  const sellingPriceIdx = headers.findIndex((h) => ["selling_price", "ціна_продажу", "price", "ціна"].includes(h));

  if (numIdx === -1) return [];

  const docMap = new Map<string, ParsedSalesDocumentImport>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line, sep);
    const docNumber = cols[numIdx]?.trim().replace(/^"(.*)"$/, "$1");
    if (!docNumber) continue;

    if (!docMap.has(docNumber)) {
      const date = dateIdx >= 0 ? cols[dateIdx]?.trim().replace(/^"(.*)"$/, "$1") : "";
      const counterparty = counterpartyIdx >= 0 ? cols[counterpartyIdx]?.trim().replace(/^"(.*)"$/, "$1") : "";
      docMap.set(docNumber, {
        number: docNumber,
        date: parseDate1C(date),
        customerCode: counterparty || undefined,
        items: [],
      });
    }

    const doc = docMap.get(docNumber)!;
    const sku = skuIdx >= 0 ? cols[skuIdx]?.trim().replace(/^"(.*)"$/, "$1") : "";
    const productName = productNameIdx >= 0 ? cols[productNameIdx]?.trim().replace(/^"(.*)"$/, "$1") : "";
    const qty = qtyIdx >= 0 ? parseInt(cols[qtyIdx]?.replace(/\s/g, ""), 10) : 0;

    let sellingPrice = 0;
    if (sellingPriceIdx >= 0) {
      // Per-unit price — use directly
      sellingPrice = parseFloat(cols[sellingPriceIdx]?.replace(",", ".").replace(/\s/g, "")) || 0;
    } else if (amountIdx >= 0) {
      // Total amount — divide by qty
      const amount = parseFloat(cols[amountIdx]?.replace(",", ".").replace(/\s/g, "")) || 0;
      sellingPrice = qty > 0 ? amount / qty : amount;
    }

    // Use SKU if available, otherwise fall back to product name for matching
    const itemKey = sku || productName;
    if (itemKey && qty > 0) {
      doc.items.push({ sku: itemKey, quantity: qty, sellingPrice: Math.round(sellingPrice * 100) / 100 });
    }
  }

  return Array.from(docMap.values()).filter((d) => d.items.length > 0);
}

// Parse 1C date format "02.03.2026 13:57:57" → "2026-03-02"
function parseDate1C(dateStr: string): string {
  if (!dateStr) return "";
  const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return dateStr;
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
