"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import TaskCard, { type TaskEditMode } from "@/components/meetings/TaskCard";
import TaskEditModal from "@/components/meetings/TaskEditModal";
import { getJson } from "@/components/meetings/api";
import type { StaffOption, TaskRow } from "@/lib/meetings/types";

/**
 * Задачі команді: що кому доручено, з нарад і вручну, і що з цього виконано.
 *
 * Перша вкладка — пропозиції з нарад, які ще ніхто не підтвердив: це черга
 * керівника. Далі надіслані (з простроченими нагорі за строком), виконані з
 * коментарем виконавця й скасовані.
 */

const FILTERS = [
  { key: "PROPOSED", label: "Чекають підтвердження" },
  { key: "ASSIGNED", label: "Надіслані" },
  { key: "DONE", label: "Виконані" },
  { key: "CANCELLED", label: "Скасовані" },
  { key: "", label: "Усі" },
] as const;

const CHIP = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
    active ? "border-bk bg-bk text-white" : "border-g200 bg-white text-g600 hover:bg-g50"
  }`;

export default function AdminTasksScreen() {
  const [status, setStatus] = useState<string>("PROPOSED");
  const [mine, setMine] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [modal, setModal] = useState<{ mode: TaskEditMode | "create"; task: TaskRow | null } | null>(null);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (mine) params.set("mine", "1");
  if (assigneeId) params.set("assigneeId", assigneeId);

  const { data, error, isLoading, mutate } = useSWR(`/api/admin/tasks?${params.toString()}`, (u: string) =>
    getJson<{ items: TaskRow[] }>(u)
  );
  const { data: staffData } = useSWR("/api/admin/tasks/staff", (u: string) => getJson<{ items: StaffOption[] }>(u));
  const staff = staffData?.items ?? [];
  const items = data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold leading-tight text-bk">Задачі команді</h1>
          <p className="mt-0.5 text-[13px] text-g500">
            Доручення торговим, водіям, складу й менеджерам. Виконавець бачить задачу в кабінеті й отримує сповіщення,
            а закриваючи — пише, що зроблено.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create", task: null })}
          className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-4 py-2 text-[13px] font-semibold text-white"
        >
          Нова задача
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key || "all"} type="button" className={CHIP(status === f.key)} onClick={() => setStatus(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-g600">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Лише доручені мною
        </label>
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="rounded-[var(--radius-btn)] border border-g200 bg-white px-2.5 py-1.5 text-[13px] text-bk"
        >
          <option value="">Усі виконавці</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.roleLabel}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}

      {!isLoading && !error && items.length === 0 && (
        <Card>
          <EmptyState
            title={status === "PROPOSED" ? "Непідтверджених задач немає" : "Задач немає"}
            hint={status === "PROPOSED" ? "Пропозиції з'являються після підсумку наради." : undefined}
          />
        </Card>
      )}

      {items.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          showMeeting
          onEdit={(task, mode) => setModal({ task, mode })}
          onChanged={() => void mutate()}
        />
      ))}

      {modal && (
        <TaskEditModal
          mode={modal.mode}
          task={modal.task}
          staff={staff}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            void mutate();
          }}
        />
      )}
    </div>
  );
}
