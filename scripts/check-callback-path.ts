/**
 * Куди повертає вхід — без мережі й бази.
 *
 * Запуск: npx tsx scripts/check-callback-path.ts
 *
 * callbackPath стоїть на двох речах одразу, і обидві ламаються тихо.
 *
 * Перша — повернення. Коли людину відсіває middleware, посилання на вхід
 * складає next-auth, і callbackUrl там завжди повна адреса, а не шлях.
 * Поки помічник її не приймав, торговий після входу опинявся на показниках
 * замість каталогу, куди йшов. Помилка не видно: людина ж увійшла.
 *
 * Друга — відкритий редірект. Той самий параметр приходить із рядка адреси,
 * тож будь-яке послаблення перевірки означає, що з нашої сторінки входу
 * можна відправити людину на чужий сайт. Тому чужий origin, протокол-
 * відносний `//evil.com`, javascript: і сусідній домен-приманка перевіряються
 * окремими випадками.
 *
 * Третє, менш очевидне: сміття в параметрі мусить давати null, а не шлях.
 * Перша версія помічника розкривала `new URL(raw, origin)` і перетворювала
 * `?callbackUrl=abc` на «/abc» — вхід вів на 404 замість домівки за роллю.
 */

import { callbackPath, safeRelativePath } from "../src/lib/utils";

const ORIGIN = "https://www.budvik27.com";

// callbackPath звіряє походження з адресою сторінки, а не з константою:
// сайт відповідає і на apex, і на www.
(globalThis as unknown as { window: unknown }).window = { location: { origin: ORIGIN } };

let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

const cases: { input: string | null; want: string | null; why: string }[] = [
  // Заради чого писалося: повна адреса свого ж сайту від next-auth.
  { input: `${ORIGIN}/sales/catalog`, want: "/sales/catalog", why: "повна адреса свого сайту" },
  {
    input: `${ORIGIN}/sales/catalog/list?section=malyarnyi`,
    want: "/sales/catalog/list?section=malyarnyi",
    why: "разом із рядком запиту",
  },
  { input: `${ORIGIN}/catalog#top`, want: "/catalog#top", why: "разом із якорем" },

  // Старе поводження не мало змінитися.
  { input: "/cart", want: "/cart", why: "звичайний шлях" },
  { input: "/sales/catalog?a=1", want: "/sales/catalog?a=1", why: "шлях із запитом" },

  // Відкритий редірект.
  { input: "https://evil.com/x", want: null, why: "чужий домен" },
  { input: "//evil.com/x", want: null, why: "протокол-відносний" },
  { input: `${ORIGIN}.evil.com/x`, want: null, why: "домен-приманка" },
  { input: "javascript:alert(1)", want: null, why: "javascript:" },
  { input: "http://www.budvik27.com/sales", want: null, why: "інша схема" },
  { input: "https://budvik27.com/sales", want: null, why: "apex ≠ www" },

  // Сміття веде на домівку за роллю, а не на 404.
  { input: "not a url", want: null, why: "не адреса" },
  { input: "abc", want: null, why: "не адреса, без пробілів" },
  { input: "", want: null, why: "порожньо" },
  { input: null, want: null, why: "немає параметра" },
];

for (const { input, want, why } of cases) {
  const got = callbackPath(input);
  check(`${why}: ${JSON.stringify(input)} → ${JSON.stringify(want)}`, got === want, { got });
}

// Вузький помічник лишається вузьким: його двійник живе там, де вікна немає.
check("safeRelativePath не приймає повну адресу", safeRelativePath(`${ORIGIN}/cart`) === null);
check("safeRelativePath приймає шлях", safeRelativePath("/cart") === "/cart");

console.log(failed === 0 ? "\nУсі перевірки пройшли" : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
