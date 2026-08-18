/**
 * Сповіщення персоналу про нове замовлення з сайту.
 *
 * Замовлення з COD ніхто не «оплачує» — воно просто зʼявляється в адмінці.
 * Без цього повідомлення менеджер дізнається про нього, лише коли сам зайде,
 * а покупець тим часом чекає дзвінка.
 *
 * Адресатів двоє видів і вони не взаємозамінні:
 *  - ORDER_ALERT_CHAT_ID — один чат (зазвичай група) з env, історичний;
 *  - OrderAlertRecipient — список людей, який адмін веде на
 *    /admin/orders/alerts і кожен отримує замовлення в особисті.
 * Порожні обидва — алерти просто не йдуть, це не помилка.
 */

import { prisma } from "@/lib/prisma";
import { sendTelegramMessageResult } from "@/lib/telegram/notify";
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

function buildText(order: NewOrderAlert): string {
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

  return (
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

export async function notifyStaffNewOrder(order: NewOrderAlert): Promise<void> {
  const recipients = await prisma.orderAlertRecipient.findMany({
    where: { active: true, telegramId: { not: null } },
    select: { id: true, telegramId: true },
  });

  const envChat = process.env.ORDER_ALERT_CHAT_ID;
  // Група з env і людина зі списку можуть вказувати на той самий чат —
  // тоді повідомлення прийшло б двічі.
  const chats = new Set<string>(recipients.map((r) => r.telegramId!));
  if (envChat) chats.add(envChat);
  if (chats.size === 0) return;

  const text = buildText(order);

  // Послідовно, а не Promise.all: Telegram ріже ~30 повідомлень за секунду,
  // а адресатів тут одиниці — паралелізм нічого не пришвидшить, зате
  // ризикує впертись у 429 і мовчки загубити частину сповіщень.
  const blocked: string[] = [];
  for (const chatId of chats) {
    const res = await sendTelegramMessageResult(chatId, text);
    if (!res.ok && res.status === 403) blocked.push(chatId);
  }

  // 403 означає, що людина заблокувала бота або видалила чат — писати їй
  // більше нікуди. Вимикаємо, щоб адмін бачив це у списку, а не гадав,
  // чому «приходить не всім».
  if (blocked.length > 0) {
    await prisma.orderAlertRecipient.updateMany({
      where: { telegramId: { in: blocked } },
      data: { active: false },
    });
  }
}
