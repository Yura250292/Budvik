"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { Chip, Note, Page, Pill } from "@/components/cabinet/ui";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { REQUEST_KINDS, type RequestRow } from "@/lib/office-requests";

/**
 * Заявки торгового в офіс: нова заявка й статус попередніх.
 *
 * З картки клієнта сюди приходять з ?client=<id>&name=<назва> — заявка
 * одразу прив'язана до клієнта. Без клієнта можна лише «Завести клієнта» й
 * «Інше»: змінювати дані чи давати відстрочку нема кому.
 *
 * У 1С сайт не пише: заявку виконує людина, а тут видно, що її прийнято,
 * виконано чи відхилено і з якою відповіддю.
 */

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data as { items: RequestRow[] };
  });

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const TONE = { OPEN: "warn", DONE: "ok", REJECTED: "bad" } as const;

export default function RequestsScreen() {
  const search = useSearchParams();
  const clientId = search.get("client");
  const clientName = search.get("name");
  const kinds = REQUEST_KINDS.filter((k) => clientId || k.key === "NEW_CLIENT" || k.key === "OTHER");

  const { data, error, mutate } = useSWR("/api/sales/requests", fetcher);
  const [kind, setKind] = useState<string>(clientId ? "REQUISITES" : "NEW_CLIENT");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const hint = REQUEST_KINDS.find((k) => k.key === kind)?.hint;

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    setSent(false);
    try {
      const res = await fetch("/api/sales/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text, counterpartyId: clientId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
      setText("");
      setSent(true);
      await mutate();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Не вдалося надіслати");
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];

  return (
    <>
      <SalesHeader
        title="Заявки в офіс"
        subtitle={clientName ?? "Прохання, яке не загубиться"}
        backTo={clientId ? `/sales/clients/${clientId}` : "/sales/feed"}
      />
      <Page>
        <Card className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-bk">Нова заявка{clientName ? ` по клієнту` : ""}</h2>
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <Chip key={k.key} active={kind === k.key} onClick={() => setKind(k.key)}>
                {k.label}
              </Chip>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={hint}
            className="w-full rounded-xl border border-cab-line bg-white px-3.5 py-3 text-base text-bk"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || text.trim().length < 5}
            className="rounded-xl bg-primary py-3 text-sm font-bold text-bk disabled:opacity-50"
          >
            {busy ? "Надсилаю…" : "Надіслати в офіс"}
          </button>
          {formError && <Note tone="bad">{formError}</Note>}
          {sent && <Note>Надіслано. Коли офіс закриє заявку, прийде сповіщення.</Note>}
          <Note>Офіс виконує заявку в 1С вручну; тут видно статус і відповідь.</Note>
        </Card>

        {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}

        {data && items.length === 0 && (
          <Card>
            <EmptyState title="Заявок ще немає" hint="Надіслані заявки й відповіді офісу з'являться тут." />
          </Card>
        )}

        {items.map((r) => (
          <Card key={r.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-bk">{r.kindLabel}</span>
              <Pill tone={TONE[r.status]}>{r.statusLabel}</Pill>
            </div>
            {r.counterparty && (
              <Link href={`/sales/clients/${r.counterparty.id}?back=/sales/requests`} className="text-[13px] font-medium text-bk underline-offset-2 active:opacity-70">
                {r.counterparty.name}
              </Link>
            )}
            <p className="whitespace-pre-wrap text-[13px] text-cab-t2">{r.text}</p>
            {r.answer && (
              <p className="whitespace-pre-wrap rounded-lg bg-cab-bg px-3 py-2 text-[13px] text-bk">
                {r.doneBy ? `${r.doneBy.name}: ` : "Офіс: "}
                {r.answer}
              </p>
            )}
            <span className="text-[11px] text-cab-t3">
              {when(r.createdAt)}
              {r.doneAt ? ` · закрито ${when(r.doneAt)}` : ""}
            </span>
          </Card>
        ))}
      </Page>
    </>
  );
}
