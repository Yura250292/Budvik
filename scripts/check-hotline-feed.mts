/**
 * Перевірка товарного фіду Hotline. READ ONLY: лише SELECT по базі сайту.
 *
 * Запуск: npx tsx --env-file=.env scripts/check-hotline-feed.mts
 *
 * Дві половини: чисті правила збирання XML (екранування, межі полів,
 * стабільність ідентифікаторів) і реальний склад фіду з бази — бо помилка
 * у відборі коштує грошей: Hotline бере 7,5 грн за КОЖЕН перехід, і зайвий
 * дешевий товар у фіді — це гарантований мінус.
 */

import {
  HOTLINE,
  feedItemId,
  categoryId,
  buildHotlineXml,
  loadHotlineFeed,
  type FeedItem,
  type FeedCategory,
} from "../src/lib/feeds/hotline";

let failed = 0;

function ok(name: string, condition: boolean, detail = "") {
  if (!condition) failed++;
  console.log(`${condition ? "✅" : "❌"} ${name}${condition || !detail ? "" : `\n   ${detail}`}`);
}

console.log("Ідентифікатори\n");

const id = feedItemId("cmf1a2b3c4d5e6f7g8h9i0jk");
ok("id товару ≤ 20 символів", id.length <= 20, `маємо ${id.length}: ${id}`);
ok("id товару стабільний", id === feedItemId("cmf1a2b3c4d5e6f7g8h9i0jk"));
ok("різні товари — різні id", feedItemId("a") !== feedItemId("b"));
ok(
  "id категорії — додатне ціле",
  Number.isInteger(categoryId("s:elektro")) && categoryId("s:elektro") > 0
);
ok("id категорії стабільний", categoryId("t:шуруповерт") === categoryId("t:шуруповерт"));
ok("розділ і тип не збігаються", categoryId("s:elektro") !== categoryId("t:elektro"));

console.log("\nЗбирання XML\n");

const xml = buildHotlineXml(
  [
    {
      id: "abc",
      categoryId: 42,
      code: 'ША 3420*4 "R"',
      barcode: "4820000000001",
      vendor: "APRO",
      name: "Дриль ударний <тест> & Co",
      description: "Опис із <b>розміткою</b> та 'лапками'",
      url: "https://www.budvik27.com/catalog/dryl?utm_source=hotline",
      image: "https://cdn.example/1.jpg",
      price: 2499.5,
    },
  ],
  [{ id: 42, parentId: null, name: "Електроінструмент" }],
  { date: "2026-09-22 10:00", firmId: null }
);

ok("немає сирих кутових дужок у назві", !xml.includes("<тест>"));
ok("амперсанд екранований", xml.includes("&amp;"));
ok("лапки в артикулі екрановані", xml.includes("&quot;"));
ok("ціна з копійками, без розділювачів розрядів", xml.includes("<priceRUAH>2499.50</priceRUAH>"));
ok("наявність одним значенням", xml.includes("<stock>В наявності</stock>"));
ok("оплата при отриманні", xml.includes('payment type="cash-on-delivery"'));
ok("гарантію не вигадуємо", !xml.includes("<guarantee"));
ok("корінь price", xml.trimStart().startsWith("<?xml") && xml.includes("<price>"));
ok("штрихкод потрапив", xml.includes("<barcode>4820000000001</barcode>"));

const noBarcode = buildHotlineXml(
  [
    {
      id: "abc",
      categoryId: 42,
      code: "X1",
      barcode: null,
      vendor: "APRO",
      name: "Товар",
      description: "Опис",
      url: "https://www.budvik27.com/catalog/x",
      image: "https://cdn.example/1.jpg",
      price: 3000,
    },
  ],
  [{ id: 42, parentId: null, name: "Електроінструмент" }],
  { date: "2026-09-22 10:00", firmId: "777" }
);
ok("без штрихкоду — без порожнього тега", !noBarcode.includes("<barcode>"));
ok("номер магазину потрапляє в шапку", noBarcode.includes("<firmId>777</firmId>"));

console.log("\nСклад фіду з бази\n");

const { items, categories }: { items: FeedItem[]; categories: FeedCategory[] } =
  await loadHotlineFeed();
console.log(`   У фіді ${items.length} товарів і ${categories.length} категорій.\n`);

ok("фід не порожній", items.length > 0);
ok(
  "усі дорожчі за поріг",
  items.every((i) => i.price >= HOTLINE.minPrice),
  `найдешевший: ${Math.min(...items.map((i) => i.price))}`
);
ok("у кожного є артикул", items.every((i) => i.code.trim().length > 0));
ok("у кожного є бренд", items.every((i) => i.vendor.trim().length > 0));
ok("немає сурогатних артикулів 1С", items.every((i) => !i.code.startsWith("1C-")));
ok("id унікальні", new Set(items.map((i) => i.id)).size === items.length);
ok("усі id ≤ 20 символів", items.every((i) => i.id.length <= 20));
ok("у кожного є фото", items.every((i) => i.image.length > 0));
ok(
  "кожен товар має свою категорію",
  items.every((i) => categories.some((c) => c.id === i.categoryId))
);
ok("посилання з міткою hotline", items.every((i) => i.url.includes("utm_source=hotline")));
ok("посилання на наш сайт по https", items.every((i) => i.url.startsWith("https://www.budvik27.com/")));
ok(
  "категорії-листи мають батька",
  categories.filter((c) => c.parentId).every((c) => categories.some((p) => p.id === c.parentId))
);

console.log("\nЩо саме поїде (перші 5):");
for (const i of items.slice(0, 5)) {
  const cat = categories.find((c) => c.id === i.categoryId);
  console.log(`   ${i.code} · ${i.vendor} · ${i.price} ₴ · ${cat?.name ?? "?"} · ${i.name.slice(0, 50)}`);
}

console.log(failed === 0 ? "\nУсе гаразд." : `\nПомилок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
