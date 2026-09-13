"use client";

import Link from "next/link";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { Page } from "@/components/cabinet/ui";
import { SalesHeader } from "@/components/sales/SalesHeader";
import type { WatchItem } from "@/lib/rep-feed/watches";

/**
 * «Мої запити на товар»: на що торговий чекає і що вже приїхало.
 *
 * Сюди веде пуш «Приїхало під ваш запит». Підписка ставиться дзвіночком
 * біля відсутньої позиції в каталозі; тут її можна зняти. Залишок —
 * станом на зараз.
 */

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data as { items: WatchItem[] };
  });

function date(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit" });
}

export default function WatchesScreen() {
  const { data, error, isLoading, mutate } = useSWR("/api/sales/watches", fetcher);
  const items = data?.items ?? [];
  const waiting = items.filter((i) => !i.arrivedAt);
  const arrived = items.filter((i) => i.arrivedAt);

  const remove = async (productId: string) => {
    await fetch(`/api/sales/watches?productId=${encodeURIComponent(productId)}`, { method: "DELETE" });
    await mutate();
  };

  const row = (i: WatchItem) => (
    <li key={i.productId} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
      <span className="min-w-0 flex-1">
        <Link
          href={i.sku ? `/sales/catalog/list?search=${encodeURIComponent(i.sku)}` : "/sales/catalog"}
          className="block text-[14px] font-semibold leading-snug text-bk active:opacity-70"
        >
          {i.name}
        </Link>
        <span className="block text-xs text-cab-t2">
          {i.sku ? `Арт. ${i.sku} · ` : ""}
          {i.arrivedAt ? `приїхало ${date(i.arrivedAt)} · вільно ${i.freeStock} шт` : `чекаю з ${date(i.createdAt)}`}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void remove(i.productId)}
        className="shrink-0 rounded-full border border-cab-line px-2.5 py-1 text-[11px] font-semibold text-cab-t2 active:opacity-70"
      >
        Прибрати
      </button>
    </li>
  );

  return (
    <>
      <SalesHeader title="Запити на товар" subtitle="Повідомлю, коли приїде" backTo="/sales/feed" />
      <Page>
        {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}

        {!isLoading && !error && items.length === 0 && (
          <Card>
            <EmptyState
              title="Запитів ще немає"
              hint="У каталозі біля позиції, якої немає на складі, натисніть «Коли буде». Щойно вона з'явиться у вільному залишку, прийде сповіщення."
            />
          </Card>
        )}

        {waiting.length > 0 && (
          <Card padded={false}>
            <div className="px-4 pt-3.5 pb-1 sm:px-5">
              <h2 className="text-sm font-semibold text-bk">Чекаю · {waiting.length}</h2>
            </div>
            <ul className="divide-y divide-cab-line">{waiting.map(row)}</ul>
          </Card>
        )}

        {arrived.length > 0 && (
          <Card padded={false}>
            <div className="px-4 pt-3.5 pb-1 sm:px-5">
              <h2 className="text-sm font-semibold text-bk">Приїхало · {arrived.length}</h2>
            </div>
            <ul className="divide-y divide-cab-line">{arrived.map(row)}</ul>
          </Card>
        )}
      </Page>
    </>
  );
}
