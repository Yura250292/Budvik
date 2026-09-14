"use client";

import type { MeetingStatus, TaskStatus, WorkerState } from "@/lib/meetings/types";
import { kyivDateTime } from "./api";

const MEETING_CLS: Record<MeetingStatus, string> = {
  DRAFT: "border-g200 bg-g50 text-g600",
  UPLOADED: "border-blue-200 bg-blue-50 text-blue-800",
  TRANSCRIBING: "border-blue-200 bg-blue-50 text-blue-800",
  TRANSCRIBED: "border-blue-200 bg-blue-50 text-blue-800",
  SUMMARIZING: "border-blue-200 bg-blue-50 text-blue-800",
  READY: "border-green-200 bg-green-50 text-green-800",
  FAILED: "border-red-200 bg-red-50 text-red-800",
};

const TASK_CLS: Record<TaskStatus, string> = {
  PROPOSED: "border-amber-200 bg-amber-50 text-amber-800",
  ASSIGNED: "border-blue-200 bg-blue-50 text-blue-800",
  DONE: "border-green-200 bg-green-50 text-green-800",
  CANCELLED: "border-g200 bg-g50 text-g500",
};

export function MeetingStatusChip({ status, label }: { status: MeetingStatus; label: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${MEETING_CLS[status]}`}>
      {label}
    </span>
  );
}

export function TaskStatusChip({ status, label }: { status: TaskStatus; label: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TASK_CLS[status]}`}>
      {label}
    </span>
  );
}

/**
 * Попередження, коли нарада чекає, а обробник не працює.
 *
 * Без нього забутий railway up чи ключ, якого не додали на воркер, виглядали
 * б як вічний спінер: сайт показує «у черзі», а черга ніким не розбирається.
 */
export function WorkerBanner({ worker, waiting }: { worker: WorkerState; waiting: boolean }) {
  if (!waiting) return null;
  if (worker.missing.length > 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
        Обробник нарад працює, але на воркері бракує: <b>{worker.missing.join(", ")}</b>. Поки їх не додадуть на Railway,
        нарада чекатиме в черзі.
      </div>
    );
  }
  if (worker.stale) {
    return (
      <div className="rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
        Обробник нарад не відповідає
        {worker.lastTickAt ? ` з ${kyivDateTime(worker.lastTickAt)}` : " — він ще жодного разу не запускався"}. Схоже,
        воркер на Railway зупинено або не оновлено (railway up). Нарада обробиться, щойно він запрацює.
      </div>
    );
  }
  return null;
}
