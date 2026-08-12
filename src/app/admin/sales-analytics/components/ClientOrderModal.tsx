"use client";

import { useEffect } from "react";
import { Badge, ColorDot } from "@/components/ui/Badge";
import { money } from "@/components/ui/Stat";
import { CLIENT_STATE } from "@/lib/analytics/colors";
import type { LastOrder, RecoReason, Recommendation } from "@/lib/analytics/clientOrder";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

/**
 * Що клієнт брав минулого разу і що йому запропонувати.
 *
 * Окремою панеллю, а не всередині попапа карти: попап — рядок HTML шириною
 * 280 px, у який не влізе ні список позицій, ні поради, а головне — дані
 * сюди вантажаться по кліку, і всередині рядкового шаблону довелося б
 * вручну відтворювати стани завантаження й помилки.
 *
 * Панель відділена від обгортки-модалки навмисно: та сама панель має
 * стати в картку клієнта на мобільній карті торгового без змін.
 */

type Payload = {
  client: { id: string; name: string };
  orders: LastOrder[];
  recommendations: Recommendation[];
  source: string;
};

const dt = new Intl.DateTimeFormat("uk-UA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const REASON_TITLE: Record<RecoReason, string> = {
  REPLENISH: "Пора повторити",
  DROPPED: "Перестав брати",
  SIMILAR_CLIENTS: "Беруть схожі клієнти",
};

/** Порядок такий самий, як у recommendations() — інакше секції стрибали б. */
const REASON_SEQUENCE: RecoReason[] = ["REPLENISH", "DROPPED", "SIMILAR_CLIENTS"];

function OrderCard({ order, open }: { order: LastOrder; open: boolean }) {
  const isReturn = order.docType === "RETURN";
  // Знижку на документ 1С у позиції не розкладає, тож сума позицій може не
  // збігатися з сумою документа. Показуємо обидві, коли розходяться, — інакше
  // виглядало б як помилка в розрахунку.
  const mismatch = Math.abs(order.itemsAmount - order.totalAmount) > 1;

  return (
    <details open={open} className="group rounded-[var(--radius-card)] border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 text-gr transition-transform group-open:rotate-90">›</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-bk">№ {order.number}</span>
            {isReturn && <Badge status="bad">Повернення</Badge>}
          </span>
          <span className="mt-0.5 block text-xs text-gr">
            {dt.format(new Date(order.createdAt))} ·{" "}
            {order.daysAgo === 0 ? "сьогодні" : `${order.daysAgo} дн. тому`} ·{" "}
            {order.items.length} поз.
          </span>
        </span>
        <span className={`shrink-0 text-sm font-semibold ${isReturn ? "text-rd" : "text-bk"}`}>
          {money(order.totalAmount)} ₴
        </span>
      </summary>

      <div className="border-t border-line px-3 py-2">
        {order.items.length === 0 ? (
          <p className="text-xs text-gr">
            Позиції не прийшли з 1С — товар документа не знайшовся в каталозі.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {order.items.map((i) => (
              <li key={`${order.id}:${i.productId}`} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5">
                  <ColorDot color={i.brandColor ?? "#9E9E9E"} size={8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-bk" title={i.name}>
                    {i.name}
                  </span>
                  {(i.brand || i.sku) && (
                    <span className="block text-xs text-gr">
                      {[i.brand, i.sku].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-gr">× {i.quantity}</span>
                <span className="w-20 shrink-0 text-right text-sm text-bk">{money(i.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {mismatch && order.items.length > 0 && (
          <p className="mt-2 text-xs text-gr">
            Сума позицій {money(order.itemsAmount)} ₴ — різниця з сумою документа через знижку в 1С.
          </p>
        )}
      </div>
    </details>
  );
}

export function ClientOrderPanel({ counterpartyId }: { counterpartyId: string }) {
  const { data, loading, error, reload } = useApi<Payload>(
    `/api/admin/sales-analytics/client-order/${counterpartyId}`
  );

  if (loading && !data) return <p className="text-sm text-gr">Завантаження…</p>;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const { orders, recommendations } = data;

  return (
    <div className="space-y-4">
      <section>
        <h4 className="mb-2 text-sm font-semibold text-bk">Останні замовлення</h4>
        {orders.length === 0 ? (
          <p className="text-sm text-gr">
            Проведених документів з 1С немає — клієнт ще нічого не брав або працює лише за
            замовленнями.
          </p>
        ) : (
          <div className="space-y-2">
            {orders.map((o, idx) => (
              // Перший розгорнутий: саме по нього сюди й заходять
              <OrderCard key={o.id} order={o} open={idx === 0} />
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-line pt-3">
        <h4 className="text-sm font-semibold text-bk">Що запропонувати наступного разу</h4>
        <p className="mb-2 text-xs text-gr">
          Рахується за історією закупівель — не вгадування, під кожним рядком написано чому.
        </p>

        {recommendations.length === 0 ? (
          <p className="text-sm text-gr">
            Замало історії: щоб порадити повтор, клієнт має взяти той самий товар хоча б двічі.
          </p>
        ) : (
          <div className="space-y-3">
            {REASON_SEQUENCE.map((reason) => {
              const group = recommendations.filter((r) => r.reason === reason);
              if (!group.length) return null;
              return (
                <div key={reason}>
                  <h5 className="mb-1.5 text-xs font-medium text-gr">{REASON_TITLE[reason]}</h5>
                  <ul className="space-y-1.5">
                    {group.map((r) => (
                      <li
                        key={r.key}
                        className="flex items-start gap-2 rounded-[var(--radius-card)] border border-line px-3 py-2"
                      >
                        <span className="mt-1.5">
                          <ColorDot color={r.brandColor ?? "#9E9E9E"} size={8} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-bk" title={r.name}>
                            {r.name}
                          </span>
                          <span className="block text-xs text-gr">{r.why}</span>
                        </span>
                        {r.price != null && r.price > 0 && (
                          <span className="shrink-0 whitespace-nowrap text-sm text-bk">
                            {money(r.price)} ₴
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs text-gr">Джерело: {data.source}</p>
    </div>
  );
}

export function ClientOrderModal({
  client,
  onClose,
}: {
  client: { id: string; name: string; state?: keyof typeof CLIENT_STATE };
  onClose: () => void;
}) {
  // Esc закриває: модалка перекриває карту, тягтися до хрестика незручно.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = client.state ? CLIENT_STATE[client.state] : null;

  return (
    // Модалку відкривають і з адмінки мишею, і з телефона торгового: на
    // вузькому екрані поля зменшені, бо там кожен піксель — це видимий рядок
    // товару, а нижній відступ рахує safe-area (домашня смуга iPhone).
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-2 sm:p-4"
      onClick={onClose}
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px))" }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-[var(--radius-card)] bg-white p-3 shadow-xl sm:p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-bk">{client.name}</h3>
            {meta && (
              <span
                className="mt-1 inline-block rounded-[var(--radius-badge)] px-1.5 py-0.5 text-[11px] font-semibold text-white"
                style={{ backgroundColor: meta.color }}
              >
                {meta.label}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            // 40px — палець торгового, а не курсор: у машині тап повз
            // хрестик означає, що модалка не закривається з першого разу.
            className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-btn)] border border-line text-sm text-bk"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ClientOrderPanel counterpartyId={client.id} />
        </div>
      </div>
    </div>
  );
}
