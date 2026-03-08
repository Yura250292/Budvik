"use client";

export interface CompareItem {
  productId: string;
  name: string;
  slug: string;
  price: number;
  image?: string | null;
  category?: string;
  description?: string;
}

const KEY = "budvik_compare";
const MAX_ITEMS = 4;

export function getCompareList(): CompareItem[] {
  if (typeof window === "undefined") return [];
  const data = localStorage.getItem(KEY);
  return data ? JSON.parse(data) : [];
}

export function isInCompare(productId: string): boolean {
  return getCompareList().some((i) => i.productId === productId);
}

export function toggleCompare(item: CompareItem): { added: boolean; full: boolean } {
  const list = getCompareList();
  const idx = list.findIndex((i) => i.productId === item.productId);
  if (idx >= 0) {
    list.splice(idx, 1);
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event("compare-updated"));
    return { added: false, full: false };
  }
  if (list.length >= MAX_ITEMS) {
    return { added: false, full: true };
  }
  list.push(item);
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("compare-updated"));
  return { added: true, full: false };
}

export function removeFromCompare(productId: string) {
  const list = getCompareList().filter((i) => i.productId !== productId);
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("compare-updated"));
}

export function clearCompare() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("compare-updated"));
}

export function getCompareCount(): number {
  return getCompareList().length;
}
