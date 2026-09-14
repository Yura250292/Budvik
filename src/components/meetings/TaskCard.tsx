"use client";

import Link from "next/link";
import { useState } from "react";
import type { Role } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/roles";
import { CONFIDENCE_SURE, type TaskRow } from "@/lib/meetings/types";
import { dueLabel, kyivDateTime, sendJson } from "./api";
import { TaskStatusChip } from "./bits";

export type TaskEditMode = "confirm" | "update";

const BTN = "cursor-pointer rounded-[var(--radius-btn)] px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50";
const BTN_DARK = `${BTN} bg-bk text-white`;
const BTN_LIGHT = `${BTN} border border-g200 bg-white text-g600 hover:bg-g50`;

/**
 * Задача в адмінці — на сторінці наради й у «Задачах команді».
 *
 * Для пропозиції з наради головне — показати, де модель не впевнена: виконавця
 * не впізнано, підставлено за закріпленням клієнта, клієнтів із такою назвою
 * кілька. Саме це керівник і має перевірити перед «Надіслати».
 */
export default function TaskCard({
  task: t,
  onEdit,
  onChanged,
  showMeeting = false,
}: {
  task: TaskRow;
  onEdit: (task: TaskRow, mode: TaskEditMode) => void;
  onChanged: () => void;
  showMeeting?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setErr(null);
    try {
      await sendJson(`/api/admin/tasks/${t.id}`, "PATCH", { action, ...extra });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося");
    } finally {
      setBusy(false);
    }
  };

  const proposed = t.status === "PROPOSED";
  const guessedAssignee = !!t.assignee && (t.assigneeConfidence ?? 1) < CONFIDENCE_SURE;
  const needsCheck = proposed && !t.ready;

  return (
    <div
      className={`rounded-[var(--radius-card)] border bg-white p-4 shadow-[var(--shadow-card)] ${
        needsCheck ? "border-amber-300" : "border-g200"
      } ${t.status === "CANCELLED" ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-bk">{t.title}</p>
        <div className="flex items-center gap-1.5">
          {t.priority === "HIGH" && (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Терміново</span>
          )}
          <TaskStatusChip status={t.status} label={t.statusLabel} />
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-g500">Кому</dt>
        <dd className="min-w-0 text-bk">
          {t.assignee ? (
            <>
              {t.assignee.name}
              <span className="text-g500"> · {ROLE_LABELS[t.assignee.role as Role] ?? t.assignee.role}</span>
              {guessedAssignee && <span className="ml-1 text-amber-700">(за закріпленням клієнта — перевірте)</span>}
              {t.assigneeNameHeard && <span className="ml-1 text-g500">на нараді: «{t.assigneeNameHeard}»</span>}
            </>
          ) : (
            <span className="text-amber-700">
              не впізнано{t.assigneeNameHeard ? ` — на нараді «${t.assigneeNameHeard}»` : ""}
            </span>
          )}
        </dd>

        {(t.counterparty || t.clientNameHeard) && (
          <>
            <dt className="text-g500">Клієнт</dt>
            <dd className="min-w-0 text-bk">
              {t.counterparty ? (
                <>
                  {t.counterparty.name}
                  {t.clientNameHeard && (t.clientConfidence ?? 1) < 1 && (
                    <span className="ml-1 text-g500">на нараді: «{t.clientNameHeard}»</span>
                  )}
                </>
              ) : (
                <span className="text-amber-700">
                  «{t.clientNameHeard}»{t.clientHint ? ` (${t.clientHint})` : ""} —{" "}
                  {t.clientCandidates.length > 0 ? `${t.clientCandidates.length} схожих, оберіть` : "у базі не знайдено"}
                </span>
              )}
            </dd>
          </>
        )}

        {t.dueAt && (
          <>
            <dt className="text-g500">Строк</dt>
            <dd className={t.overdue ? "font-semibold text-red-700" : "text-bk"}>
              {dueLabel(t.dueAt)}
              {t.overdue ? " — минув" : ""}
            </dd>
          </>
        )}
      </dl>

      {t.details && <p className="mt-2 whitespace-pre-wrap text-[13px] text-g600">{t.details}</p>}
      {t.progressNote && (
        <p className="mt-2 rounded-lg bg-g50 px-3 py-2 text-[13px] text-bk">З наради{t.progressAt ? ` ${kyivDateTime(t.progressAt)}` : ""}: {t.progressNote}</p>
      )}
      {t.doneNote && <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-[13px] text-green-900">Виконавець: {t.doneNote}</p>}

      <p className="mt-2 text-[11px] text-g500">
        {showMeeting && t.meetingId && (
          <>
            <Link href={`/admin/meetings/${t.meetingId}`} className="underline underline-offset-2">
              {t.meetingTitle ?? "нарада"}
            </Link>
            {" · "}
          </>
        )}
        {t.status === "ASSIGNED" && t.sentAt && `надіслано ${kyivDateTime(t.sentAt)} · ${t.pushedAt ? "сповіщено" : "сповіщення чекає робочих годин"}`}
        {t.status === "DONE" && t.doneAt && `виконано ${kyivDateTime(t.doneAt)}`}
        {t.status === "PROPOSED" && `запропоновано ${kyivDateTime(t.createdAt)}`}
        {t.status === "CANCELLED" && t.cancelledAt && `скасовано ${kyivDateTime(t.cancelledAt)}`}
        {` · доручив ${t.createdBy.name}`}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {proposed && (
          <>
            {t.ready && (
              <button type="button" disabled={busy} onClick={() => void act("confirm")} className={BTN_DARK}>
                Надіслати
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => onEdit(t, "confirm")} className={t.ready ? BTN_LIGHT : BTN_DARK}>
              {t.ready ? "Змінити й надіслати" : "Перевірити й надіслати"}
            </button>
            <button type="button" disabled={busy} onClick={() => void act("cancel")} className={BTN_LIGHT}>
              Відхилити
            </button>
          </>
        )}
        {t.status === "ASSIGNED" && (
          <>
            <button type="button" disabled={busy} onClick={() => onEdit(t, "update")} className={BTN_LIGHT}>
              Змінити
            </button>
            <button type="button" disabled={busy} onClick={() => void act("done")} className={BTN_LIGHT}>
              Позначити виконаною
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm("Скасувати задачу? Виконавець її більше не бачитиме у відкритих.")) void act("cancel");
              }}
              className={BTN_LIGHT}
            >
              Скасувати
            </button>
          </>
        )}
        {t.status === "DONE" && (
          <button type="button" disabled={busy} onClick={() => void act("reopen")} className={BTN_LIGHT}>
            Відкрити знову
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-[12px] text-red-700">{err}</p>}
    </div>
  );
}
