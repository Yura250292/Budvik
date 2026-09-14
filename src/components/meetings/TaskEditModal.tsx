"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type StaffOption,
  type TaskPriority,
  type TaskRow,
} from "@/lib/meetings/types";
import { dateInputValue, sendJson } from "./api";

type Mode = "create" | "confirm" | "update";
type ClientPick = { id: string; name: string; address: string | null };

const INPUT = "w-full rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-[13px] text-bk";
const LABEL = "text-[12px] font-medium text-g600";

/**
 * Перевірка задачі перед надсиланням (або ручна задача).
 *
 * Для пропозиції з наради поруч із полями стоїть те, що прозвучало, —
 * «на нараді: Кунанець» — і кандидати, яких знайшов пошук, щоб вибір
 * клієнта був одним тапом, а не новим пошуком.
 */
export default function TaskEditModal({
  mode,
  task,
  staff,
  onClose,
  onSaved,
}: {
  mode: Mode;
  task: TaskRow | null;
  staff: StaffOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [details, setDetails] = useState(task?.details ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assignee?.id ?? "");
  const [client, setClient] = useState<ClientPick | null>(
    task?.counterparty ? { id: task.counterparty.id, name: task.counterparty.name, address: null } : null
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [dueDate, setDueDate] = useState(dateInputValue(task?.dueAt ?? null));
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "NORMAL");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/erp/counterparties/search?q=${encodeURIComponent(q)}&limit=8`, { signal: ctl.signal });
        const d = (await r.json().catch(() => ({}))) as { items?: ClientPick[] };
        setResults((d.items ?? []).map((c) => ({ id: c.id, name: c.name, address: c.address ?? null })));
      } catch {
        /* скасовано чи мережа — лишаємо попередні */
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query]);

  const groups = useMemo(() => {
    const map = new Map<string, StaffOption[]>();
    for (const s of staff) map.set(s.roleLabel, [...(map.get(s.roleLabel) ?? []), s]);
    return [...map];
  }, [staff]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const body = {
      title,
      details,
      assigneeId: assigneeId || null,
      counterpartyId: client?.id ?? null,
      dueDate: dueDate || null,
      priority,
    };
    try {
      if (mode === "create") await sendJson("/api/admin/tasks", "POST", body);
      else await sendJson(`/api/admin/tasks/${task!.id}`, "PATCH", { action: mode, ...body });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setBusy(false);
    }
  };

  const heading = mode === "create" ? "Нова задача" : mode === "confirm" ? "Перевірити й надіслати" : "Змінити задачу";
  const submitLabel = mode === "update" ? "Зберегти" : "Надіслати виконавцю";
  const candidates = task?.clientCandidates ?? [];

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={heading}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-bk">{heading}</h2>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-full px-2 py-1 text-lg leading-none text-g500 hover:bg-g50" aria-label="Закрити">
            ×
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Що зробити</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Подробиці</span>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={2000} className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>
            Виконавець{task?.assigneeNameHeard ? <span className="font-normal text-g500"> · на нараді: «{task.assigneeNameHeard}»</span> : null}
          </span>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={INPUT}>
            <option value="">— оберіть —</option>
            {groups.map(([label, people]) => (
              <optgroup key={label} label={label}>
                {people.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>
            Клієнт{task?.clientNameHeard ? <span className="font-normal text-g500"> · на нараді: «{task.clientNameHeard}»</span> : null}
          </span>
          {client ? (
            <div className="flex items-center justify-between gap-2 rounded-[var(--radius-btn)] border border-g200 bg-g50 px-3 py-2 text-[13px]">
              <span className="min-w-0 text-bk">
                {client.name}
                {client.address && <span className="text-g500"> · {client.address}</span>}
              </span>
              <button type="button" onClick={() => setClient(null)} className="cursor-pointer text-[12px] font-medium text-g600 underline">
                прибрати
              </button>
            </div>
          ) : (
            <>
              {candidates.length > 0 && (
                <div className="flex flex-col gap-1">
                  {candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setClient({ id: c.id, name: c.name, address: c.address })}
                      className="cursor-pointer rounded-[var(--radius-btn)] border border-amber-200 bg-amber-50 px-3 py-1.5 text-left text-[13px] text-bk hover:bg-amber-100"
                    >
                      {c.name}
                      {c.address && <span className="text-g500"> · {c.address}</span>}
                      {c.mine && <span className="text-g500"> · клієнт виконавця</span>}
                    </button>
                  ))}
                </div>
              )}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Пошук: прізвище, назва, село"
                className={INPUT}
              />
              {searching && <span className="text-[12px] text-g500">Шукаю…</span>}
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setClient(c);
                    setQuery("");
                  }}
                  className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-left text-[13px] text-bk hover:bg-g50"
                >
                  {c.name}
                  {c.address && <span className="text-g500"> · {c.address}</span>}
                </button>
              ))}
              <span className="text-[11px] text-g500">Без клієнта — задача загальна.</span>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Строк</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Пріоритет</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={INPUT}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {err && <p className="text-[12px] text-red-700">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy || title.trim().length < 3 || (mode !== "update" && !assigneeId)}
            onClick={() => void save()}
            className="flex-1 cursor-pointer rounded-[var(--radius-btn)] bg-bk px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Зберігаю…" : submitLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-4 py-2.5 text-[13px] font-semibold text-g600 hover:bg-g50"
          >
            Скасувати
          </button>
        </div>
      </div>
    </div>
  );
}
