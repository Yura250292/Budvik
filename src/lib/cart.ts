"use client";

import { roundUpToPack } from "@/lib/pack-qty";

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  slug: string;
  image?: string | null;
  // Кратність пачки. Кладеться в кошик разом із товаром, щоб /cart не ходив
  // по базу за кожним рядком. Старі кошики в localStorage її не мають — тоді
  // товар поводиться як поштучний, поки його не додадуть заново.
  packQty?: number | null;
}

const CART_KEY = "budvik_cart";

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(CART_KEY);
  return data ? JSON.parse(data) : [];
}

export function addToCart(item: Omit<CartItem, "quantity">, qty = 1) {
  const cart = getCart();
  const pack = item.packQty && item.packQty > 1 ? item.packQty : 1;
  const existing = cart.find((i) => i.productId === item.productId);
  if (existing) {
    existing.quantity = roundUpToPack(existing.quantity + qty, pack);
    existing.packQty = item.packQty;
  } else {
    cart.push({ ...item, quantity: roundUpToPack(qty, pack) });
  }
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  // CustomEvent замість Event: подія несе, ЩО саме поклали, і аналітика
  // читає це з одного місця замість інструментування кожної кнопки
  // «В кошик». Для наявних слухачів нічого не міняється — вони лише
  // перераховують лічильник, а CustomEvent є Event.
  window.dispatchEvent(
    new CustomEvent("cart-updated", {
      detail: { action: "add", productId: item.productId, qty },
    })
  );
}

export function updateCartQty(productId: string, quantity: number) {
  let cart = getCart();
  const target = cart.find((i) => i.productId === productId);
  const pack = target?.packQty && target.packQty > 1 ? target.packQty : 1;
  // Нижче однієї пачки опускатися нікуди — це прибирання рядка.
  if (quantity <= 0 || (pack > 1 && quantity < pack)) {
    cart = cart.filter((i) => i.productId !== productId);
  } else if (target) {
    target.quantity = roundUpToPack(quantity, pack);
  }
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  window.dispatchEvent(new Event("cart-updated"));
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
  window.dispatchEvent(new Event("cart-updated"));
}

export function getCartTotal(cart: CartItem[]): number {
  return cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

export function getCartCount(cart: CartItem[]): number {
  return cart.reduce((sum, i) => sum + i.quantity, 0);
}
