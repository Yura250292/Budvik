"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate, formatDocDate } from "@/lib/utils";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { isRealSku } from "@/lib/catalog/sku-search";
import { Body, Card, Note, Page, Tile, TileRow } from "@/components/cabinet/ui";
import { TAB_BAR_SPACE } from "@/components/cabinet/TabBar";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_LABELS: Record<string, string> = { DRAFT: "Чернетка", CONFIRMED: "Підтверджено", CANCELLED: "Скасовано" };
const STATUS_BG: Record<string, string> = { DRAFT: "#FFF7ED", CONFIRMED: "#F0FDF4", CANCELLED: "#FEF2F2" };
const STATUS_COLOR: Record<string, string> = { DRAFT: "#D97706", CONFIRMED: "#16A34A", CANCELLED: "#DC2626" };

export default function SalesOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDoc = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/erp/sales/${id}`);
      if (res.ok) {
        setDoc(await res.json());
      } else {
        router.push("/sales/orders");
      }
    } catch {
      router.push("/sales/orders");
    }
    setLoading(false);
  }, [id, router]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  const handleConfirm = async () => {
    if (!confirm("Підтвердити продаж?\nЗалишки будуть зменшені, комісії нараховані.")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/erp/sales/${id}/confirm`, { method: "POST" });
      if (res.ok) {
        fetchDoc();
      } else {
        const err = await res.json();
        alert(err.error || "Помилка підтвердження");
      }
    } catch {
      alert("Мережева помилка");
    }
    setActionLoading(false);
  };

  const handleCancel = async () => {
    if (!confirm("Скасувати документ?")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/erp/sales/${id}/cancel`, { method: "POST" });
      if (res.ok) {
        fetchDoc();
      } else {
        const err = await res.json();
        alert(err.error || "Помилка скасування");
      }
    } catch {
      alert("Мережева помилка");
    }
    setActionLoading(false);
  };

  // Роль-гейт живе в SalesGate на рівні секції (src/app/sales/layout.tsx).

  if (loading) {
    return (
      <Page>
        <Card>
          <Body>Завантаження…</Body>
        </Card>
      </Page>
    );
  }

  if (!doc) return null;

  const totalCost = doc.items?.reduce((s: number, i: any) => s + i.quantity * i.purchasePrice, 0) || 0;
  const totalProfit = doc.totalAmount - totalCost;

  /**
   * Чи взагалі є з чого рахувати маржу.
   *
   * У замовленнях собівартості немає ніколи: 1С віддає її регістром
   * ПродажиСебестоимость, а той пише лише на реалізацію. Формула
   * «сума − нуль» показувала весь оборот як прибуток — 7 675,52 грн
   * прибутку при 7 675,52 грн виручки і маржа 0%. Число неправильне не
   * трохи, а повністю, тож замість нього краще не показувати нічого.
   */
  const hasCost = totalCost > 0;

  // Документ із 1С підтвердити чи скасувати на сайті не можна: там свій
  // цикл проведення, і наше «Підтвердити» лише розвело б дві бази. Кнопки
  // лишаються тільки для документів, набраних тут.
  const fromOneC = !!doc.externalId;
  const isDraft = doc.status === "DRAFT" && !fromOneC;
  const unpostedInOneC = doc.status === "DRAFT" && fromOneC;

  return (
    <>
      <SalesHeader
        title={doc.number}
        subtitle={fromOneC ? formatDocDate(doc.createdAt) : formatDate(doc.createdAt)}
        backTo="/sales/orders"
        sticky
        right={
          <span
            className="rounded-lg px-2.5 py-1 text-xs font-semibold"
            style={{ background: STATUS_BG[doc.status], color: STATUS_COLOR[doc.status] }}
          >
            {unpostedInOneC ? "Не проведено" : STATUS_LABELS[doc.status]}
          </span>
        }
      />

      <Page className={isDraft ? "pb-24" : undefined}>
        {/* Підсумок. Прибуток і маржа — лише там, де приїхала собівартість,
            тобто на реалізаціях: у замовленнях 1С її не віддає ніколи, і
            «сума мінус нуль» показувала весь оборот як прибуток. */}
        <TileRow>
          <Tile label="Сума" value={formatPrice(doc.totalAmount)} />
          {hasCost ? (
            <>
              <Tile
                label="Прибуток"
                value={formatPrice(totalProfit)}
                tone={totalProfit > 0 ? "ok" : "bad"}
              />
              <Tile label="Маржа" value={`${Math.round((totalProfit / totalCost) * 100)}%`} />
            </>
          ) : (
            <Tile label="Позицій" value={String(doc.items?.length || 0)} />
          )}
        </TileRow>

        {/* Непроведене замовлення з 1С: показуємо чесно, що це ще не факт. */}
        {unpostedInOneC && (
          <Card tone="warn" className="flex flex-col gap-1">
            {doc.replacedBy ? (
              <>
                <p className="text-[13px] font-semibold text-[#C2410C]">
                  Замінено документом №{doc.replacedBy.number}
                </p>
                <p className="text-xs text-[#9A3412]">
                  Проведено на {formatPrice(doc.replacedBy.totalAmount)}
                  {/* Різниця — це і є недовіз: рахувати його в голові, тримаючи
                      поруч два екрани, торговий не має. */}
                  {Math.abs(doc.totalAmount - doc.replacedBy.totalAmount) >= 0.01 && (
                    <> · недовіз {formatPrice(doc.totalAmount - doc.replacedBy.totalAmount)}</>
                  )}
                </p>
                <Link
                  href={`/sales/orders/${doc.replacedBy.id}`}
                  className="text-xs font-semibold text-[#C2410C] underline"
                >
                  Відкрити проведений документ
                </Link>
              </>
            ) : (
              <>
                <p className="text-[13px] font-semibold text-[#C2410C]">
                  Замовлення ще не проведене в 1С
                </p>
                <p className="text-xs text-[#9A3412]">
                  Кількості й сума можуть змінитись, коли офіс проведе документ під наявний залишок.
                </p>
              </>
            )}
          </Card>
        )}

        {/* Клієнт */}
        <Card className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-info-bg text-base font-semibold text-info">
              {doc.counterparty?.name?.charAt(0) || "?"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-bk">
                {doc.counterparty?.name || "Без клієнта"}
              </p>
              {!!doc.salesRep && <p className="text-xs text-cab-t3">Менеджер: {doc.salesRep.name}</p>}
            </div>
          </div>
          {!!doc.notes && (
            <p className="border-t border-[#F1F1EF] pt-2 text-[13px] text-cab-t2">{doc.notes}</p>
          )}
        </Card>

        {/* Товари */}
        <section className="overflow-hidden rounded-2xl border border-cab-line bg-white">
          <div className="border-b border-cab-line px-4 py-3">
            <p className="text-sm font-semibold text-bk">Товари ({doc.items?.length || 0})</p>
          </div>
          {doc.items?.map((item: any, idx: number) => {
            const lineTotal = item.quantity * item.sellingPrice;
            const lineProfit = (item.sellingPrice - item.purchasePrice) * item.quantity;
            const marginPct =
              item.purchasePrice > 0
                ? Math.round(((item.sellingPrice - item.purchasePrice) / item.purchasePrice) * 100)
                : 0;
            return (
              <div key={idx} className="border-b border-[#F1F1EF] px-4 py-3 last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {/* Без truncate: назви на кшталт «SIGMA Плита газова
                        одноконфор.з пєзопідпалом, плав.регул. (адаптер,
                        кейс)» обривались рівно там, де починалась відмінність
                        між схожими позиціями, і торговий не міг звірити рядок
                        з екраном 1С. */}
                    <p className="text-sm font-medium leading-snug text-bk">{item.product?.name}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-cab-t3">
                      {/* Службова заглушка «1C-74DDFD7F» для людини порожній
                          звук — у 1С у цього товару артикула просто немає. */}
                      {isRealSku(item.product?.sku) && <span>{item.product.sku}</span>}
                      {item.purchasePrice > 0 && (
                        <span className="text-cab-t2">Вхід: {formatPrice(item.purchasePrice)}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[15px] font-bold text-bk">{formatPrice(lineTotal)}</p>
                    {item.purchasePrice > 0 && (
                      <p
                        className={`text-[11px] font-semibold ${
                          lineProfit > 0 ? "text-ok-fg" : lineProfit < 0 ? "text-bad-fg" : "text-cab-t3"
                        }`}
                      >
                        {lineProfit > 0 ? "+" : ""}
                        {formatPrice(lineProfit)} ({marginPct}%)
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[13px] text-cab-t2">
                  <span>{item.quantity} шт</span>
                  <span>&times;</span>
                  <span>{formatPrice(item.sellingPrice)}</span>
                  {item.discountPercent > 0 && (
                    <span className="font-semibold text-warn">-{item.discountPercent}%</span>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* Комісії */}
        {doc.commissions && doc.commissions.length > 0 && (
          <section className="overflow-hidden rounded-2xl border border-cab-line bg-white">
            <div className="border-b border-cab-line px-4 py-3">
              <p className="text-sm font-semibold text-bk">Комісії</p>
            </div>
            {doc.commissions.map((c: any) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 border-b border-[#F1F1EF] px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-bk">{c.brand}</p>
                  <p className="text-xs text-cab-t3">Ставка: {c.commissionRate}%</p>
                </div>
                <p className="shrink-0 text-base font-bold text-warn">
                  {formatPrice(c.commissionAmount)}
                </p>
              </div>
            ))}
          </section>
        )}

        {doc.status === "CONFIRMED" && (
          <Card tone="ok" className="text-center">
            <p className="text-[15px] font-semibold text-ok-fg">Документ підтверджено</p>
            <Note>{fromOneC ? formatDocDate(doc.confirmedAt) : formatDate(doc.confirmedAt)}</Note>
          </Card>
        )}

        {doc.status === "CANCELLED" && (
          <Card tone="bad" className="text-center">
            <p className="text-[15px] font-semibold text-bad-fg">Документ скасовано</p>
          </Card>
        )}
      </Page>

      {/* Смуга дій для чернетки — над плаваючою капсулою меню, а не під нею. */}
      {isDraft && (
        <div
          className="fixed inset-x-0 z-40 border-t border-white/10 px-4 py-3"
          style={{
            bottom: TAB_BAR_SPACE,
            background: "linear-gradient(135deg, #0A0A0A, #1C1C1C)",
          }}
        >
          <div className="mx-auto flex max-w-lg gap-3">
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="h-12 flex-1 rounded-xl border border-white/10 bg-white/5 text-[15px] font-semibold text-white/60 disabled:opacity-50"
            >
              Скасувати
            </button>
            <button
              onClick={handleConfirm}
              disabled={actionLoading}
              className="h-12 flex-[2] rounded-xl bg-ok text-base font-bold text-white disabled:opacity-50"
            >
              {actionLoading ? "Підтверджую…" : "Підтвердити продаж"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
