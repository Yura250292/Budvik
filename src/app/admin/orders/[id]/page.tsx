"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { OrderStatus } from "@prisma/client";
import {
  formatPrice,
  formatDate,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  DELIVERY_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/utils";
import { packLabel } from "@/lib/pack-qty";

const ALL_STATUSES: OrderStatus[] = [
  "PENDING",
  "PAID",
  "PACKAGING",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
];

/** Рядок «підпис — значення» з кнопкою скопіювати: адресу й телефон менеджер
 *  переносить у 1С руками, і виділяти мишею по літері — щоденна морока. */
function CopyField({ label, value, href }: { label: string; value: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-g400">{label}</p>
      <div className="flex items-start gap-2">
        {href ? (
          <a href={href} className="text-[15px] font-semibold text-bk hover:text-primary-dark break-words">
            {value}
          </a>
        ) : (
          <p className="text-[15px] font-semibold text-bk break-words">{value}</p>
        )}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Скопіювати"
          className="mt-0.5 flex-shrink-0 text-g400 transition-colors hover:text-bk print:hidden"
        >
          {copied ? (
            <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Замовлення з сайту очима менеджера: кому дзвонити, куди везти і що зібрати.
 *
 * Окрема сторінка, а не ERP-шний «Продаж — деталі»: той документ живе навколо
 * SalesDocument і про роздрібне Order не знає нічого — саме тому сповіщення
 * про нове замовлення відкривало порожню картку.
 */
export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/orders/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setOrder(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const updateStatus = async (status: OrderStatus) => {
    setSaving(true);
    const res = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) setOrder(await res.json());
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl animate-pulse px-4 py-6">
        <div className="mb-4 h-8 w-64 rounded bg-g200" />
        <div className="h-72 rounded bg-g200" />
      </div>
    );
  }

  if (!order || order.error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center">
        <p className="text-g400">Замовлення не знайдено</p>
        <Link href="/admin/orders" className="mt-3 inline-block text-sm font-medium text-primary-dark hover:underline">
          ← До списку замовлень
        </Link>
      </div>
    );
  }

  const units = order.items.reduce((s: number, i: any) => s + i.quantity, 0);
  /**
   * Залишок у базі вже зменшений цим замовленням — товар зарезервовано при
   * оформленні. Тому порівнювати його з кількістю не можна: замовили все, що
   * було, і колонка чесно показує 0, хоча збирати є що.
   *
   * Дійсний привід перевірити полицю — нуль або мінус: 1С перезаписує залишок
   * кожні 5 хв, і розбіжність означає, що товар розібрали в магазині.
   */
  const empty = order.items.filter((i: any) => i.product.stock <= 0);
  const address = [order.city, order.address].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/orders" className="text-sm font-medium text-g500 transition-colors hover:text-bk">
          ← Усі замовлення
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/admin/orders/${id}/export`}
            className="flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-g200 bg-white px-3.5 py-2 text-[13px] font-medium text-bk transition-colors hover:bg-g50"
          >
            <svg className="h-4 w-4 text-green-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            Вивантажити в Excel
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-g200 bg-white px-3.5 py-2 text-[13px] font-medium text-bk transition-colors hover:bg-g50"
          >
            <svg className="h-4 w-4 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Друк
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-bk">Замовлення № {order.orderNumber}</h1>
        <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${ORDER_STATUS_COLORS[order.status as OrderStatus]}`}>
          {ORDER_STATUS_LABELS[order.status as OrderStatus]}
        </span>
        {!order.userId && (
          <span className="rounded-full bg-g100 px-2.5 py-1 text-[11px] font-semibold text-g500">Гість</span>
        )}
        <span className="text-[13px] text-g400">{formatDate(order.createdAt)}</span>
      </div>

      {/* Кому і куди — перше, що потрібно менеджеру, щоб зателефонувати */}
      <section className="mb-4 rounded-[var(--radius-card)] border border-g200 bg-white p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CopyField label="Покупець" value={order.contactName || order.user?.name || "—"} />
          <CopyField
            label="Телефон"
            value={order.phone || order.user?.phone || ""}
            href={order.phone ? `tel:${order.phone}` : undefined}
          />
          <CopyField label="Спосіб отримання" value={DELIVERY_METHOD_LABELS[order.deliveryMethod as "DELIVERY" | "PICKUP"]} />
          {order.deliveryMethod === "DELIVERY" && <CopyField label="Адреса доставки" value={address} />}
          <CopyField label="Оплата" value={PAYMENT_METHOD_LABELS[order.paymentMethod as "COD"]} />
          {order.user?.email && <CopyField label="Email" value={order.user.email} />}
        </div>
        {order.comment && (
          <div className="mt-4 rounded-lg bg-[#FFF8E1] px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-[#B8860B]">Коментар покупця</p>
            <p className="text-[14px] text-bk">{order.comment}</p>
          </div>
        )}
      </section>

      {empty.length > 0 && (
        <div className="mb-4 rounded-[var(--radius-card)] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          <b>На складі порожньо по {empty.length} поз.</b> — перевірте полицю до комплектації: товар
          зарезервовано за цим замовленням, але облік показує нуль.
        </div>
      )}

      {/* Що зібрати */}
      <section className="mb-4 overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white">
        <div className="flex items-center justify-between border-b border-g200 px-4 py-3">
          <h2 className="font-bold text-bk">Що зібрати</h2>
          <span className="text-[13px] text-g400">
            {order.items.length} поз. · {units} од.
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-g200 bg-g50 text-left text-[12px] uppercase tracking-wide text-g500">
                <th className="w-10 px-3 py-2 font-medium">№</th>
                <th className="px-3 py-2 font-medium">Артикул</th>
                <th className="px-3 py-2 font-medium">Товар</th>
                <th className="px-3 py-2 text-right font-medium">Взяти</th>
                <th className="px-3 py-2 text-right font-medium" title="Залишок після цього замовлення">
                  Ще на складі
                </th>
                <th className="px-3 py-2 text-right font-medium">Ціна</th>
                <th className="px-3 py-2 text-right font-medium">Сума</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item: any, i: number) => {
                const short = item.product.stock <= 0;
                const pack = packLabel(item.product.packQty > 1 ? item.product.packQty : 1, item.product.name);
                return (
                  <tr key={item.id} className={`border-b border-g100 last:border-b-0 ${short ? "bg-red-50" : ""}`}>
                    <td className="px-3 py-2.5 text-g400">{i + 1}</td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-g600">{item.product.sku || "—"}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/catalog/${item.product.slug}`} target="_blank" className="font-medium text-bk hover:text-primary-dark">
                        {item.product.name}
                      </Link>
                      <div className="flex gap-2 text-[11px] text-g400">
                        {item.product.brand?.name && <span>{item.product.brand.name}</span>}
                        {pack && <span>· {pack}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-bk">{item.quantity}</td>
                    <td className={`px-3 py-2.5 text-right ${short ? "font-bold text-red-600" : "text-g500"}`}>
                      {item.product.stock}
                    </td>
                    <td className="px-3 py-2.5 text-right text-g600">{formatPrice(item.price)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-bk">
                      {formatPrice(item.price * item.quantity)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-g50 font-bold">
                <td colSpan={3} className="px-3 py-3 text-bk">РАЗОМ</td>
                <td className="px-3 py-3 text-right text-bk">{units}</td>
                <td />
                <td />
                <td className="px-3 py-3 text-right text-bk">{formatPrice(order.totalAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Передати далі по статусах */}
      <section className="rounded-[var(--radius-card)] border border-g200 bg-white p-4 sm:p-5 print:hidden">
        <h2 className="mb-3 font-bold text-bk">Передати на оформлення</h2>
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={saving || s === order.status}
              onClick={() => updateStatus(s)}
              className={`rounded-[var(--radius-btn)] px-3.5 py-2 text-[13px] font-medium transition-colors disabled:cursor-default ${
                s === order.status
                  ? "bg-bk text-white"
                  : s === "CANCELLED"
                    ? "border border-red-200 bg-white text-red-600 hover:bg-red-50"
                    : "border border-g200 bg-white text-g600 hover:border-g300 hover:bg-g50"
              }`}
            >
              {ORDER_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-g400">
          Покупець побачить новий статус у себе в кабінеті та отримає сповіщення.
          {order.status === "PENDING" && " Скасування поверне товар на склад."}
        </p>
      </section>
    </div>
  );
}
