"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Mic, Pause, Play, Square, Upload } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MAX_RECORD_MS, useMeetingRecording } from "@/components/meetings/MeetingRecordingProvider";
import { NetworkError, megabytes, newClientId, sendJson } from "@/components/meetings/api";
import { uploadMeetingAudio, type UploadStage } from "@/components/meetings/upload";
import { useIsNativeApp } from "@/lib/useIsNativeApp";
import { AUDIO_ACCEPT, MAX_AUDIO_BYTES } from "@/lib/meetings/keys";
import { formatClock, type MeetingDetail } from "@/lib/meetings/types";

/**
 * Нова нарада: запис у браузері, файл із диктофона або текстова нотатка.
 *
 * Після збереження сторінка одразу веде на нараду — обробку робить воркер,
 * і чекати на неї тут нема чого. Якщо нараду створено, а файл не долетів,
 * повторна спроба йде в ту саму нараду, а не плодить нову.
 */

type Tab = "record" | "file" | "text";
type Stage = "form" | "creating" | UploadStage;

const STAGE_LABEL: Record<Exclude<Stage, "form">, string> = {
  creating: "Створюю нараду…",
  preparing: "Готую завантаження…",
  uploading: "Завантажую запис…",
  finishing: "Перевіряю файл у сховищі…",
};

const CHIP = (active: boolean) =>
  `inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
    active ? "border-bk bg-bk text-white" : "border-g200 bg-white text-g600 hover:bg-g50"
  }`;
const INPUT = "w-full rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-[13px] text-bk";
const BTN = "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-btn)] px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50";
const DARK = `${BTN} bg-bk text-white`;
const LIGHT = `${BTN} border border-g200 bg-white text-g600 hover:bg-g50`;
const MAX_MB = Math.round(MAX_AUDIO_BYTES / 1024 / 1024);

