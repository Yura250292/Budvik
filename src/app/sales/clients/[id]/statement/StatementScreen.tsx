"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { Chip, Note, Page } from "@/components/cabinet/ui";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { money2, statementText, wallDay, type StatementResult } from "@/lib/clients/statement-build";
import type { StatementPayload } from "@/lib/clients/statement";

/**
 * Виписка по клієнту — щоб не дзвонити в офіс «скиньте акт звірки».
 *
 * Показує відвантаження, повернення й оплати за період і борг за даними
 * 1С. Кнопки ділитися дають готовий текст: «Скопіювати» працює всюди,
 * системне «Поділитися» — там, де браузер його має, Viber і Telegram —
 * у браузері (у застосунку — після оновлення, яке пропустить ці посилання).
 *
 * Підпис «довідково» обов'язковий і в тексті, і на екрані: офіційний акт
 * звірки робить бухгалтерія в 1С, а початкове сальдо тут розрахункове
 * (див. statement-build.ts).
 */

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data as StatementPayload;
  });

const DAYS = [30, 60, 90] as const;

function syncedLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StatementScreen() {
  const { id } = useParams<{ id: string }>();
  const [days, setDays] = useState<number>(30);
  const [note, setNote] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR(`/api/sales/clients/${id}/statement?days=${days}`, fetcher);

  const result: StatementResult | null = data
    ? { ...data.result, rows: data.result.rows.map((r) => ({ ...r, at: new Date(r.at) })) }
    : null;
  const text =
    data && result
      ? statementText({
          clientName: data.client.name,
          fromDay: data.fromDay,
          toDay: data.toDay,
          result,
          closingAt: syncedLabel(data.balanceSyncedAt),
        })
      : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Скопійовано — вставте в месенджер");
    } catch {
      setNote("Не вдалося скопіювати: виділіть текст нижче вручну");
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: "Виписка по клієнту", text });
    } catch {
      /* скасували або не вміє — нічого */
    }
  };

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      <SalesHeader title="Виписка" subtitle={data?.client.name ?? "По клієнту"} backTo={`/sales/clients/${id}`} />
      <Page>
        <div className="flex gap-2">
          {DAYS.map((d) => (
            <Chip key={d} active={days === d} onClick={() => setDays(d)}>
              {d} днів
            </Chip>
          ))}
        </div>

        {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}
        {isLoading && !data && <Card><p className="text-sm text-cab-t2">Завантаження…</p></Card>}

        {data && result && (
          <>
            <Card>
              <div className="flex flex-col gap-1.5 text-sm">
                <Line label="Сальдо на початок (розрахунково)" value={result.opening} muted />
                <Line label="Відвантажено" value={result.shipped} />
                <Line label="Повернено" value={result.returned} />
                <Line label="Оплачено" value={result.paid} />
                <div className="mt-1 border-t border-cab-line pt-2">
                  <Line label="Борг за даними 1С" value={result.closing} strong />
                </div>
              </div>
              <Note>
                Довідково. Офіційний акт звірки — з 1С. Початкове сальдо пораховане з боргу 1С мінус
                рухи за період{syncedLabel(data.balanceSyncedAt) ? `; борг оновлено ${syncedLabel(data.balanceSyncedAt)}` : ""}.
              </Note>
            </Card>

            <Card padded={false}>
              {result.rows.length === 0 ? (
                <EmptyState title="За цей період рухів немає" hint="Спробуйте довший період." />
              ) : (
                <ul className="divide-y divide-cab-line">
                  {result.rows.map((r, i) => {
                    const inner = (
                      <>
                        <span className="w-11 shrink-0 text-xs tabular-nums text-cab-t3">{wallDay(r.at)}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-bk">{r.label}</span>
                        <span
                          className={`shrink-0 text-[13px] font-semibold tabular-nums ${
                            r.kind === "SALE" ? "text-bk" : "text-ok-fg"
                          }`}
                        >
                          {r.amount >= 0 ? "+" : "−"}
                          {money2(Math.abs(r.amount))}
                        </span>
                        <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-cab-t3">
                          {money2(r.balance)}
                        </span>
                      </>
                    );
                    const cls = "flex items-center gap-2 px-4 py-2 sm:px-5";
                    return (
                      <li key={`${r.at.toISOString()}-${i}`}>
                        {r.docId ? (
                          <Link href={`/sales/orders/${r.docId}?back=/sales/clients/${id}/statement`} className={`${cls} active:opacity-70`}>
                            {inner}
                          </Link>
                        ) : (
                          <div className={cls}>{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                className="rounded-xl bg-primary py-3 text-sm font-bold text-bk active:opacity-80"
              >
                Скопіювати
              </button>
              {canShare ? (
                <button
                  type="button"
                  onClick={() => void share()}
                  className="rounded-xl bg-bk py-3 text-sm font-bold text-white active:opacity-80"
                >
                  Поділитися
                </button>
              ) : (
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encodeURIComponent(text)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-bk py-3 text-center text-sm font-bold text-white active:opacity-80"
                >
                  Telegram
                </a>
              )}
              <a
                href={`viber://forward?text=${encodeURIComponent(text)}`}
                className="col-span-2 rounded-xl border border-cab-line bg-white py-3 text-center text-sm font-semibold text-bk active:opacity-80"
              >
                Переслати у Viber
              </a>
            </div>
            {note && <Note>{note}</Note>}

            <details className="rounded-xl border border-cab-line bg-white px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-bk">Текст виписки</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-cab-t2 select-all">
                {text}
              </pre>
            </details>
          </>
        )}
      </Page>
    </>
  );
}

function Line({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={muted ? "text-cab-t3" : "text-cab-t2"}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-lg font-bold text-bk" : muted ? "text-cab-t3" : "font-semibold text-bk"}`}>
        {money2(value)} ₴
      </span>
    </div>
  );
}
