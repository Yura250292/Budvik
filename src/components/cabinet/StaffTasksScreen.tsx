"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Body, Button, Card, Eyebrow, Note, Page, Pill } from "@/components/cabinet/ui";
import { EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { dueLabel } from "@/components/meetings/api";
import type { TaskRow } from "@/lib/meetings/types";

/**
 * Задачі від офісу — екран виконавця: торгового, водія, складу.
 *
 * Звідки задачі: керівник на нараді сказав «Андрію, заїдь до Кунанця до
 * п'ятниці», підсумок наради запропонував задачу, керівник її підтвердив — і
 * вона тут, із клієнтом і строком. Або офіс доручив руками.
 *
 * «Виконано» з коротким «що зроблено» — і керівник дізнається сповіщенням,
 * а не дзвінком «ну що там».
 */

type Data = { open: TaskRow[]; done: TaskRow[] };

const fetcher = async (url: string): Promise<Data> => {
  const r = await fetch(url, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return d as Data;
};

export default function StaffTasksScreen({
  header,
  clientBase,
  back,
}: {
  header: ReactNode;
  /** Префікс картки клієнта («/sales/clients/»); без нього клієнт — просто назва. */
  clientBase?: string;
  /** Куди повертатись із картки клієнта. */
  back: string;
}) {
  const { data, error, mutate } = useSWR("/api/tasks", fetcher);
  const open = data?.open ?? [];
  const done = data?.done ?? [];

  return (
    <>
      {header}
      <Page>
        {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}

        {data && open.length === 0 && (
          <Card>
            <EmptyState title="Відкритих задач немає" hint="Коли офіс доручить щось вам, задача з'явиться тут і прийде сповіщенням." />
          </Card>
        )}

        {open.map((t) => (
          <TaskItem key={t.id} t={t} clientBase={clientBase} back={back} onChanged={() => void mutate()} />
        ))}

        {done.length > 0 && (
          <>
            <Eyebrow>Виконані за два тижні</Eyebrow>
            {done.map((t) => (
              <TaskItem key={t.id} t={t} clientBase={clientBase} back={back} onChanged={() => void mutate()} />
            ))}
          </>
        )}
      </Page>
    </>
  );
}

/** Картка задачі з «Виконано» — її ж показує сторінка наради в кабінеті. */
export function TaskItem({
  t,
  clientBase,
  back,
  onChanged,
}: {
  t: TaskRow;
  clientBase?: string;
  back: string;
  onChanged: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/tasks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "done", note }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
      setClosing(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося");
    } finally {
      setBusy(false);
    }
  };

  const isDone = t.status === "DONE";
  const tone = isDone ? "plain" : t.overdue ? "bad" : t.priority === "HIGH" ? "warn" : "plain";

  return (
    <Card tone={tone} className={`flex flex-col gap-2 ${isDone ? "opacity-75" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-bold leading-snug text-bk">{t.title}</p>
        {isDone ? (
          <Pill tone="ok">Виконано</Pill>
        ) : t.priority === "HIGH" ? (
          <Pill tone="bad">Терміново</Pill>
        ) : null}
      </div>

      {t.details && <Body>{t.details}</Body>}

      {t.counterparty &&
        (clientBase ? (
          <Link
            href={`${clientBase}${t.counterparty.id}?back=${back}`}
            className="text-[13px] font-semibold text-bk underline underline-offset-2 active:opacity-70"
          >
            {t.counterparty.name}
          </Link>
        ) : (
          <p className="text-[13px] font-semibold text-bk">{t.counterparty.name}</p>
        ))}

      <p className="text-xs text-cab-t3">
        Від {t.createdBy.name}
        {t.dueAt ? ` · до ${dueLabel(t.dueAt)}` : ""}
      </p>
      {!isDone && t.overdue && <Note tone="bad">Строк минув — напишіть в офіс, якщо не встигаєте</Note>}
      {t.progressNote && <Note>З наради: {t.progressNote}</Note>}
      {isDone && t.doneNote && <Note>Ви написали: {t.doneNote}</Note>}

      {!isDone &&
        (closing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Що зроблено (необов'язково)"
              className="w-full rounded-xl border border-cab-line bg-white px-3.5 py-3 text-base text-bk"
            />
            <div className="flex gap-2">
              <Button tone="outline" small onClick={() => setClosing(false)} className="flex-1">
                Скасувати
              </Button>
              <Button tone="ok" small disabled={busy} onClick={() => void submit()} className="flex-1">
                {busy ? "Зберігаю…" : "Підтвердити"}
              </Button>
            </div>
          </div>
        ) : (
          <Button tone="ok" small onClick={() => setClosing(true)}>
            Виконано
          </Button>
        ))}
      {err && <Note tone="bad">{err}</Note>}
    </Card>
  );
}
