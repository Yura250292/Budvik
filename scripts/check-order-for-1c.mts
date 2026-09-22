/**
 * Перевірка тексту замовлення для внесення в 1С. READ ONLY: бази не торкаємось.
 *
 * Запуск: npx tsx scripts/check-order-for-1c.mts
 *
 * У 1С ми не пишемо нічого — замовлення вносить менеджер руками. Цей текст
 * і є вся «інтеграція», тож у ньому має бути рівно те, що потрібно для
 * внесення, і насамперед артикул: саме за ним шукають номенклатуру.
 */

import { orderTextFor1C } from "../src/lib/orders/for-1c";

let failed = 0;

function ok(name: string, condition: boolean) {
  if (!condition) failed++;
  console.log(`${condition ? "✅" : "❌"} ${name}`);
}

const text = orderTextFor1C({
  orderNumber: 1043,
  contactName: "Іван Коваль",
  phone: "+380671112233",
  city: "Львів",
  address: "Відділення №12",
  deliveryMethod: "DELIVERY",
  comment: "Подзвонити після 17:00",
  totalAmount: 5240,
  items: [
    { sku: "GR-17318", name: "Перфоратор Grösser GR-17318", quantity: 1, price: 4200 },
    { sku: null, name: "Свердло по бетону", quantity: 2, price: 520 },
  ],
});

console.log(`\n${text}\n`);

ok("номер замовлення", text.includes("№ 1043"));
ok("імʼя клієнта", text.includes("Іван Коваль"));
ok("телефон", text.includes("+380671112233"));
ok("місто й відділення", text.includes("Львів") && text.includes("Відділення №12"));
ok("артикул позиції", text.includes("GR-17318"));
ok("кількість і ціна", text.includes("1 шт") && text.includes("4200.00"));
ok("товар без артикулу помічений", text.includes("без артикулу"));
ok("сума", text.includes("5240.00"));
ok("коментар", text.includes("Подзвонити після 17:00"));

const pickup = orderTextFor1C({
  orderNumber: 7,
  contactName: null,
  phone: null,
  city: null,
  address: null,
  deliveryMethod: "PICKUP",
  comment: null,
  totalAmount: 100,
  items: [{ sku: "X1", name: "Товар", quantity: 1, price: 100 }],
});

ok("самовивіз названо самовивозом", pickup.includes("самовивіз"));
ok("порожні поля не залишають «null»", !pickup.toLowerCase().includes("null"));
ok("без коментаря немає порожнього рядка «Коментар:»", !pickup.includes("Коментар:"));

console.log(failed === 0 ? "\nУсе гаразд." : `\nПомилок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
