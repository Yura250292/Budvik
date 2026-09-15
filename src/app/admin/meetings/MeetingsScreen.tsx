"use client";

import Link from "next/link";
import useSWR from "swr";
import { FileText, Mic } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { MeetingStatusChip, WorkerBanner } from "@/components/meetings/bits";
import { getJson, kyivDateTime } from "@/components/meetings/api";
import { useMeetingRecording } from "@/components/meetings/MeetingRecordingProvider";
import { POLLING_STATES, formatClock, type MeetingRow, type WorkerState } from "@/lib/meetings/types";

/**
 * Наради: запис → розпізнавання → підсумок → задачі команді.
 *
 * Розпізнає й підсумовує воркер, тож список просто показує, де кожна нарада
 * на цьому шляху, і скільки задач із неї ще чекають підтвердження.
 */

type Data = { items: MeetingRow[]; worker: WorkerState };

export default function MeetingsScreen() {
  const { data, error, isLoading, mutate } = useSWR("/api/admin/meetings", (u: string) => getJson<Data>(u), {
    refreshInterval: (latest) => (latest?.items.some((m) => POLLING_STATES.includes(m.status)) ? 8000 : 0),
  });
  const items = data?.items ?? [];
  const waiting = items.some((m) => POLLING_STATES.includes(m.status));
  const rec = useMeetingRecording();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold leading-tight text-bk">Наради</h1>
          <p className="mt-0.5 text-[13px] text-g500">
            Запишіть нараду чи завантажте файл із диктофона — підсумок складеться сам: про що говорили, які задачі кому і
            як рухаємось по попередніх. Задачі йдуть людям після вашого підтвердження.
          </p>
        </div>
        <Link
          href="/admin/meetings/new"
          className="rounded-[var(--radius-btn)] bg-bk px-4 py-2 text-[13px] font-semibold text-white"
        >
          Нова нарада
        </Link>
      </div>

      {/* Зупинений запис живе лише в пам'яті вкладки — тут його шукають першим ділом. */}
      {rec.state === "stopped" && rec.recorded && (
        <Link
          href="/admin/meetings/new"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900"
        >
          <span>
            <b>Є незбережений запис наради</b> · {formatClock(rec.recorded.durationMs)}. Він лише в цій вкладці — не
            закривайте й не перезавантажуйте її.
          </span>
          <span className="whitespace-nowrap font-semibold">Зберегти →</span>
        </Link>
      )}

      {data && <WorkerBanner worker={data.worker} waiting={waiting} />}
      {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}

      {!isLoading && !error && items.length === 0 && (
        <Card>
          <EmptyState title="Нарад ще немає" hint="Почніть із запису або завантажте файл із диктофона телефона." />
        </Card>
      )}

      {items.map((m) => (
        <Link key={m.id} href={`/admin/meetings/${m.id}`} className="block">
          <Card className="transition-colors hover:bg-g50">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <span className="mt-0.5 text-g400">{m.isTextNote ? <FileText size={16} /> : <Mic size={16} />}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug text-bk">{m.title}</p>
                  <p className="mt-0.5 text-[12px] text-g500">
                    {kyivDateTime(m.recordedAt)}
                    {m.audioDurationMs ? ` · ${formatClock(m.audioDurationMs)}` : ""}
                    {m.isTextNote ? " · нотатка" : ""}
                  </p>
                </div>
              </div>
              <MeetingStatusChip status={m.status} label={m.statusLabel} />
            </div>
            {(m.tasksProposed > 0 || m.tasksSent > 0) && (
              <p className="mt-2 text-[12px] text-g600">
                {m.tasksProposed > 0 && <span className="font-semibold text-amber-700">{m.tasksProposed} чекають підтвердження</span>}
                {m.tasksProposed > 0 && m.tasksSent > 0 && " · "}
                {m.tasksSent > 0 && `${m.tasksSent} надіслано`}
              </p>
            )}
            {m.status === "READY" && (
              <p className={`mt-1 text-[12px] ${m.sharedCount > 0 ? "text-g600" : "font-semibold text-amber-700"}`}>
                {m.sharedCount > 0
                  ? `Підсумок у кабінетах: ${m.sharedCount}`
                  : "Команді ще не надіслано — відкрийте нараду й натисніть «Надіслати команді»"}
              </p>
            )}
            {m.status === "FAILED" && m.processingError && (
              <p className="mt-2 line-clamp-2 text-[12px] text-red-700">{m.processingError}</p>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
}
