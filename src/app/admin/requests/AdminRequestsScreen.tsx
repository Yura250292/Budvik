"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { RequestRow } from "@/lib/office-requests";

/**
 * Заявки торгових для офісу: відкриті зверху, закрити з відповіддю.
 *
 * Виконання — у 1С руками (сайт туди не пише). Тут офіс лише каже торговому
 * «зроблено» або «відхилено, бо…» — і торговий отримує це сповіщенням, а не
 * дзвонить вдруге перепитати.
 */

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data as { items: RequestRow[] };
  });

const FILTERS = [
  { key: "OPEN", label: "Відкриті" },
  { key: "DONE", label: "Виконані" },
  { key: "REJECTED", label: "Відхилені" },
  { key: "", label: "Усі" },
] as const;

const CHIP = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
    active ? "border-bk bg-bk text-white" : "border-g200 bg-white text-g600 hover:bg-g50"
  }`;

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function AdminRequestsScreen() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";
  const [status, setStatus] = useState<string>("OPEN");
  const { data, error, isLoading, mutate } = useSWR(`/api/admin/requests${status ? `?status=${status}` : ""}`, fetcher);

  const items = data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold leading-tight text-bk">Заявки торгових</h1>
        <p className="mt-0.5 text-[13px] text-g500">
          Завести клієнта, змінити дані, відстрочка — те, що раніше йшло дзвінком. Виконується в 1С вручну; тут
          позначте результат, і торговий отримає сповіщення.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key || "all"} type="button" className={CHIP(status === f.key)} onClick={() => setStatus(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}

      {!isLoading && !error && items.length === 0 && (
        <Card>
          <EmptyState title={status === "OPEN" ? "Відкритих заявок немає" : "Заявок немає"} />
        </Card>
      )}

      {items.map((r) => (
        <RequestCard key={r.id} r={r} isAdmin={isAdmin} onChanged={() => void mutate()} />
      ))}
    </div>
  );
}

function RequestCard({ r, isAdmin, onChanged }: { r: RequestRow; isAdmin: boolean; onChanged: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const close = async (status: "DONE" | "REJECTED") => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/requests/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, answer }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-bk">{r.kindLabel}</span>
          <span className="text-[12px] text-g500">
            {r.author.name} · {when(r.createdAt)} · {r.statusLabel}
          </span>
        </div>
        {r.counterparty &&
          (isAdmin ? (
            <Link href={`/sales/clients/${r.counterparty.id}`} className="text-[13px] font-medium text-bk underline underline-offset-2">
              {r.counterparty.name}
            </Link>
          ) : (
            <span className="text-[13px] font-medium text-bk">{r.counterparty.name}</span>
          ))}
        <p className="whitespace-pre-wrap text-[13px] text-g600">{r.text}</p>
        {r.answer && (
          <p className="whitespace-pre-wrap rounded-lg bg-g50 px-3 py-2 text-[13px] text-bk">
            {r.doneBy?.name ?? "Офіс"}: {r.answer}
          </p>
        )}
        {r.status === "OPEN" && (
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Відповідь торговому (обов'язково, якщо відхиляєте)"
              className="w-full rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-[13px] text-bk"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void close("DONE")}
                className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                Виконано
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void close("REJECTED")}
                className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-4 py-2 text-[13px] font-semibold text-g600 hover:bg-g50 disabled:opacity-50"
              >
                Відхилити
              </button>
            </div>
            {err && <p className="text-[12px] text-red-700">{err}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
