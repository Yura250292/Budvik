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
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [loading, setLoading] = useState(false);

  /** Знімає підказку з поля, щойно людина почала його виправляти. */
  const set = (patch: Partial<Draft>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k as keyof Draft];
      return next;
    });
  };

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

  /**
   * Перевірка кожного поля окремо, а не одним написом угорі: у формі з пʼяти
   * полів повідомлення «заповніть обовʼязкові» змушує шукати, яке саме порожнє.
   */
  const validate = (f: Draft): Partial<Record<keyof Draft, string>> => {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!f.contactName.trim()) e.contactName = "Вкажіть, на чиє імʼя замовлення";
    if (!f.phone.trim()) e.phone = "Без телефону ми не зможемо підтвердити замовлення";
    else if (!isValidUaPhone(f.phone)) e.phone = "Схоже, у номері помилка — має бути 9 цифр після +380";
    if (f.deliveryMethod === "DELIVERY") {
      if (!f.city.trim()) e.city = "Вкажіть місто або село";
      if (!f.address.trim()) e.address = "Вкажіть вулицю й будинок";
    }
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const found = validate(form);
    setErrors(found);
    const firstBad = Object.keys(found)[0];
    if (firstBad) {
      // Ведемо людину до першого незаповненого поля — на телефоні воно
      // цілком могло лишитись за межами екрана.
      const el = document.getElementById(`f-${firstBad}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
      return;
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
  // Червона рамка + кільце: колір не єдиний сигнал — під полем є ще й текст
  const bad = "border-red-400 focus:ring-red-300";
  const fieldCls = (k: keyof Draft) => `${field} ${errors[k] ? bad : ""}`;

  const FieldError = ({ k }: { k: keyof Draft }) =>
    errors[k] ? (
      <p id={`e-${k}`} role="alert" className="mt-1 flex items-center gap-1 text-xs text-red-600">
        <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
        </svg>
        {errors[k]}
      </p>
    ) : null;

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
              <label htmlFor="f-contactName" className="block text-sm font-medium text-g600 mb-1">
                Ім&apos;я та прізвище <span className="text-red-500">*</span>
              </label>
              <input
                id="f-contactName"
                type="text"
                value={form.contactName}
                onChange={(e) => set({ contactName: e.target.value })}
                autoComplete="name"
                aria-required="true"
                aria-invalid={!!errors.contactName}
                aria-describedby={errors.contactName ? "e-contactName" : undefined}
                className={fieldCls("contactName")}
              />
              <FieldError k="contactName" />
            </div>
            <div>
              <label htmlFor="f-phone" className="block text-sm font-medium text-g600 mb-1">
                Телефон <span className="text-red-500">*</span>
              </label>
              <input
                id="f-phone"
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => set({ phone: formatPhoneInput(e.target.value) })}
                onFocus={() => !form.phone && set({ phone: "+380 " })}
                autoComplete="tel"
                placeholder="+380 67 123 45 67"
                aria-required="true"
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? "e-phone" : "h-phone"}
                className={fieldCls("phone")}
              />
              <FieldError k="phone" />
              {!errors.phone && (
                <p id="h-phone" className="text-xs text-g400 mt-1">
                  На цей номер зателефонує менеджер для підтвердження
                </p>
              )}
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
                    onChange={() => {
                      // Перемикання на самовивіз знімає вимогу адреси разом
                      // із її підсвіткою — інакше червоне лишалось би висіти
                      set({ deliveryMethod: m });
                      if (m === "PICKUP") setErrors((e) => ({ ...e, city: undefined, address: undefined }));
                    }}
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
                  <label htmlFor="f-city" className="block text-sm font-medium text-g600 mb-1">
                    Місто / населений пункт <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="f-city"
                    type="text"
                    value={form.city}
                    onChange={(e) => set({ city: e.target.value })}
                    autoComplete="address-level2"
                    aria-required="true"
                    aria-invalid={!!errors.city}
                    aria-describedby={errors.city ? "e-city" : undefined}
                    className={fieldCls("city")}
                  />
                  <FieldError k="city" />
                </div>
                <div>
                  <label htmlFor="f-address" className="block text-sm font-medium text-g600 mb-1">
                    Вулиця, будинок, квартира <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="f-address"
                    type="text"
                    value={form.address}
                    onChange={(e) => set({ address: e.target.value })}
                    autoComplete="street-address"
                    aria-required="true"
                    aria-invalid={!!errors.address}
                    aria-describedby={errors.address ? "e-address" : undefined}
                    className={fieldCls("address")}
                  />
                  <FieldError k="address" />
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
