"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCart, updateCartQty, clearCart, getCartTotal, CartItem } from "@/lib/cart";
import { formatPrice } from "@/lib/utils";

export default function CartPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [useBolts, setUseBolts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const update = () => setCart(getCart());
    update();
    window.addEventListener("cart-updated", update);
    return () => window.removeEventListener("cart-updated", update);
  }, []);

  const total = getCartTotal(cart);
  const role = (session?.user as any)?.role;
  const isWholesale = role === "WHOLESALE";
  const boltsBalance = isWholesale ? 0 : ((session?.user as any)?.boltsBalance ?? 0);
  const maxBolts = Math.min(boltsBalance, total * 0.3);
  const boltsDiscount = useBolts ? maxBolts : 0;
  const finalTotal = total - boltsDiscount;
  const boltsEarned = isWholesale ? 0 : Math.floor(finalTotal * 0.05);

  const handleCheckout = async () => {
    if (!session) {
      router.push("/login");
      return;
    }

    setLoading(true);
    setError("");

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        useBolts,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Помилка при оформленні замовлення");
      setLoading(false);
      return;
    }

    const order = await res.json();
    clearCart();
    router.push(`/cart/checkout/${order.id}`);
  };

  if (cart.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Кошик порожній</h1>
        <p className="text-gray-500 mb-6">Додайте товари з каталогу</p>
        <Link href="/catalog" className="bg-yellow-400 text-black font-bold px-6 py-3 rounded-lg font-semibold hover:bg-yellow-300 transition">
          Перейти до каталогу
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Кошик</h1>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-4">
          {cart.map((item) => (
            <div key={item.productId} className="bg-white border border-[#EFEFEF] rounded-xl p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-[#FAFAFA] rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 sm:h-8 sm:w-8 text-[#DADADA]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/catalog/${item.slug}`} className="font-medium text-[#0A0A0A] hover:text-[#FFB800] text-sm sm:text-base line-clamp-2">
                    {item.name}
                  </Link>
                  <p className="text-[#0A0A0A] font-bold text-sm sm:text-base mt-0.5">{formatPrice(item.price)}</p>
                </div>
                <button onClick={() => updateCartQty(item.productId, 0)} className="text-[#9E9E9E] hover:text-[#0A0A0A] flex-shrink-0 p-1">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#EFEFEF]">
                <div className="flex items-center border border-[#DADADA] rounded-lg overflow-hidden">
                  <button onClick={() => updateCartQty(item.productId, item.quantity - 1)} className="w-9 h-9 flex items-center justify-center hover:bg-[#F7F7F7] active:bg-[#EFEFEF] text-[#0A0A0A]">-</button>
                  <span className="w-10 h-9 flex items-center justify-center text-sm font-medium border-x border-[#DADADA]">{item.quantity}</span>
                  <button onClick={() => updateCartQty(item.productId, item.quantity + 1)} className="w-9 h-9 flex items-center justify-center hover:bg-[#F7F7F7] active:bg-[#EFEFEF] text-[#0A0A0A]">+</button>
                </div>
                <span className="font-bold text-[#0A0A0A] text-base">{formatPrice(item.price * item.quantity)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white border rounded-lg p-6 h-fit sticky top-20">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Підсумок</h2>

          <div className="space-y-2 text-sm mb-4">
            <div className="flex justify-between">
              <span className="text-gray-600">Товари ({cart.length})</span>
              <span>{formatPrice(total)}</span>
            </div>

            {session && !isWholesale && boltsBalance > 0 && (
              <div className="border-t pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useBolts}
                    onChange={(e) => setUseBolts(e.target.checked)}
                    className="rounded text-gray-900 focus:ring-yellow-500"
                  />
                  <span className="text-gray-700">Використати Болти</span>
                </label>
                {useBolts && (
                  <div className="flex justify-between text-green-600 mt-1">
                    <span>Знижка ({Math.floor(maxBolts)} Болтів)</span>
                    <span>-{formatPrice(boltsDiscount)}</span>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-1">Баланс: {boltsBalance} Болтів</p>
              </div>
            )}
          </div>

          <div className="border-t pt-4 mb-4">
            <div className="flex justify-between text-lg font-bold">
              <span>До оплати</span>
              <span className="text-gray-900">{formatPrice(finalTotal)}</span>
            </div>
            {session && !isWholesale && boltsEarned > 0 && (
              <p className="text-xs text-green-600 mt-1">+ {boltsEarned} Болтів кешбек</p>
            )}
          </div>

          <button
            onClick={handleCheckout}
            disabled={loading}
            className="w-full bg-yellow-400 text-black font-bold py-3 rounded-lg font-semibold hover:bg-yellow-300 transition disabled:opacity-50"
          >
            {loading ? "Оформлення..." : session ? "Оформити замовлення" : "Увійти для замовлення"}
          </button>
        </div>
      </div>
    </div>
  );
}
