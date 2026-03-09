"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

export default function CheckoutPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    fetch(`/api/orders/${orderId}`)
      .then((r) => r.json())
      .then((data) => {
        setOrder(data);
        if (data.status !== "PENDING") setPaid(true);
        setLoading(false);
      });
  }, [orderId]);

  const handleTestPay = async () => {
    setPaying(true);
    // Simulate payment delay
    await new Promise((r) => setTimeout(r, 1500));

    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAID" }),
    });

    if (res.ok) {
      setPaid(true);
      const updated = await res.json();
      setOrder(updated);
    }
    setPaying(false);
  };

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="animate-spin w-10 h-10 border-3 border-orange-600 border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  if (!order || order.error) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <p className="text-red-600 font-bold">Замовлення не знайдено</p>
        <Link href="/dashboard/orders" className="text-orange-600 hover:underline mt-4 inline-block">
          Мої замовлення
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <div className="bg-white border rounded-xl shadow-lg p-8">
        {!paid ? (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-bk">Оплата замовлення</h1>
              <p className="text-g400 mt-1">#{orderId.slice(-8).toUpperCase()}</p>
            </div>

            {/* Order summary */}
            <div className="border rounded-lg p-4 mb-6 space-y-2">
              {order.items?.map((item: any) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-g600">{item.product?.name} x{item.quantity}</span>
                  <span className="font-medium">{formatPrice(item.price * item.quantity)}</span>
                </div>
              ))}
              <div className="border-t pt-2 flex justify-between font-bold text-lg">
                <span>До оплати</span>
                <span className="text-orange-600">{formatPrice(order.totalAmount)}</span>
              </div>
            </div>

            {/* Test payment info */}
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 mb-6 text-sm text-primary-dark">
              <p className="font-semibold">Тестовий режим</p>
              <p>Платіжна система не підключена. Натисніть кнопку нижче для імітації оплати.</p>
            </div>

            <button
              onClick={handleTestPay}
              disabled={paying}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-500 transition disabled:opacity-50 text-lg"
            >
              {paying ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                  Обробка оплати...
                </span>
              ) : (
                `Оплатити ${formatPrice(order.totalAmount)}`
              )}
            </button>
          </>
        ) : (
          <>
            <div className="text-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-green-700 mb-2">Оплата успішна!</h1>
              <p className="text-g400 mb-1">Замовлення #{orderId.slice(-8).toUpperCase()}</p>
              <p className="text-g400 mb-6">
                Сума: <span className="font-bold text-bk">{formatPrice(order.totalAmount)}</span>
              </p>

              {order.boltsEarned > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-6 text-sm text-orange-700">
                  Ви отримаєте <strong>{order.boltsEarned} Болтів</strong> кешбеку після доставки
                </div>
              )}

              <div className="flex flex-col gap-3">
                <Link
                  href="/dashboard/orders"
                  className="bg-orange-600 text-white py-3 rounded-lg font-semibold hover:bg-orange-500 transition text-center"
                >
                  Мої замовлення
                </Link>
                <Link
                  href="/catalog"
                  className="border border-g300 py-3 rounded-lg font-medium hover:bg-g50 transition text-center"
                >
                  Продовжити покупки
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
