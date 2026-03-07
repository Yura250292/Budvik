"use client";

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  slug: string;
}

const CART_KEY = "budvik_cart";

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(CART_KEY);
  return data ? JSON.parse(data) : [];
}

export function addToCart(item: Omit<CartItem, "quantity">, qty = 1) {
  const cart = getCart();
  const existing = cart.find((i) => i.productId === item.productId);
  if (existing) {
    existing.quantity += qty;
  } else {
    cart.push({ ...item, quantity: qty });
  }
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  window.dispatchEvent(new Event("cart-updated"));
}

export function updateCartQty(productId: string, quantity: number) {
  let cart = getCart();
  if (quantity <= 0) {
    cart = cart.filter((i) => i.productId !== productId);
  } else {
    const item = cart.find((i) => i.productId === productId);
    if (item) item.quantity = quantity;
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
