import { OrderStatus } from "@prisma/client";

export function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    minimumFractionDigits: 0,
  }).format(price);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

/**
 * Оплата — при отриманні, тож «Очікує оплати» більше не описує стан: нове
 * замовлення одразу йде в роботу, а PAID означає підтвердження менеджером.
 * Значення enum лишились ті самі — перейменування зачепило б драйверський
 * контур, фільтри адмінки і всі наявні рядки.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Нове",
  PAID: "Підтверджено",
  PACKAGING: "На упакуванні",
  IN_TRANSIT: "В дорозі",
  DELIVERED: "Доставлено",
  CANCELLED: "Скасовано",
};

export const DELIVERY_METHOD_LABELS: Record<"DELIVERY" | "PICKUP", string> = {
  DELIVERY: "Доставка",
  PICKUP: "Самовивіз",
};

export const PAYMENT_METHOD_LABELS: Record<"COD", string> = {
  COD: "Оплата при отриманні",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-[#FFF8E1] text-[#B8860B]",
  PAID: "bg-[#E3F2FD] text-[#1565C0]",
  PACKAGING: "bg-[#F3E8FF] text-[#7C3AED]",
  IN_TRANSIT: "bg-[#FFF3E0] text-[#E65100]",
  DELIVERED: "bg-[#E8F5E9] text-[#2E7D32]",
  CANCELLED: "bg-[#FFEAEA] text-[#C62828]",
};

export const BOLTS_CASHBACK_RATE = 0.05; // 5%
export const BOLTS_MAX_USAGE_RATE = 0.3; // 30% of order total

/**
 * Шлях для повернення після входу — тільки всередині сайту.
 *
 * Перевірка на «/» без другого «/» відсікає `//evil.com`: браузер читає
 * такий шлях як протокол-відносний URL і повів би людину на чужий домен.
 */
export function safeRelativePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /^\/(?!\/)/.test(raw) ? raw : null;
}
