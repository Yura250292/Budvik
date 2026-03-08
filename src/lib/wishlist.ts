"use client";

export interface WishlistItem {
  productId: string;
  name: string;
  slug: string;
  price: number;
  image?: string | null;
}

const KEY = "budvik_wishlist";

export function getWishlist(): WishlistItem[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(KEY);
  return data ? JSON.parse(data) : [];
}

export function isInWishlist(productId: string): boolean {
  return getWishlist().some((i) => i.productId === productId);
}

export function toggleWishlist(item: WishlistItem): boolean {
  const list = getWishlist();
  const idx = list.findIndex((i) => i.productId === item.productId);
  if (idx >= 0) {
    list.splice(idx, 1);
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event("wishlist-updated"));
    return false;
  }
  list.push(item);
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("wishlist-updated"));
  return true;
}

export function removeFromWishlist(productId: string) {
  const list = getWishlist().filter((i) => i.productId !== productId);
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("wishlist-updated"));
}

export function getWishlistCount(): number {
  return getWishlist().length;
}
