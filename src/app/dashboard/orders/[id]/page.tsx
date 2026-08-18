"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { addToCart } from "@/lib/cart";
import {
  formatPrice,
  formatDate,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  DELIVERY_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/utils";
import OrderStatusProgress from "@/components/OrderStatusProgress";

function OrderDetail() {
  const params = useParams();
  const router = useRouter();
  const justOrdered = useSearchParams().get("success") === "1";
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/orders/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setOrder(data);
        setLoading(false);
      });
  }, [params.id]);

  const handleCancel = async () => {
    if (!confirm("Скасувати замовлення? Товари повернуться в продаж.")) return;
    setBusy(true);
    const res = await fetch(`/api/orders/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    if (res.ok) setOrder(await res.json());
    setBusy(false);
  };

  const handleReorder = () => {
    for (const item of order.items) {
      addToCart(
        {
          productId: item.product.id,
          name: item.product.name,
          price: item.product.price ?? item.price,
          slug: item.product.slug,
          image: item.product.image,
          packQty: item.product.packQty,
        },
        item.quantity
      );
    }
    router.push("/cart");
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 animate-pulse">
        <div className="h-8 bg-g200 rounded w-64 mb-4"></div>
        <div className="h-64 bg-g200 rounded"></div>
      </div>
    );
  }

  if (!order || order.error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p className="text-g400">Замовлення не знайдено</p>
      </div>
    );
  }

  const where =
    order.deliveryMethod === "PICKUP"
      ? null
      : [order.city, order.address].filter(Boolean).join(", ");

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/dashboard/orders" className="text-primary hover:underline text-sm mb-4 inline-block">
        &larr; Назад до замовлень
      </Link>

      {justOrdered && (
        <div className="bg-[#E8F5E9] border border-[#A5D6A7] text-[#1B5E20] rounded-xl p-4 mb-6">
          <p className="font-bold">Дякуємо! Замовлення № {order.orderNumber} прийнято.</p>
          <p className="text-sm mt-1">Менеджер зателефонує для підтвердження. Оплата — при отриманні.</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-bk">Замовлення № {order.orderNumber}</h1>
        <span className={`px-4 py-2 rounded-full text-sm font-medium ${ORDER_STATUS_COLORS[order.status as keyof typeof ORDER_STATUS_COLORS]}`}>
          {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]}
        </span>
      </div>

      <div className="mb-6">
        <OrderStatusProgress status={order.status} />
      </div>

      <div className="bg-white border border-g200 rounded-xl overflow-hidden mb-6">
        <div className="p-4 bg-g50 border-b border-g200 text-sm text-g500 space-y-1">
          <p>Дата: {formatDate(order.createdAt)}</p>
          {order.deliveryMethod && (
            <p>
              {DELIVERY_METHOD_LABELS[order.deliveryMethod as "DELIVERY" | "PICKUP"]}
              {where ? `: ${where}` : ""}
            </p>
          )}
          {order.paymentMethod && <p>{PAYMENT_METHOD_LABELS[order.paymentMethod as "COD"]}</p>}
          {order.phone && (
            <p>
              {order.contactName} · {order.phone}
            </p>
          )}
          {order.comment && <p>Коментар: {order.comment}</p>}
        </div>
        <div className="divide-y divide-g200">
          {order.items.map((item: any) => (
            <div key={item.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/catalog/${item.product.slug}`} className="font-medium text-bk hover:text-primary-dark">
                  {item.product.name}
                </Link>
                <p className="text-sm text-g400">
                  {item.quantity} × {formatPrice(item.price)}
                </p>
              </div>
              <span className="font-bold whitespace-nowrap">{formatPrice(item.price * item.quantity)}</span>
            </div>
          ))}
        </div>
        <div className="p-4 bg-g50 border-t border-g200 space-y-1">
          {order.boltsUsed > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Знижка Болтами</span>
              <span>-{formatPrice(order.boltsUsed)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>Всього</span>
            <span className="text-bk">{formatPrice(order.totalAmount)}</span>
          </div>
          {order.boltsEarned > 0 && (
            <p className="text-sm text-primary-dark">Кешбек: +{order.boltsEarned} Болтів</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button onClick={handleReorder} className="btn-primary px-5 py-2.5 text-sm">
          Повторити замовлення
        </button>
        {/* Скасувати можна лише поки менеджер не взяв замовлення в роботу —
            далі товар уже комплектують, і рішення за телефоном. */}
        {order.status === "PENDING" && (
          <button
            onClick={handleCancel}
            disabled={busy}
            className="px-5 py-2.5 text-sm border border-g300 rounded-lg text-g600 hover:bg-g50 disabled:opacity-50"
          >
            {busy ? "Скасовуємо…" : "Скасувати замовлення"}
          </button>
        )}
      </div>
    </div>
  );
}

// useSearchParams вимагає Suspense — без нього збірка Next падає
export default function OrderDetailPage() {
  return (
    <Suspense>
      <OrderDetail />
    </Suspense>
  );
}
