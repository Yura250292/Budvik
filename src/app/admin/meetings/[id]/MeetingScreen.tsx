"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { MeetingStatusChip, WorkerBanner } from "@/components/meetings/bits";
import TaskCard, { type TaskEditMode } from "@/components/meetings/TaskCard";
import TaskEditModal from "@/components/meetings/TaskEditModal";
import ShareCard from "@/components/meetings/ShareCard";
import { getJson, kyivDateTime, megabytes, sendJson } from "@/components/meetings/api";
import { uploadMeetingAudio, type UploadStage } from "@/components/meetings/upload";
import { AUDIO_ACCEPT } from "@/lib/meetings/keys";
import {
  POLLING_STATES,
  PROGRESS_LABELS,
  formatClock,
  speakerKey,
  type MeetingDetail,
  type MeetingStatus,
  type MeetingStructured,
  type StaffOption,
  type TaskRow,
} from "@/lib/meetings/types";

/**
 * Нарада: де вона на шляху обробки, підсумок, задачі на підтвердження,
 * хто говорив і транскрипт.
 *
 * Поки воркер працює, сторінка опитує сервер раз на 4 секунди. Закрити її
 * можна будь-коли — обробка від вкладки не залежить.
 */

const BTN = "cursor-pointer rounded-[var(--radius-btn)] px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50";
const DARK = `${BTN} bg-bk text-white`;
const LIGHT = `${BTN} border border-g200 bg-white text-g600 hover:bg-g50`;
const INPUT = "rounded-[var(--radius-btn)] border border-g200 bg-white px-2.5 py-1.5 text-[13px] text-bk";

const STEPS: { label: string; done: MeetingStatus[]; active: MeetingStatus[] }[] = [
  { label: "Запис отримано", done: ["TRANSCRIBING", "TRANSCRIBED", "SUMMARIZING", "READY"], active: ["UPLOADED"] },
  { label: "Розпізнавання мовлення", done: ["TRANSCRIBED", "SUMMARIZING", "READY"], active: ["TRANSCRIBING"] },
  { label: "Підсумок і задачі", done: ["READY"], active: ["TRANSCRIBED", "SUMMARIZING"] },
];

