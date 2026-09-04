"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Banknote,
  ChevronRight,
  CircleDollarSign,
  ImageIcon,
  MapPin,
  Package,
  Phone,
  Star,
  User,
} from "lucide-react";
import { formatPrice, formatDate } from "@/lib/utils";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { Body, Card, Note, Page } from "@/components/cabinet/ui";
import { Section, SectionRow } from "@/components/sales/ClientSection";
import ClientMemorySection from "@/components/sales/ClientMemorySection";

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Створено", CONFIRMED: "Підтверджено", PACKING: "На упакуванні",
  IN_TRANSIT: "В дорозі", DELIVERED: "Доставлено", CANCELLED: "Скасовано",
};
const STATUS_BG: Record<string, string> = {
  DRAFT: "#FFF7ED", CONFIRMED: "#EFF6FF", PACKING: "#FDF4FF",
  IN_TRANSIT: "#FFFBEB", DELIVERED: "#F0FDF4", CANCELLED: "#FEF2F2",
};
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "#D97706", CONFIRMED: "#2563EB", PACKING: "#9333EA",
  IN_TRANSIT: "#D97706", DELIVERED: "#16A34A", CANCELLED: "#DC2626",
};

/** Квадратик під іконку контакту: колір каже про стан, а не про тип. */
function Tile({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
      style={{ background: bg }}
    >
      {children}
    </span>
  );
}

/** Мініатюра товару — з тим самим заповнювачем, коли фото немає. */
function Thumb({ src, size = 44 }: { src?: string | null; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-cab-line bg-cab-bg"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon size={size > 30 ? 20 : 14} className="text-[#C9C9C6]" />
      )}
    </span>
  );
}

