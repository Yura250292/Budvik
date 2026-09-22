/**
 * Замовлення з сайту текстом — щоб менеджер вніс його в 1С.
 *
 * У 1С ми не пишемо нічого (docs/1c-read-only.md), тож замовлення вносить
 * людина — тим самим рухом, що й замовлення торгових з Impuls. Єдине, що
 * ми можемо, — зробити це внесення швидким: артикул першим у рядку, бо
 * саме за ним шукають номенклатуру, а не за назвою.
 *
 * Чиста функція без Prisma: її перевіряє scripts/check-order-for-1c.mts, і
 * той самий текст однаково збирається і на сервері, і в браузері.
 */

export type OrderFor1C = {
  orderNumber: number;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  deliveryMethod: string;
  comment: string | null;
  totalAmount: number;
  items: Array<{ sku: string | null; name: string; quantity: number; price: number }>;
};

export function orderTextFor1C(o: OrderFor1C): string {
  const head = [
    `Замовлення з сайту № ${o.orderNumber}`,
    `Клієнт: ${o.contactName ?? "—"}`,
    `Телефон: ${o.phone ?? "—"}`,
    o.deliveryMethod === "PICKUP"
      ? "Доставка: самовивіз"
      : `Доставка: ${[o.city, o.address].filter(Boolean).join(", ") || "—"}`,
  ];
  // Рядок про коментар з'являється лише тоді, коли коментар є: порожній
  // «Коментар:» у тексті для копіювання лише заважає.
  if (o.comment) head.push(`Коментар: ${o.comment}`);

  const lines = o.items.map(
    (i) => `${i.sku ?? "без артикулу"} · ${i.name} · ${i.quantity} шт · ${i.price.toFixed(2)} грн`
  );

  return [...head, "", ...lines, "", `Разом: ${o.totalAmount.toFixed(2)} грн`].join("\n");
}
