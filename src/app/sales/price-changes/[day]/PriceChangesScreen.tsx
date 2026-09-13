"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { Page } from "@/components/cabinet/ui";
import { SalesHeader } from "@/components/sales/SalesHeader";
import type { PriceChangeItem } from "@/lib/rep-feed/price-changes";

/**
 * «Що подорожчало для моїх клієнтів» за ранок.
 *
 * Сюди веде ранковий пуш і рядок «Подорожчало…» у стрічці. На кожну позицію —
 * стара й нова ціна (опт, якщо він є з обох боків), відсоток і хто з
 * клієнтів торгового це брав. Попередити клієнта до візиту — дешевше, ніж
 * пояснювати різницю в накладній.
 */

type Payload = { day: string; from: string; to: string; items: PriceChangeItem[] };

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data as Payload;
  });

const uah = (n: number) => n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function kyiv(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
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

export default function PriceChangesScreen() {
  const { day } = useParams<{ day: string }>();
  const back = `/sales/price-changes/${day}`;
  const { data, error, isLoading, mutate } = useSWR<Payload>(`/api/sales/price-changes/${day}`, fetcher);

  return (
    <>
      <SalesHeader
        title="Подорожчання"
        subtitle={data ? `${kyiv(data.from)} — ${kyiv(data.to)}` : "Для ваших клієнтів"}
        backTo="/sales/feed"
      />
      <Page>
        <p className="-mt-1 text-[12px] leading-relaxed text-cab-t3">
          Лише позиції, що подорожчали від 3%, і лише ті, які за пів року брали ваші клієнти. Порівнюється
          оптова ціна, а якщо її немає — роздрібна.
        </p>

        {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}

        {!isLoading && !error && data && data.items.length === 0 && (
          <Card>
            <EmptyState
              title="Для ваших клієнтів нічого не подорожчало"
              hint="Або цін не змінювали, або зміни менші за 3%, або ці позиції ваші клієнти не брали."
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
                {item.basis === "wholesale" ? "опт" : "ціна"} {uah(item.oldValue)} → {uah(item.newValue)} ₴{" "}
                <span className="font-semibold text-bad-fg">+{Math.round(item.pct)}%</span>
                {item.sku ? ` · Арт. ${item.sku}` : ""}
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