export default function MeetingScreen({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, mutate } = useSWR(`/api/admin/meetings/${id}`, (u: string) => getJson<{ item: MeetingDetail }>(u), {
    refreshInterval: (latest) => (latest && POLLING_STATES.includes(latest.item.status) ? 4000 : 0),
  });
  const { data: staffData } = useSWR("/api/admin/tasks/staff", (u: string) => getJson<{ items: StaffOption[] }>(u));
  const staff = staffData?.items ?? [];

  const [modal, setModal] = useState<{ mode: TaskEditMode; task: TaskRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const m = data?.item;

  const labels = useMemo(() => {
    const seen: string[] = [];
    for (const u of m?.utterances ?? []) {
      const k = speakerKey(u.speaker);
      if (!seen.includes(k)) seen.push(k);
    }
    for (const k of Object.keys(m?.speakerMap ?? {})) if (!seen.includes(k)) seen.push(k);
    return seen;
  }, [m?.utterances, m?.speakerMap]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не вдалося");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <Link href="/admin/meetings" className="text-[13px] text-g500 hover:text-bk">
          ← Наради
        </Link>
        <ErrorBox message={error.message} onRetry={() => void mutate()} />
      </div>
    );
  }
  if (!m) return <div className="mx-auto w-full max-w-3xl text-[13px] text-g500">Завантаження…</div>;

  const nameOf = (label: string) => m.speakerMap[speakerKey(label)]?.name ?? `Спікер ${speakerKey(label)}`;
  const processing = POLLING_STATES.includes(m.status);
  const proposed = m.tasks.filter((t) => t.status === "PROPOSED");
  const readyCount = proposed.filter((t) => t.ready).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link href="/admin/meetings" className="text-[13px] text-g500 hover:text-bk">
        ← Наради
      </Link>

      <div className="flex flex-col gap-2">
        <TitleEditor key={m.title} id={id} title={m.title} onSaved={() => void mutate()} />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-g500">
          <MeetingStatusChip status={m.status} label={m.statusLabel} />
          <span>{kyivDateTime(m.recordedAt)}</span>
          {!!m.audioDurationMs && <span>· {formatClock(m.audioDurationMs)}</span>}
          {!!m.audioSizeBytes && <span>· {megabytes(m.audioSizeBytes)}</span>}
          {m.isTextNote && <span>· текстова нотатка</span>}
          <span>· {m.createdBy.name}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {m.status === "FAILED" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => sendJson(`/api/admin/meetings/${id}/retry`, "POST"))}
              className={DARK}
            >
              Повторити обробку
            </button>
          )}
          {m.status === "READY" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm("Перескласти підсумок? Непідтверджені задачі складуться заново, надіслані лишаться.")) {
                  void run(() => sendJson(`/api/admin/meetings/${id}/regenerate`, "POST"));
                }
              }}
              className={LIGHT}
            >
              Перескласти підсумок
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!confirm("Видалити нараду разом із записом? Надіслані задачі лишаться в людей.")) return;
              setBusy(true);
              try {
                await sendJson(`/api/admin/meetings/${id}`, "DELETE");
                router.push("/admin/meetings");
              } catch (e) {
                setActionError(e instanceof Error ? e.message : "Не вдалося видалити");
                setBusy(false);
              }
            }}
            className={LIGHT}
          >
            Видалити
          </button>
        </div>
        {actionError && <p className="text-[12px] text-red-700">{actionError}</p>}
        {notice && <p className="text-[12px] text-green-700">{notice}</p>}
      </div>

      <WorkerBanner worker={m.worker} waiting={processing} />

      {processing && (
        <Card>
          <ol className="flex flex-wrap gap-2 text-[12px]">
            {(m.isTextNote ? STEPS.slice(2) : STEPS).map((s) => {
              const done = s.done.includes(m.status);
              const active = s.active.includes(m.status);
              return (
                <li
                  key={s.label}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                    done
                      ? "border-green-200 bg-green-50 text-green-800"
                      : active
                        ? "border-blue-200 bg-blue-50 text-blue-800"
                        : "border-g200 text-g500"
                  }`}
                >
                  {done ? "✓" : active ? <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" /> : "·"}
                  {s.label}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[12px] text-g500">
            Година запису розпізнається за кілька хвилин, підсумок — ще хвилина. Сторінка оновиться сама; закрити її можна.
          </p>
          {m.processingError && <p className="mt-1 text-[12px] text-amber-700">Попередня спроба: {m.processingError}</p>}
        </Card>
      )}

      {m.status === "FAILED" && m.processingError && <ErrorBox message={m.processingError} />}
      {m.status === "READY" && m.processingError && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{m.processingError}</p>
      )}

      {m.status === "DRAFT" && <UploadPanel meetingId={id} onDone={() => void mutate()} />}

      {m.hasAudio && <audio controls preload="none" src={`/api/admin/meetings/${id}/audio`} className="w-full" />}

      {m.structured && <Summary s={m.structured} />}

      {m.tasks.length > 0 && (
        <Card>
          <CardHeader
            title={`Задачі · ${m.tasks.length}`}
            hint={
              proposed.length > 0
                ? `${proposed.length} чекають підтвердження — людям вони підуть лише після «Надіслати»`
                : "Усі задачі розіслано"
            }
            action={
              readyCount > 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await sendJson<{ sent: number; left: number }>("/api/admin/tasks/confirm-ready", "POST", {
                        meetingId: id,
                      });
                      setNotice(`Надіслано ${r.sent}${r.left ? `, ще ${r.left} треба перевірити` : ""}`);
                    })
                  }
                  className={DARK}
                >
                  Надіслати готові · {readyCount}
                </button>
              ) : undefined
            }
          />
          <div className="flex flex-col gap-3">
            {m.tasks.map((t) => (
              <TaskCard key={t.id} task={t} onEdit={(task, mode) => setModal({ task, mode })} onChanged={() => void mutate()} />
            ))}
          </div>
        </Card>
      )}
      {m.status === "READY" && m.structured && <ShareCard meetingId={id} proposed={proposed.length} />}

      {m.status === "READY" && m.tasks.length === 0 && (
        <Card>
          <p className="text-[13px] text-g600">Задач на нараді не прозвучало.</p>
        </Card>
      )}

      {labels.length > 0 && (
        <Card>
          <CardHeader
            title="Хто говорив"
            hint={
              m.status === "READY"
                ? "Виправили ім'я — натисніть «Перескласти підсумок», щоб задачі пішли правильним людям."
                : "Імена підставить підсумок; виправити можна тут."
            }
          />
          {labels.map((l) => {
            const entry = m.speakerMap[l];
            return (
              <SpeakerRow
                key={`${l}:${entry?.name ?? ""}:${entry?.userId ?? ""}`}
                meetingId={id}
                label={l}
                name={entry?.name ?? null}
                userId={entry?.userId ?? null}
                evidence={m.structured?.speakers.find((s) => speakerKey(s.label) === l)?.evidence ?? null}
                staff={staff}
                onSaved={() => void mutate()}
              />
            );
          })}
        </Card>
      )}

      {m.utterances.length > 0 && (
        <details className="rounded-[var(--radius-card)] border border-g200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-bk">Транскрипт · {m.utterances.length} реплік</summary>
          <div className="mt-3 flex flex-col gap-2.5">
            {m.utterances.map((u, i) => (
              <p key={i} className="text-[13px] leading-relaxed text-bk">
                <span className="font-semibold">{nameOf(u.speaker)}</span>{" "}
                <span className="text-[11px] text-g400">{formatClock(u.start)}</span>
                <br />
                {u.text}
              </p>
            ))}
          </div>
        </details>
      )}

      {m.noteText && (
        <details className="rounded-[var(--radius-card)] border border-g200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-bk">Текст нотатки</summary>
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-bk">{m.noteText}</p>
        </details>
      )}

      {m.aiModel && (
        <p className="text-[11px] text-g500">
          Підсумок: {m.aiModel}, {m.aiPromptTokens ?? 0} + {m.aiCompletionTokens ?? 0} токенів
          {m.processedAt ? `, ${kyivDateTime(m.processedAt)}` : ""}
        </p>
      )}

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

function TitleEditor({ id, title, onSaved }: { id: string; title: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!editing) {
    return (
      <h1
        className="cursor-text text-lg font-bold leading-tight text-bk"
        title="Натисніть, щоб змінити назву"
        onClick={() => setEditing(true)}
      >
        {title}
      </h1>
    );
  }

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await sendJson(`/api/admin/meetings/${id}`, "PATCH", { title: value });
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={200}
          autoFocus
          className={`${INPUT} min-w-0 flex-1 text-base font-semibold`}
        />
        <button type="button" disabled={busy || !value.trim()} onClick={() => void save()} className={DARK}>
          Зберегти
        </button>
        <button type="button" onClick={() => setEditing(false)} className={LIGHT}>
          Скасувати
        </button>
      </div>
      {err && <p className="text-[12px] text-red-700">{err}</p>}
    </div>
  );
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-bk">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-g600">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Summary({ s }: { s: MeetingStructured }) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-bk">Підсумок</h2>
        <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-bk">{s.summary}</p>
      </div>

      {s.progressUpdates.length > 0 && (
        <div>
          <h3 className="text-[13px] font-semibold text-bk">Як рухаємось по попередніх задачах</h3>
          <ul className="mt-1 flex flex-col gap-1.5">
            {s.progressUpdates.map((p) => (
              <li key={p.taskId} className="rounded-lg bg-g50 px-3 py-2 text-[13px] text-bk">
                <span
                  className={`font-semibold ${
                    p.status === "DONE" ? "text-green-700" : p.status === "BLOCKED" ? "text-red-700" : "text-bk"
                  }`}
                >
                  {PROGRESS_LABELS[p.status]}
                </span>{" "}
                · {p.taskTitle}
                <span className="block text-g600">{p.note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-g500">
            Задачі від цього не закриваються — позначте виконаними в{" "}
            <Link href="/admin/tasks" className="underline">
              «Задачах команді»
            </Link>
            , якщо так.
          </p>
        </div>
      )}

      <BulletList title="Рішення" items={s.decisions} />
      <BulletList title="Ключові моменти" items={s.keyPoints} />
      <BulletList title="Відкриті питання" items={s.openQuestions} />
    </Card>
  );
}

function SpeakerRow({
  meetingId,
  label,
  name,
  userId,
  evidence,
  staff,
  onSaved,
}: {
  meetingId: string;
  label: string;
  name: string | null;
  userId: string | null;
  evidence: string | null;
  staff: StaffOption[];
  onSaved: () => void;
}) {
  const [n, setN] = useState(name ?? "");
  const [u, setU] = useState(userId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = n !== (name ?? "") || u !== (userId ?? "");

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await sendJson(`/api/admin/meetings/${meetingId}/speakers`, "PATCH", { label, name: n, userId: u || null });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-g200 py-2 last:border-0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-g50 text-xs font-bold text-g600">{label}</span>
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Ім'я" maxLength={60} className={`${INPUT} min-w-0 flex-1`} />
      <select
        value={u}
        onChange={(e) => {
          setU(e.target.value);
          const s = staff.find((x) => x.id === e.target.value);
          if (s && !n.trim()) setN(s.name);
        }}
        className={`${INPUT} max-w-[45%]`}
      >
        <option value="">не з команди</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.roleLabel}
          </option>
        ))}
      </select>
      {dirty && (
        <button type="button" disabled={busy} onClick={() => void save()} className={DARK}>
          Зберегти
        </button>
      )}
      {evidence && <p className="w-full pl-9 text-[11px] text-g500">{evidence}</p>}
      {err && <p className="w-full pl-9 text-[12px] text-red-700">{err}</p>}
    </div>
  );
}

function UploadPanel({ meetingId, onDone }: { meetingId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    setErr(null);
    setProgress(0);
    try {
      await uploadMeetingAudio({
        meetingId,
        blob: file,
        fileName: file.name,
        onStage: setStage,
        onProgress: setProgress,
      });
      setStage(null);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося завантажити");
      setStage(null);
    }
  };

  return (
    <Card className="flex flex-col gap-2">
      <p className="text-[13px] text-bk">Аудіо ще не завантажено. Додайте файл запису — обробка почнеться сама.</p>
      <input type="file" accept={AUDIO_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
      <button type="button" disabled={!file || !!stage} onClick={() => void go()} className={`${DARK} self-start`}>
        {stage === "uploading" ? `Завантажую… ${progress}%` : stage ? "Хвилинку…" : "Завантажити"}
      </button>
      {err && <p className="text-[12px] text-red-700">{err}</p>}
    </Card>
  );
}
