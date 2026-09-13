"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { Page } from "@/components/cabinet/ui";
import { SalesHeader } from "@/components/sales/SalesHeader";
import type { ArrivalItem } from "@/lib/rep-feed/arrivals";

/**
 * «Що приїхало для моїх клієнтів» за день.
 *
 * Сюди веде пуш о 10:00 і рядок «Приїхало…» у стрічці. На кожну позицію —
 * скільки приїхало, скільки зараз вільно і хто з клієнтів торгового це
 * брав (найсвіжіші першими), з переходом на картку клієнта. Позиція
 * відкривається в каталозі пошуком за артикулом — окремої картки товару в
 * кабінеті немає.
 *
 * Дати вікна приходять стінним київським часом, записаним як UTC (так
 * лежать дати 1С), тож форматуються з timeZone UTC.
 */

type Payload = { day: string; from: string; to: string; items: ArrivalItem[] };

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data as Payload;
  });

function wall(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ago(iso: string): string {
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return "сьогодні";
  if (days === 1) return "вчора";
  return `${days} дн тому`;
}

export default function ArrivalsScreen() {
  const { day } = useParams<{ day: string }>();
  const back = `/sales/arrivals/${day}`;
  const { data, error, isLoading, mutate } = useSWR<Payload>(`/api/sales/arrivals/${day}`, fetcher);

  return (
    <>
      <SalesHeader
        title="Прихід"
        subtitle={data ? `${wall(data.from)} — ${wall(data.to)}` : "Для ваших клієнтів"}
        backTo="/sales/feed"
      />
      <Page>
        <p className="-mt-1 text-[12px] leading-relaxed text-cab-t3">
          Лише те, що за останні пів року брали ваші клієнти і що зараз є у вільному залишку. Залишок —
          станом на зараз.
        </p>

        {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}

        {!isLoading && !error && data && data.items.length === 0 && (
          <Card>
            <EmptyState
              title="Для ваших клієнтів нічого не приїхало"
              hint="Або в цей день приходу не було, або те, що приїхало, ваші клієнти не брали, або воно вже розійшлося."
            />
          </Card>
        )}

        {data?.items.map((item) => (
          <Card key={item.productId} padded={false}>
            <div className="px-4 pt-3.5 sm:px-5">
              <Link
                href={item.sku ? `/sales/catalog/list?search=${encodeURIComponent(item.sku)}` : "/sales/catalog"}
                className="block text-[15px] font-semibold leading-snug text-bk active:opacity-70"
              >
                {item.name}
              </Link>
              <p className="mt-0.5 text-xs text-cab-t2">
                {item.sku ? `${item.sku} · ` : ""}приїхало {item.arrivedQty} шт · вільно {item.freeStock} шт
              </p>
            </div>
            <ul className="mt-2 divide-y divide-cab-line border-t border-cab-line">
              {item.clients.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/sales/clients/${c.id}?back=${encodeURIComponent(back)}`}
                    className="flex items-center gap-3 px-4 py-2 text-[13px] active:opacity-70 sm:px-5"
                  >
                    <span className="min-w-0 flex-1 truncate text-bk">{c.name}</span>
                    <span className="shrink-0 text-[11px] text-cab-t3">брав {ago(c.lastAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </Page>
    </>
  );
}
