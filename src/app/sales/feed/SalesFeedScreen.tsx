"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { Chip, Page } from "@/components/cabinet/ui";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { FeedRow, groupByDay, useFeedPages } from "@/components/feed/FeedList";
import { FEED_FILTERS, feedHref } from "@/lib/rep-feed/types";
import { hasTodayNumbers, TodayNumbers, useToday } from "../analytics/components/TodayFeed";

/**
 * Стрічка торгового — усі події його клієнтів за дні, з фільтрами.
 *
 * Блок «Сьогодні» на головній показує лише поточний день і вісім рядків;
 * тут — уся історія сторінками. Відкриття сторінки позначає рядки
 * прочитаними: дзвіночок у шапці головної гасне.
 *
 * Посилання несуть ?back=/sales/feed, щоб «назад» із картки клієнта чи
 * документа повертало сюди, а не в розділ клієнтів.
 */
export default function SalesFeedScreen() {
  const [filter, setFilter] = useState<string>("all");
  const today = useToday();
  const feed = useFeedPages(`/api/sales/feed?filter=${filter}`);

  useEffect(() => {
    fetch("/api/notifications/read-all", { method: "PATCH" }).catch(() => {});
  }, []);

  const groups = groupByDay(feed.rows);
  const withBack = (href: string | null) => (href ? `${href}?back=/sales/feed` : null);

  return (
    <>
      <SalesHeader title="Стрічка" subtitle="Події ваших клієнтів" backTo="/sales" />
      <Page>
        <Link
          href="/sales/watches"
          className="flex items-center justify-between rounded-2xl border border-cab-line bg-white px-3.5 py-3 text-[14px] font-semibold text-bk active:opacity-80"
        >
          Мої запити «Коли буде»
          <span className="text-cab-t3">→</span>
        </Link>
        {today && hasTodayNumbers(today) && (
          <Card padded={false}>
            <div className="px-4 pt-3.5 pb-1 sm:px-5">
              <h2 className="text-sm font-semibold text-bk">Сьогодні в цифрах</h2>
            </div>
            <TodayNumbers today={today} />
          </Card>
        )}

        <div className="-mx-4 overflow-x-auto px-4 pb-0.5 scrollbar-hide">
          <div className="flex w-max gap-2">
            {FEED_FILTERS.map((f) => (
              <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>

        {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

        {!feed.loading && !feed.error && feed.rows.length === 0 && (
          <Card>
            <EmptyState
              title={filter === "all" ? "Подій ще немає" : "Таких подій ще немає"}
              hint="Тут з'являються оплати ваших клієнтів, проведені й зібрані накладні, повернення, картка клієнта біля якого ви зупинились і список дзвінків об 11:00. У вихідні подій зазвичай немає."
            />
          </Card>
        )}

        {groups.map((g) => (
          <Card key={g.day} padded={false}>
            <div className="px-4 pt-3.5 pb-1 sm:px-5">
              <h2 className="text-sm font-semibold text-bk">{g.label}</h2>
            </div>
            <ul className="divide-y divide-cab-line">
              {g.rows.map((row) => (
                <li key={row.id}>
                  <FeedRow row={row} href={withBack(feedHref(row.type, row.relatedId))} />
                </li>
              ))}
            </ul>
          </Card>
        ))}

        {feed.hasMore && (
          <button
            type="button"
            onClick={() => void feed.loadMore()}
            disabled={feed.loading}
            className="w-full rounded-xl border border-cab-line bg-white py-3 text-sm font-semibold text-bk disabled:opacity-50"
          >
            {feed.loading ? "Завантажую…" : "Показати ще"}
          </button>
        )}
      </Page>
    </>
  );
}
