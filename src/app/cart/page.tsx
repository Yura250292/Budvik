"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCart, updateCartQty, clearCart, getCartTotal, CartItem } from "@/lib/cart";
import Image from "next/image";
import { formatPrice } from "@/lib/utils";
import { packLabel, stepPack } from "@/lib/pack-qty";
import NoPhoto from "@/components/ui/NoPhoto";

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
    // Оптовику потрібен акаунт — заявка йде його торговому. Роздріб оформлює
    // замовлення і гостем: вимога зареєструватись до покупки коштувала більше,
    // ніж давала.
    if (!session) {
      router.push("/checkout");
      return;
    }

    setLoading(true);
    setError("");

    // Wholesale clients submit an order request to their sales rep
    if (isWholesale) {
      const res = await fetch("/api/wholesale/order-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity, sellingPrice: i.price })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Помилка при відправці замовлення");
        setLoading(false);
        return;
      }

      const doc = await res.json();
      clearCart();
      router.push(`/dashboard/wholesale?ordered=${doc.number}`);
      return;
    }

    router.push("/checkout");
  };

  if (cart.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
        <h1 className="text-2xl font-bold text-bk mb-2">Кошик порожній</h1>
        <p className="text-g400 mb-6">Додайте товари з каталогу</p>
        <Link href="/catalog" className="btn-primary inline-block px-6 py-3 text-sm">
          Перейти до каталогу
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-bk mb-8">Кошик</h1>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-4">
          {cart.map((item) => (
            <div key={item.productId} className="bg-white border border-[#EFEFEF] rounded-xl p-3 sm:p-4">
              <div className="flex items-start gap-3">
                <div className="relative w-12 h-12 sm:w-16 sm:h-16 bg-[#FAFAFA] rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {item.image ? (
                    <Image src={item.image} alt="" fill className="object-contain" sizes="64px" />
                  ) : (
                    <NoPhoto size="sm" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link href={`/catalog/${item.slug}`} className="font-medium text-[#0A0A0A] hover:text-[#FFB800] text-sm sm:text-base line-clamp-2">
                    {item.name}
                  </Link>
                  <p className="text-[#0A0A0A] font-bold text-sm sm:text-base mt-0.5">{formatPrice(item.price)}</p>
                  {packLabel(item.packQty && item.packQty > 1 ? item.packQty : 1, item.name) && (
                    <p className="text-[#9E9E9E] text-xs mt-0.5">
                      {packLabel(item.packQty!, item.name)}
                    </p>
                  )}
                </div>
                <button onClick={() => updateCartQty(item.productId, 0)} className="text-[#9E9E9E] hover:text-[#0A0A0A] flex-shrink-0 p-1">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#EFEFEF]">
                <div className="flex items-center border border-[#DADADA] rounded-lg overflow-hidden">
                  <button onClick={() => updateCartQty(item.productId, stepPack(item.quantity, item.packQty || 1, -1))} className="w-9 h-9 flex items-center justify-center hover:bg-[#F7F7F7] active:bg-[#EFEFEF] text-[#0A0A0A]">-</button>
                  <span className="w-12 h-9 flex items-center justify-center text-sm font-medium border-x border-[#DADADA]">{item.quantity}</span>
                  <button onClick={() => updateCartQty(item.productId, stepPack(item.quantity, item.packQty || 1, 1))} className="w-9 h-9 flex items-center justify-center hover:bg-[#F7F7F7] active:bg-[#EFEFEF] text-[#0A0A0A]">+</button>
                </div>
                <span className="font-bold text-[#0A0A0A] text-base">{formatPrice(item.price * item.quantity)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white border border-g200 rounded-xl p-6 h-fit sticky top-20 shadow-[var(--shadow-card)]">
          <h2 className="text-xl font-bold text-bk mb-4">Підсумок</h2>

          <div className="space-y-2 text-sm mb-4">
            <div className="flex justify-between">
              <span className="text-g500">Товари ({cart.length})</span>
              <span>{formatPrice(total)}</span>
            </div>

            {/* Оплата Болтами прихована — логіка розрахунку лишається робочою. */}
          </div>

          <div className="border-t border-g200 pt-4 mb-4">
            <div className="flex justify-between text-lg font-bold">
              <span>До оплати</span>
              <span className="text-bk">{formatPrice(finalTotal)}</span>
            </div>
            {/* Рядок «+N Болтів кешбек» прихований разом із програмою лояльності. */}
          </div>

          <button
            onClick={handleCheckout}
            disabled={loading}
            className="btn-primary w-full py-3 text-sm disabled:opacity-50"
          >
            {loading
              ? "Відправка..."
              : isWholesale
              ? "Надіслати запит торговому"
              : "Оформити замовлення"}
          </button>
          {isWholesale && (
            <p className="text-xs text-g400 text-center mt-2">
              Запит надійде вашому торговому менеджеру
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
