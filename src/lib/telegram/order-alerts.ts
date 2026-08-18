/**
 * Сповіщення персоналу про нове замовлення з сайту.
 *
 * Замовлення з COD ніхто не «оплачує» — воно просто зʼявляється в адмінці.
 * Без цього повідомлення менеджер дізнається про нього, лише коли сам зайде,
 * а покупець тим часом чекає дзвінка.
 *
 * Відсутність ORDER_ALERT_CHAT_ID не є помилкою — алерти просто не йдуть.
 */

import { sendTelegramMessage } from "@/lib/telegram/notify";
import { formatPrice } from "@/lib/utils";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface NewOrderAlert {
  id: string;
  orderNumber: number;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  deliveryMethod: "DELIVERY" | "PICKUP";
  comment: string | null;
  totalAmount: number;
  isGuest: boolean;
  items: { name: string; quantity: number }[];
}

export async function notifyStaffNewOrder(order: NewOrderAlert): Promise<void> {
  const chatId = process.env.ORDER_ALERT_CHAT_ID;
  if (!chatId) return;

  const where =
    order.deliveryMethod === "PICKUP"
      ? "Самовивіз"
      : `Доставка: ${[order.city, order.address].filter(Boolean).join(", ") || "—"}`;

  // Перші 10 позицій: довше повідомлення Telegram однаково обріже на 4096.
  const lines = order.items
    .slice(0, 10)
    .map((i) => `• ${escapeHtml(i.name)} × ${i.quantity}`)
    .join("\n");
  const more = order.items.length > 10 ? `\n…і ще ${order.items.length - 10} поз.` : "";

  const base = process.env.NEXTAUTH_URL || "";

  await sendTelegramMessage(
    chatId,
    `🛒 <b>Нове замовлення № ${order.orderNumber}</b>${order.isGuest ? " (гість)" : ""}\n` +
      `${escapeHtml(order.contactName || "—")} — <code>${escapeHtml(order.phone || "—")}</code>\n` +
      `${escapeHtml(where)}\n` +
      (order.comment ? `Коментар: ${escapeHtml(order.comment)}\n` : "") +
      `Оплата при отриманні\n\n` +
      `${lines}${more}\n\n` +
      `<b>Разом: ${formatPrice(order.totalAmount)}</b>` +
      (base ? `\n${base}/admin/orders` : "")
  );
}