/** Для <input type="datetime-local"> — місцевий час браузера. */
function localInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewMeetingScreen() {
  const router = useRouter();
  const isApp = useIsNativeApp();
  const rec = useMeetingRecording();

  // null — людина ще не вибирала. У застосунку тоді показуємо файл: запис у
  // WebView глухне, коли гасне екран.
  const [pickedTab, setTab] = useState<Tab | null>(null);
  const tab: Tab = pickedTab ?? (isApp && rec.state === "idle" ? "file" : "record");
  const [title, setTitle] = useState("");
  const [openedAt] = useState(() => localInput(Date.now()));
  // null — дату не правили: береться момент початку запису, а без запису — відкриття сторінки.
  const [editedAt, setRecordedAt] = useState<string | null>(null);
  const recordedAt = editedAt ?? (rec.recorded ? localInput(rec.recorded.startedAt) : openedAt);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [noteText, setNoteText] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  /**
   * Id нової наради видає браузер і тримає між натисканнями: якщо сервер
   * нараду створив, а відповідь загубилась, наступне «Зберегти» отримає ту
   * саму нараду, а не другу. Для запису й нотатки — окремі, щоб нотатка не
   * потрапила в чернетку аудіо.
   */
  const audioIdRef = useRef<string | null>(null);
  const textIdRef = useRef<string | null>(null);

  const previewUrl = useMemo(() => (rec.recorded ? URL.createObjectURL(rec.recorded.blob) : null), [rec.recorded]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  const busy = stage !== "form";

  const recordedAtIso = () => {
    const d = new Date(recordedAt);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  };

  const createMeeting = async (clientId: string, noteBody?: string): Promise<string> => {
    setStage("creating");
    const { item } = await sendJson<{ item: MeetingDetail }>(
      "/api/admin/meetings",
      "POST",
      {
        id: clientId,
        ...(title.trim() ? { title: title.trim() } : {}),
        description: description.trim() || null,
        recordedAt: recordedAtIso(),
        ...(noteBody ? { noteText: noteBody } : {}),
      },
      { retry: true }
    );
    return item.id;
  };

  const failText = (e: unknown, kept: string): string =>
    e instanceof NetworkError
      ? `Зв'язок із сервером обірвався. ${kept} — натисніть ще раз, коли з'явиться інтернет.`
      : e instanceof Error
        ? e.message
        : "Не вдалося зберегти";

  const submitAudio = async (blob: Blob, fileName: string, durationMs: number | null, fromRecording: boolean) => {
    setError(null);
    setProgress(0);
    try {
      audioIdRef.current ??= newClientId();
      const id = draftId ?? (await createMeeting(audioIdRef.current));
      setDraftId(id);
      await uploadMeetingAudio({ meetingId: id, blob, fileName, durationMs, onStage: setStage, onProgress: setProgress });
      if (fromRecording) rec.reset();
      audioIdRef.current = null;
      router.push(`/admin/meetings/${id}`);
    } catch (e) {
      setError(failText(e, fromRecording ? "Запис нікуди не зник, він на цій сторінці" : "Файл лишився вибраним"));
      setStage("form");
    }
  };

  const submitText = async () => {
    setError(null);
    try {
      textIdRef.current ??= newClientId();
      const id = await createMeeting(textIdRef.current, noteText.trim());
      textIdRef.current = null;
      router.push(`/admin/meetings/${id}`);
    } catch (e) {
      setError(failText(e, "Текст лишився у полі"));
      setStage("form");
    }
  };

  const recording = rec.state === "recording" || rec.state === "paused";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <Link href="/admin/meetings" className="text-[13px] text-g500 hover:text-bk">
          ← Наради
        </Link>
        <h1 className="mt-1 text-lg font-bold leading-tight text-bk">Нова нарада</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={CHIP(tab === "record")} onClick={() => setTab("record")}>
          <Mic size={14} /> Запис
        </button>
        <button type="button" className={CHIP(tab === "file")} onClick={() => setTab("file")}>
          <Upload size={14} /> Файл
        </button>
        <button type="button" className={CHIP(tab === "text")} onClick={() => setTab("text")}>
          <FileText size={14} /> Текст
        </button>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-g600">Назва</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Можна не заповнювати — складе підсумок"
              className={INPUT}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-g600">Коли була</span>
            <input type="datetime-local" value={recordedAt} onChange={(e) => setRecordedAt(e.target.value)} className={INPUT} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-g600">Контекст для підсумку</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Хто був, про що нарада, що передувало — допоможе впізнати людей і клієнтів"
            className={INPUT}
          />
        </label>
      </Card>

      {tab === "record" && (
        <Card className="flex flex-col gap-3">
          {isApp && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              У застосунку запис обривається, коли гасне екран чи дзвонять. Довгу нараду надійніше записати диктофоном
              телефона й завантажити файлом.
            </p>
          )}

          {!rec.supported ? (
            <p className="text-[13px] text-g600">Цей браузер не вміє записувати звук — завантажте файл із диктофона.</p>
          ) : recording ? (
            <>
              <div className="flex items-center justify-between">
                <span
                  className={`font-mono text-3xl font-bold tabular-nums ${rec.state === "recording" ? "text-red-600" : "text-bk"}`}
                >
                  {formatClock(rec.elapsedMs)}
                </span>
                <span className="text-[12px] text-g500">{rec.state === "recording" ? "іде запис" : "пауза"}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-g50">
                <div
                  className="h-full bg-red-500"
                  style={{ width: `${Math.min(100, (rec.elapsedMs / MAX_RECORD_MS) * 100)}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {rec.state === "recording" ? (
                  <button type="button" onClick={rec.pause} className={LIGHT}>
                    <Pause size={16} /> Пауза
                  </button>
                ) : (
                  <button type="button" onClick={rec.resume} className={DARK}>
                    <Play size={16} /> Продовжити
                  </button>
                )}
                <button type="button" onClick={rec.stop} className={`${BTN} bg-red-600 text-white`}>
                  <Square size={14} /> Зупинити
                </button>
              </div>
              <p className="text-[12px] text-g500">
                {rec.wakeLockActive
                  ? "Екран не гасне, поки йде запис. Можна перейти на іншу сторінку адмінки — внизу буде таймер."
                  : "Не давайте екрану згаснути — інакше браузер може забрати мікрофон."}
              </p>
            </>
          ) : rec.recorded && previewUrl ? (
            <>
              <audio controls src={previewUrl} className="w-full" />
              <p className="text-[12px] text-g500">
                {formatClock(rec.recorded.durationMs)} · {megabytes(rec.recorded.blob.size)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const r = rec.recorded;
                    if (r) void submitAudio(r.blob, r.fileName, r.durationMs, true);
                  }}
                  className={DARK}
                >
                  Зберегти й обробити
                </button>
                <a href={previewUrl} download={rec.recorded.fileName} className={LIGHT}>
                  Зберегти файл на диск
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Видалити цей запис і почати новий?")) rec.reset();
                  }}
                  className={LIGHT}
                >
                  Записати заново
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void rec.start()} className={`${BTN} bg-red-600 py-3 text-sm text-white`}>
                <Mic size={18} /> Почати запис
              </button>
              <p className="text-[12px] text-g500">
                До 90 хвилин. Покладіть телефон чи ноутбук посередині столу — розпізнавання розділить голоси.
              </p>
            </>
          )}
          {rec.error && <p className="text-[12px] text-red-700">{rec.error}</p>}
        </Card>
      )}

      {tab === "file" && (
        <Card className="flex flex-col gap-3">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-g200 px-4 py-6 text-center hover:bg-g50">
            <Upload size={22} className="text-g400" />
            <span className="text-[13px] font-medium text-bk">{file ? file.name : "Оберіть файл запису"}</span>
            <span className="text-[12px] text-g500">
              {file ? megabytes(file.size) : `m4a з диктофона, mp3, ogg із месенджера, webm, wav — до ${MAX_MB} МБ`}
            </span>
            <input
              type="file"
              accept={AUDIO_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setError(null);
                if (f && f.size > MAX_AUDIO_BYTES) {
                  setError(`Файл завеликий: до ${MAX_MB} МБ`);
                  setFile(null);
                  return;
                }
                setFile(f);
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || !file}
            onClick={() => file && void submitAudio(file, file.name, null, false)}
            className={DARK}
          >
            Завантажити й обробити
          </button>
        </Card>
      )}

      {tab === "text" && (
        <Card className="flex flex-col gap-3">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={12}
            maxLength={200_000}
            placeholder={
              "Що обговорили, що вирішили, кому що зробити.\nАндрій — заїхати до Кунанця до п'ятниці, забрати повернення.\nСклад — зібрати накладну Стройдвору завтра."
            }
            className={INPUT}
          />
          <button type="button" disabled={busy || noteText.trim().length < 20} onClick={() => void submitText()} className={DARK}>
            Скласти підсумок
          </button>
        </Card>
      )}

      {busy && (
        <Card>
          <p className="text-[13px] font-medium text-bk">
            {stage === "uploading" ? `Завантажую запис… ${progress}%` : STAGE_LABEL[stage as Exclude<Stage, "form">]}
          </p>
          {stage === "uploading" && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-g50">
              <div className="h-full bg-bk transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          )}
          <p className="mt-1 text-[12px] text-g500">Не закривайте сторінку, поки файл не завантажиться.</p>
        </Card>
      )}

      {error && (
        <div className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
          {error}
          {draftId && (
            <>
              {" "}
              Нараду вже створено — спробуйте ще раз або{" "}
              <Link href={`/admin/meetings/${draftId}`} className="underline">
                відкрийте її
              </Link>{" "}
              і завантажте файл там.
            </>
          )}
        </div>
      )}
    </div>
  );
}