export default function ClientDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    fetch(`/api/erp/counterparties/${id}/summary`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [session, id]);

  if (loading) {
    return (
      <Page>
        <Card>
          <Body>Завантаження…</Body>
        </Card>
      </Page>
    );
  }
  if (!data?.counterparty) {
    return (
      <Page>
        <Card tone="warn">
          <Body>Клієнта не знайдено.</Body>
        </Card>
      </Page>
    );
  }

  const { counterparty: cp, debt, sales, topProducts = [], payments = [], returns } = data;

  return (
    <>
      <SalesHeader
        title={cp.name}
        subtitle={cp.code ? `ЄДРПОУ: ${cp.code}` : undefined}
        backTo="/sales/clients"
        sticky
      />

      <Page>
        {/* Контакти */}
        <section className="overflow-hidden rounded-2xl border border-cab-line bg-white">
          {!!cp.phone && (
            <a href={`tel:${cp.phone}`} className="flex items-center gap-3 px-4 py-2.5">
              <Tile bg="#EFF6FF">
                <Phone size={18} color="#3B82F6" />
              </Tile>
              <span className="text-[15px] font-medium text-bk">{cp.phone}</span>
            </a>
          )}

          {/* Точка на карті. Рядок клікабельний завжди, навіть без адреси:
              саме такому клієнту пін потрібен найбільше. Позначка каже,
              чи точку вже уточнили руками, чи там досі здогадка геокодера. */}
          <Link
            href={`/sales/clients/${id}/pin`}
            className="flex items-center gap-3 border-t border-[#F1F1EF] px-4 py-2.5"
          >
            <Tile bg={cp.geoSource === "MANUAL" ? "#ECFDF5" : "#FFF7ED"}>
              <MapPin size={18} color={cp.geoSource === "MANUAL" ? "#059669" : "#D97706"} />
            </Tile>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-bk">
                {cp.address || "Адреси немає"}
              </span>
              <span
                className={`block text-xs font-medium ${
                  cp.geoSource === "MANUAL" ? "text-ok-fg" : "text-warn-fg"
                }`}
              >
                {cp.geoSource === "MANUAL"
                  ? "Точку уточнено"
                  : cp.deliveryLat != null
                    ? "Точка приблизна — уточнити"
                    : "Точки на карті немає — поставити"}
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-cab-t3" />
          </Link>

          {!!cp.contactPerson && (
            <div className="flex items-center gap-3 border-t border-[#F1F1EF] px-4 py-2.5">
              <Tile bg="#F1F1EF">
                <User size={18} className="text-cab-t2" />
              </Tile>
              <span className="text-[15px] font-medium text-bk">{cp.contactPerson}</span>
            </div>
          )}
        </section>

        {/* Борг. Це перше, з чим торговий заходить у магазин, тому картка
            кольорова лише коли борг є — інакше вона кричала б щодня. */}
        <div
          className={`rounded-2xl border p-4 ${
            debt.total > 0 ? "border-bad-line bg-bad-bg" : "border-cab-line bg-white"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <Tile bg={debt.total > 0 ? "#FEE2E2" : "#F1F1EF"}>
                <Banknote size={18} className={debt.total > 0 ? "text-bad" : "text-cab-t3"} />
              </Tile>
              <span className={`text-sm font-semibold ${debt.total > 0 ? "text-bad-fg" : "text-cab-t2"}`}>
                Заборгованість
              </span>
            </span>
            <span className={`text-2xl font-bold ${debt.total > 0 ? "text-bad-fg" : "text-ok-fg"}`}>
              {formatPrice(debt.total)}
            </span>
          </div>
          <Note>
            {debt.syncedAt ? `За даними 1С, оновлено ${formatDate(debt.syncedAt)}` : "За даними 1С"}
          </Note>
        </div>

        {/* Памʼять про клієнта — одразу під боргом: обидва блоки про те,
            як із цією точкою працювати, а не скільки вона купила. */}
        <ClientMemorySection counterpartyId={id} clientName={cp.name} />

        {/* Оплати — ПКО з 1С, які зменшують борг вище */}
        <Section
          title="Останні оплати"
          icon={<CircleDollarSign size={18} className="text-ok" />}
          right={
            payments.length > 0 ? (
              <span className="shrink-0 text-[13px] font-semibold text-cab-t2">
                {payments.length} за 30 днів
              </span>
            ) : undefined
          }
        >
          {payments.length === 0 ? (
            <div className="px-4 py-3">
              <Body>Оплат поки не зафіксовано</Body>
            </div>
          ) : (
            payments.map((p: any) => (
              <SectionRow key={p.id}>
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-bk">
                      {formatDate(p.paidAt || p.createdAt)}
                    </span>
                    <span className="block truncate text-[11px] text-cab-t3">
                      {p.notes || (p.method === "cash" ? "Готівка" : "Безготівково")}
                    </span>
                  </span>
                  <span className="shrink-0 text-[15px] font-bold text-ok-fg">
                    {formatPrice(p.amount)}
                  </span>
                </span>
              </SectionRow>
            ))
          )}
        </Section>

        {/* Найчастіші товари */}
        {topProducts.length > 0 && (
          <Section title="Найчастіші товари" icon={<Star size={18} className="text-warn" />}>
            {topProducts.map((tp: any) => (
              <SectionRow key={tp.product.id}>
                <span className="flex items-center gap-3">
                  <Thumb src={tp.product.image} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-bk">
                      {tp.product.name}
                    </span>
                    <span className="block truncate text-xs text-cab-t3">
                      {tp.totalQuantity} шт / {tp.orderCount} зам.
                      {tp.product.sku ? ` · ${tp.product.sku}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold text-bk">
                      {formatPrice(tp.product.price)}
                    </span>
                    <span
                      className={`block text-[11px] font-medium ${
                        tp.product.stock > 0 ? "text-ok-fg" : "text-bad-fg"
                      }`}
                    >
                      {tp.product.stock > 0 ? `є ${tp.product.stock} шт` : "Немає"}
                    </span>
                  </span>
                </span>
              </SectionRow>
            ))}
          </Section>
        )}

        {/* Замовлення */}
        <Section
          title="Останні замовлення"
          right={
            <span className="shrink-0 text-[13px] font-semibold text-cab-t2">
              {sales.count} підтв. / {formatPrice(sales.totalAmount)}
            </span>
          }
        >
          {sales.items.length === 0 ? (
            <div className="px-4 py-5 text-center">
              <Body>Замовлень поки немає</Body>
            </div>
          ) : (
            sales.items.slice(0, 10).map((s: any) => (
              <SectionRow key={s.id} href={`/sales/orders/${s.id}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-sm font-semibold text-bk">{s.number}</span>
                    <span
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                      style={{ background: STATUS_BG[s.status], color: STATUS_COLOR[s.status] }}
                    >
                      {STATUS_LABELS[s.status]}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[15px] font-bold text-bk">
                      {formatPrice(s.totalAmount)}
                    </span>
                    <span className="block text-[11px] text-cab-t3">{formatDate(s.createdAt)}</span>
                  </span>
                </span>

                {/* Мініатюри позицій: за ними документ упізнають швидше, ніж
                    за номером — торговий пам'ятає, що возив, а не № 000512. */}
                {!!s.items?.length && (
                  <span className="mt-1.5 flex flex-wrap gap-2">
                    {s.items.slice(0, 4).map((item: any) => (
                      <span key={item.id} className="flex min-w-0 max-w-[45%] items-center gap-1.5">
                        <Thumb src={item.product?.image} size={28} />
                        <span className="truncate text-[11px] text-cab-t2">
                          {item.quantity}x {item.product?.name}
                        </span>
                      </span>
                    ))}
                    {s.items.length > 4 && (
                      <span className="self-center text-[11px] text-cab-t3">
                        +{s.items.length - 4}
                      </span>
                    )}
                  </span>
                )}
              </SectionRow>
            ))
          )}
        </Section>

        {/*
          Повернення. Блок показується лише коли вони є: у більшості клієнтів
          повернень немає взагалі, і порожня картка «0 ₴» лише додавала б шуму
          на телефоні. Суми приходять з API вже додатними (у базі від'ємні).
        */}
        {returns && returns.count > 0 && (
          <Section
            title="Повернення"
            tone="bad"
            icon={<Package size={18} className="text-bad" />}
            right={
              <span className="shrink-0 text-[13px] font-semibold text-bad-fg">
                {returns.count} шт / −{formatPrice(returns.totalAmount)}
              </span>
            }
          >
            {returns.items.slice(0, 10).map((r: any) => (
              <SectionRow key={r.id}>
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-bk">{r.number}</span>
                    {!!r.items?.length && (
                      <span className="block truncate text-[11px] text-cab-t2">
                        {r.items.map((i: any) => `${i.quantity}x ${i.product?.name ?? "—"}`).join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[15px] font-bold text-bad-fg">
                      −{formatPrice(r.totalAmount)}
                    </span>
                    <span className="block text-[11px] text-cab-t3">{formatDate(r.createdAt)}</span>
                  </span>
                </span>
              </SectionRow>
            ))}
          </Section>
        )}

        {/*
          Кнопка «Нове замовлення» прибрана разом з рештою входів у
          /sales/new: торгові поки не оформлюють замовлення через
          застосунок. Сторінка на місці — повернути можна одним комітом.
        */}
      </Page>
    </>
  );
}
