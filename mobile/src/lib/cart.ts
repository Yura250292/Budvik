/**
 * Кошик застосунку.
 *
 * Перенесення src/lib/cart.ts із сайту: та сама форма рядка й та сама
 * кратність пакування. Змінилося лише сховище — localStorage браузера на
 * AsyncStorage — і те, що операції асинхронні.
 *
 * Ціни тут зберігаються знімком, як і на сайті, і саме тому підсумок у кошику
 * — довідковий: остаточну суму рахує сервер при оформленні, бо ціни їдуть з 1С
 * кожні кілька хвилин.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CardDto } from "@/api/types";

const CART_KEY = "budvik_cart";

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  slug: string;
  image?: string | null;
  packQty?: number | null;
};

/** Кратність: 1 або null — товар поштучний. Дзеркало packQtyOf із сайту. */
function packOf(packQty?: number | null): number {
  return packQty && packQty > 1 ? packQty : 1;
}

/** Округлення вгору до цілої пачки. Дзеркало roundUpToPack із сайту. */
export function roundUpToPack(qty: number, pack: number): number {
  if (pack <= 1) return Math.max(0, Math.floor(qty));
  return Math.ceil(Math.max(0, qty) / pack) * pack;
}

export async function getCart(): Promise<CartItem[]> {
  const raw = await AsyncStorage.getItem(CART_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CartItem[];
  } catch {
    // Пошкоджений запис не має ламати кошик назавжди — краще порожній.
    return [];
  }
}

async function save(cart: CartItem[]): Promise<CartItem[]> {
  await AsyncStorage.setItem(CART_KEY, JSON.stringify(cart));
  return cart;
}

export async function addToCart(product: CardDto, qty = 1): Promise<CartItem[]> {
  const cart = await getCart();
  const pack = packOf(product.packQty);
  const existing = cart.find((i) => i.productId === product.id);

  if (existing) {
    existing.quantity = roundUpToPack(existing.quantity + qty, pack);
    existing.packQty = product.packQty;
    existing.price = product.price;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      slug: product.slug,
      image: product.image,
      packQty: product.packQty,
      quantity: roundUpToPack(qty, pack),
    });
  }
  return save(cart);
}

export async function updateQty(productId: string, quantity: number): Promise<CartItem[]> {
  let cart = await getCart();
  const target = cart.find((i) => i.productId === productId);
  const pack = packOf(target?.packQty);

  // Нижче однієї пачки опускатися нікуди — це прибирання рядка.
  if (quantity <= 0 || (pack > 1 && quantity < pack)) {
    cart = cart.filter((i) => i.productId !== productId);
  } else if (target) {
    target.quantity = roundUpToPack(quantity, pack);
  }
  return save(cart);
}

export async function clearCart(): Promise<void> {
  await AsyncStorage.removeItem(CART_KEY);
}

export function cartTotal(cart: CartItem[]): number {
  return cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

export function cartCount(cart: CartItem[]): number {
  return cart.reduce((sum, i) => sum + i.quantity, 0);
}
