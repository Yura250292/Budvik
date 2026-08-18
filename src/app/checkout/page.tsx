"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { getCart, clearCart, getCartTotal, CartItem } from "@/lib/cart";
import { formatPrice } from "@/lib/utils";
import { formatPhoneInput, isValidUaPhone } from "@/lib/phone";

/**
 * Останні контакти покупця. Гість без акаунта інакше набирав би адресу
 * заново при кожному замовленні — а це той самий чоловік на тій самій дачі.
 */
const DRAFT_KEY = "budvik_checkout";

type Draft = {
  contactName: string;
  phone: string;
  city: string;
  address: string;
  deliveryMethod: "DELIVERY" | "PICKUP";
  comment: string;
};

const EMPTY: Draft = {
  contactName: "",
  phone: "",
  city: "",
  address: "",
  deliveryMethod: "DELIVERY",
  comment: "",
};

export default function CheckoutPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [cart, setCart] = useState<CartItem[] | null>(null);
  const [form, setForm] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const items = getCart();
    setCart(items);
    if (items.length === 0) router.replace("/cart");
  }, [router]);

  // Чернетка з минулого разу, поверх неї — дані профілю: у профілі
  // актуальніший телефон, ніж той, що людина колись набрала гостем.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setForm((f) => ({ ...f, ...JSON.parse(saved) }));
    } catch {
      /* зіпсована чернетка не має ламати оформлення */
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetch("/api/account/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p) return;
        setForm((f) => ({
          ...f,
          contactName: f.contactName || p.name || "",
          phone: f.phone || (p.phone ? formatPhoneInput(p.phone) : ""),
        }));
      })
      .catch(() => {});
  }, [sessionStatus]);

  const total = cart ? getCartTotal(cart) : 0;
  const needsAddress = form.deliveryMethod === "DELIVERY";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.contactName.trim()) return setError("Вкажіть імʼя");
    if (!isValidUaPhone(form.phone)) return setError("Вкажіть коректний номер телефону");
    if (needsAddress && (!form.city.trim() || !form.address.trim())) {
      return setError("Вкажіть місто та адресу доставки");
    }

    setLoading(true);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: (cart ?? []).map((i) => ({ productId: i.productId, quantity: i.quantity })),
        contactName: form.contactName,
        phone: form.phone,
        city: form.city,
        address: form.address,
        deliveryMethod: form.deliveryMethod,
        comment: form.comment,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Помилка при оформленні замовлення");
      setLoading(false);
      return;
    }

    const order = await res.json();
    clearCart();
    router.push(
      order.guestToken
        ? `/order/${order.guestToken}?success=1`
        : `/dashboard/orders/${order.id}?success=1`
    );
  };

  if (cart === null || cart.length === 0) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-g400">Завантаження…</div>;
  }

  const field = "w-full border border-g300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary";

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl sm:text-3xl font-bold text-bk mb-6">Оформлення замовлення</h1>

      {!session && (
        <div className="bg-[#FFF8E1] border border-[#FFE082] text-[#7A5C00] rounded-xl p-4 mb-6 text-sm">
          Ви оформлюєте замовлення без акаунта. Після підтвердження збережіть посилання для
          відстеження — воно відкриється лише у вас.{" "}
          <Link href="/login?callbackUrl=%2Fcheckout" className="underline font-medium">
            Увійти
          </Link>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      <form onSubmit={handleSubmit} className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <section className="bg-white border border-g200 rounded-xl p-4 sm:p-6 space-y-4">
            <h2 className="font-bold text-bk">Контакти</h2>
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Ім&apos;я та прізвище *</label>
              <input
                type="text"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                required
                autoComplete="name"
                className={field}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Телефон *</label>
              <input
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: formatPhoneInput(e.target.value) })}
                onFocus={() => !form.phone && setForm((f) => ({ ...f, phone: "+380 " }))}
                required
                autoComplete="tel"
                placeholder="+380 67 123 45 67"
                className={field}
              />
              <p className="text-xs text-g400 mt-1">На цей номер зателефонує менеджер для підтвердження</p>
            </div>
          </section>

          <section className="bg-white border border-g200 rounded-xl p-4 sm:p-6 space-y-4">
            <h2 className="font-bold text-bk">Доставка</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {(["DELIVERY", "PICKUP"] as const).map((m) => (
                <label
                  key={m}
                  className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition ${
                    form.deliveryMethod === m
                      ? "border-primary bg-[#FFFBF0]"
                      : "border-g300 hover:bg-g50"
                  }`}
                >
                  <input
                    type="radio"
                    name="delivery"
                    checked={form.deliveryMethod === m}
                    onChange={() => setForm({ ...form, deliveryMethod: m })}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-bk text-sm">
                      {m === "DELIVERY" ? "Доставка" : "Самовивіз"}
                    </span>
                    <span className="block text-xs text-g400 mt-0.5">
                      {m === "DELIVERY"
                        ? "Привеземо за вашою адресою"
                        : "Заберете зі складу — адресу підкажемо в дзвінку"}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {needsAddress && (
              <>
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Місто / населений пункт *</label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    required
                    autoComplete="address-level2"
                    className={field}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-g600 mb-1">Вулиця, будинок, квартира *</label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    required
                    autoComplete="street-address"
                    className={field}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Коментар до замовлення</label>
              <textarea
                value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
                rows={3}
                maxLength={500}
                placeholder="Зручний час, орієнтир, побажання"
                className={field}
              />
            </div>
          </section>

          <section className="bg-white border border-g200 rounded-xl p-4 sm:p-6">
            <h2 className="font-bold text-bk mb-2">Оплата</h2>
            <p className="text-sm text-g600">
              Оплата при отриманні — готівкою або карткою. Передоплата не потрібна.
            </p>
          </section>
        </div>

        <div className="bg-white border border-g200 rounded-xl p-4 sm:p-6 h-fit md:sticky md:top-20 shadow-[var(--shadow-card)]">
          <h2 className="font-bold text-bk mb-4">Ваше замовлення</h2>
          <div className="space-y-3 mb-4 max-h-72 overflow-y-auto">
            {cart.map((item) => (
              <div key={item.productId} className="flex gap-3 items-start">
                <div className="relative w-10 h-10 bg-[#FAFAFA] rounded flex-shrink-0 overflow-hidden">
                  {item.image && (
                    <Image src={item.image} alt="" fill className="object-contain" sizes="40px" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-bk line-clamp-2">{item.name}</p>
                  <p className="text-xs text-g400">
                    {item.quantity} × {formatPrice(item.price)}
                  </p>
                </div>
                <span className="text-sm font-medium whitespace-nowrap">
                  {formatPrice(item.price * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-g200 pt-4 mb-4 flex justify-between text-lg font-bold">
            <span>Разом</span>
            <span className="text-bk">{formatPrice(total)}</span>
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-sm disabled:opacity-50">
            {loading ? "Оформлюємо…" : "Підтвердити замовлення"}
          </button>
          <Link href="/cart" className="block text-center text-sm text-g500 hover:text-bk mt-3">
            Повернутися до кошика
          </Link>
        </div>
      </form>
    </div>
  );
}
