"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/utils";

export default function OrderDetailPage() {
  const params = useParams();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/orders/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setOrder(data);
        setLoading(false);
      });
  }, [params.id]);

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

  const statusSteps = ["PENDING", "PAID", "PACKAGING", "IN_TRANSIT", "DELIVERED"];
  const currentStep = statusSteps.indexOf(order.status);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/dashboard/orders" className="text-primary hover:underline text-sm mb-4 inline-block">
        &larr; Назад до замовлень
      </Link>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-bk">
          Замовлення #{order.id.slice(-8).toUpperCase()}
        </h1>
        <span className={`px-4 py-2 rounded-full text-sm font-medium ${ORDER_STATUS_COLORS[order.status as keyof typeof ORDER_STATUS_COLORS]}`}>
          {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]}
        </span>
      </div>

      {/* Status Progress */}
      {order.status !== "CANCELLED" && (
        <div className="bg-white border rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            {statusSteps.map((step, i) => (
              <div key={step} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      i <= currentStep ? "bg-primary text-bk" : "bg-g200 text-g400"
                    }`}
                  >
                    {i <= currentStep ? "✓" : i + 1}
                  </div>
                  <span className="text-xs mt-1 text-g400 text-center hidden sm:block">
                    {ORDER_STATUS_LABELS[step as keyof typeof ORDER_STATUS_LABELS]}
                  </span>
                </div>
                {i < statusSteps.length - 1 && (
                  <div className={`flex-1 h-1 mx-2 ${i < currentStep ? "bg-primary" : "bg-g200"}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order Details */}
      <div className="bg-white border rounded-lg overflow-hidden mb-6">
        <div className="p-4 bg-g50 border-b">
          <p className="text-sm text-g400">Дата: {formatDate(order.createdAt)}</p>
        </div>
        <div className="divide-y">
          {order.items.map((item: any) => (
            <div key={item.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-bk">{item.product.name}</p>
                <p className="text-sm text-g400">{item.quantity} x {formatPrice(item.price)}</p>
              </div>
              <span className="font-bold">{formatPrice(item.price * item.quantity)}</span>
            </div>
          ))}
        </div>
        <div className="p-4 bg-g50 border-t space-y-1">
          {order.boltsUsed > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Знижка Болтами</span>
              <span>-{formatPrice(order.boltsUsed)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>Всього</span>
            <span className="text-primary">{formatPrice(order.totalAmount)}</span>
          </div>
          {order.boltsEarned > 0 && (
            <p className="text-sm text-primary">Кешбек: +{order.boltsEarned} Болтів</p>
          )}
        </div>
      </div>
    </div>
  );
}
