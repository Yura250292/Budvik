"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { FeedRow, groupByDay, useFeedPages } from "@/components/feed/FeedList";
import { ADMIN_FEED_SEEN_EVENT, FEED_FILTERS } from "@/lib/rep-feed/types";
import AdminFeedPushPrefs from "./AdminFeedPushPrefs";
import { adminNotificationHref } from "@/lib/notifications/href";

/**
 * Стрічка подій усієї команди — те саме, що торгові бачать у себе, але
 * разом і з іменем біля кожного рядка.
 *
 * Навіщо керівникові. Дашборд показує суми, а тут видно, що відбувається
 * просто зараз: хто з клієнтів заплатив, які накладні провели й зібрали, у
 * кого повернення, біля кого стоїть торговий. Пушів керівник типово не
 * отримує — вмикає сам потрібні категорії (AdminFeedPushPrefs). Нове з
 * минулого відкриття підсвічене; скільки його — цифра в меню.
 *
 * Посилання: документ — у картку продажу адмінки; клієнт — у картку
 * кабінету торгового, куди пускають лише ADMIN (MANAGER туди не пройде,
 * тож у нього рядок без переходу).
 */

type Rep = { id: string; name: string };

const CHIP = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
    active ? "border-bk bg-bk text-white" : "border-g200 bg-white text-g600 hover:bg-g50"
  }`;

export default function AdminFeedScreen() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";

  const [filter, setFilter] = useState<string>("all");
  const [repId, setRepId] = useState<string>("");
  const url = `/api/admin/feed?filter=${filter}${repId ? `&repId=${encodeURIComponent(repId)}` : ""}`;
  const feed = useFeedPages(url);
  const reps = (feed.extra.reps as Rep[] | undefined) ?? [];

  const groups = groupByDay(feed.rows);

  /**
   * Позначка минулого перегляду — з першої відповіді й більше не
   * міняється: сервер на кожній першій сторінці ставить нову, і після
   * перемикання фільтра підсвітка інакше зникала б.
   */
  const [seenAt, setSeenAt] = useState<string | null | undefined>(undefined);
  if (seenAt === undefined && "seenAt" in feed.extra) setSeenAt((feed.extra.seenAt as string | null) ?? null);
  useEffect(() => {
    if (seenAt !== undefined) window.dispatchEvent(new Event(ADMIN_FEED_SEEN_EVENT));
  }, [seenAt]);
  // Хто відкрив уперше — без підсвітки: «нове» тоді означало б «усе».
  const isNew = (createdAt: string) => typeof seenAt === "string" && createdAt > seenAt;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold leading-tight text-bk">Стрічка подій</h1>
        <p className="mt-0.5 text-[13px] text-g500">
          Оплати клієнтів, проведені й зібрані накладні, повернення, візити й списки дзвінків по всіх
          торгових. Те саме кожен торговий бачить у себе і отримує пушем.
        </p>
      </div>

      <AdminFeedPushPrefs />

      <div className="flex flex-wrap items-center gap-2">
        {FEED_FILTERS.map((f) => (
          <button key={f.key} type="button" className={CHIP(filter === f.key)} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
        <select
          value={repId}
          onChange={(e) => setRepId(e.target.value)}
          className="ml-auto rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-[13px] text-bk"
          aria-label="Торговий"
        >
          <option value="">Усі торгові</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {feed.error && <ErrorBox message={feed.error} onRetry={feed.reload} />}

      {!feed.loading && !feed.error && feed.rows.length === 0 && (
        <Card>
          <EmptyState
            title="Подій ще немає"
            hint="Стрічка пишеться з 13.09.2026. Події з'являються, коли з 1С приходять оплати й накладні, склад збирає замовлення або торговий зупиняється біля клієнта. У вихідні зазвичай порожньо."
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
                <FeedRow
                  row={{ ...row, isRead: !isNew(row.createdAt) }}
                  href={adminNotificationHref(row, isAdmin)}
                  rep={row.rep?.name ?? null}
                />
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
          className="w-full cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white py-2.5 text-sm font-semibold text-bk hover:bg-g50 disabled:opacity-50"
        >
          {feed.loading ? "Завантажую…" : "Показати ще"}
        </button>
      )}
    </div>
  );
}
