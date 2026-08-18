import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import OrderStatusProgress from "@/components/OrderStatusProgress";
import {
  formatDate,
  formatPrice,
  DELIVERY_METHOD_LABELS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/utils";

/**
 * Відстеження замовлення без акаунта — за секретним посиланням із токеном.
 *
 * force-dynamic: сторінка про живий статус, кешована версія показувала б
 * «Нове» ще довго після того, як товар уже поїхав.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ваше замовлення — БУДВІК27",
  robots: { index: false, follow: false },
};

export default async function GuestOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  const { token } = await params;
  const { success } = await searchParams;

  const order = await prisma.order.findUnique({
    where: { guestToken: token },
    select: {
      orderNumber: true,
      status: true,
      createdAt: true,
      totalAmount: true,
      contactName: true,
      phone: true,
      city: true,
      address: true,
      deliveryMethod: true,
      paymentMethod: true,
      comment: true,
      items: {
        select: {
          id: true,
          quantity: true,
          price: true,
          product: { select: { name: true, slug: true } },
        },
      },
    },
  });

  if (!order) notFound();

  const where =
    order.deliveryMethod === "PICKUP"
      ? DELIVERY_METHOD_LABELS.PICKUP
      : [order.city, order.address].filter(Boolean).join(", ");

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {success && (
        <div className="bg-[#E8F5E9] border border-[#A5D6A7] text-[#1B5E20] rounded-xl p-4 mb-6">
          <p className="font-bold">Дякуємо! Замовлення № {order.orderNumber} прийнято.</p>
          <p className="text-sm mt-1">
            Менеджер зателефонує вам найближчим часом для підтвердження. Збережіть це посилання —
            за ним ви бачитимете статус замовлення.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-bk">Замовлення № {order.orderNumber}</h1>
        <span className={`px-4 py-2 rounded-full text-sm font-medium ${ORDER_STATUS_COLORS[order.status]}`}>
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>

      <div className="mb-6">
        <OrderStatusProgress status={order.status} />
      </div>

      <div className="bg-white border border-g200 rounded-xl overflow-hidden mb-6">
        <div className="p-4 bg-g50 border-b border-g200 text-sm text-g500 space-y-1">
          <p>Оформлено: {formatDate(order.createdAt)}</p>
          <p>
            {DELIVERY_METHOD_LABELS[order.deliveryMethod]}
            {where && order.deliveryMethod === "DELIVERY" ? `: ${where}` : ""}
          </p>
          <p>{PAYMENT_METHOD_LABELS[order.paymentMethod]}</p>
          <p>
            {order.contactName} · {order.phone}
          </p>
          {order.comment && <p>Коментар: {order.comment}</p>}
        </div>
        <div className="divide-y divide-g200">
          {order.items.map((item) => (
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
        <div className="p-4 bg-g50 border-t border-g200 flex justify-between text-lg font-bold">
          <span>Всього</span>
          <span className="text-bk">{formatPrice(order.totalAmount)}</span>
        </div>
      </div>

      <div className="text-center">
        <Link href="/catalog" className="btn-primary inline-block px-6 py-3 text-sm">
          Продовжити покупки
        </Link>
      </div>
    </div>
  );
}
