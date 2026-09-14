/**
 * Наради: створення, аудіо, повтори, спікери, видалення.
 *
 * Сайт тут лише пише стан — розпізнає й підсумовує воркер
 * (src/lib/meetings/process.ts). Тому жоден роут нарад не чекає на AssemblyAI
 * чи OpenAI і не впирається в ліміт часу функцій Vercel. Metrum робив навпаки
 * — і нарада, вкладку з якою закрили на півдорозі, так і лишалась без підсумку.
 *
 * Модуль без next/* — роути самі перетворюють MeetingError на відповідь.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteFile, fileSize, presignedPutUrl, signedUrl } from "@/lib/r2";
import { listTasks } from "@/lib/tasks";
import { deleteTranscript } from "./assemblyai";
import { MAX_AUDIO_BYTES, audioKey, isAcceptableAudio, isMeetingKey, normalizeContentType } from "./keys";
import {
  MEETING_STATUS_LABELS,
  MEETINGS_TICK_KEY,
  MEETINGS_TICK_STALE_MS,
  STAFF_ROLE_LIST,
  asMeetingStatus,
  defaultMeetingTitle,
  parseSpeakerMap,
  speakerKey,
  type MeetingDetail,
  type MeetingRow,
  type MeetingStructured,
  type SpeakerMap,
  type Utterance,
  type WorkerState,
} from "./types";

/**
 * Хто бачить наради. Лише власник: це розмови керівництва про всю команду,
 * борги й людей. Задачі з нарад менеджер бачить у /admin/tasks.
 */
export const MEETING_ROLES = ["ADMIN"] as const;

export class MeetingError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2_000;
const NOTE_MIN = 20;
const NOTE_MAX = 200_000;
const SPEAKER_NAME_MAX = 60;
const UPLOAD_URL_TTL_S = 3600;
const PLAYBACK_URL_TTL_S = 3600;

function obj(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function parseRecordedAt(v: unknown): Date {
  const d = typeof v === "string" && v.trim() ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw new MeetingError("Дата наради не розпізнана");
  if (d.getTime() > Date.now() + 86_400_000) throw new MeetingError("Дата наради в майбутньому");
  if (d.getUTCFullYear() < 2020) throw new MeetingError("Дата наради задавня");
  return d;
}

type MeetingInput = { title?: string; description?: string | null; recordedAt?: Date; noteText?: string | null };

export function validateMeetingInput(input: unknown): MeetingInput {
  const o = obj(input);
  const out: MeetingInput = {};
  if ("title" in o) {
    const t = typeof o.title === "string" ? o.title.trim() : "";
    if (t.length > TITLE_MAX) throw new MeetingError(`Назва задовга: до ${TITLE_MAX} символів`);
    if (t) out.title = t;
  }
  if ("description" in o) {
    const d = typeof o.description === "string" ? o.description.trim() : "";
    if (d.length > DESCRIPTION_MAX) throw new MeetingError(`Контекст задовгий: до ${DESCRIPTION_MAX} символів`);
    out.description = d || null;
  }
  if ("recordedAt" in o && o.recordedAt) out.recordedAt = parseRecordedAt(o.recordedAt);
  if ("noteText" in o) {
    const n = typeof o.noteText === "string" ? o.noteText.trim() : "";
    if (n && n.length < NOTE_MIN) throw new MeetingError("Нотатка закоротка — з неї нічого не витягти");
    if (n.length > NOTE_MAX) throw new MeetingError("Нотатка задовга");
    out.noteText = n || null;
  }
  return out;
}

/* ---------- Читання ---------- */

const ROW_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  recordedAt: true,
  createdAt: true,
  audioR2Key: true,
  audioMimeType: true,
  audioSizeBytes: true,
  audioDurationMs: true,
  processingError: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.MeetingSelect;

type RowDb = Prisma.MeetingGetPayload<{ select: typeof ROW_SELECT }>;
type Counts = { proposed: number; sent: number };

async function taskCounts(ids: string[]): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>();
  if (ids.length === 0) return out;
  const groups = await prisma.staffTask.groupBy({
    by: ["meetingId", "status"],
    where: { meetingId: { in: ids } },
    _count: { _all: true },
  });
  for (const g of groups) {
    if (!g.meetingId) continue;
    const c = out.get(g.meetingId) ?? { proposed: 0, sent: 0 };
    if (g.status === "PROPOSED") c.proposed += g._count._all;
    if (g.status === "ASSIGNED" || g.status === "DONE") c.sent += g._count._all;
    out.set(g.meetingId, c);
  }
  return out;
}

function shapeRow(m: RowDb, counts: Counts | undefined): MeetingRow {
  const status = asMeetingStatus(m.status);
  // Текстова нарада не має аудіо й ніколи не буває чернеткою; аудіо в
  // чернетці — це ще не завершене завантаження.
  const hasAudio = !!m.audioR2Key && status !== "DRAFT";
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    status,
    statusLabel: MEETING_STATUS_LABELS[status],
    recordedAt: m.recordedAt.toISOString(),
    createdAt: m.createdAt.toISOString(),
    createdBy: { id: m.createdBy.id, name: m.createdBy.name.trim() },
    isTextNote: !m.audioR2Key && status !== "DRAFT",
    hasAudio,
    audioMimeType: m.audioMimeType,
    audioSizeBytes: hasAudio ? m.audioSizeBytes : null,
    audioDurationMs: m.audioDurationMs,
    processingError: m.processingError,
    tasksProposed: counts?.proposed ?? 0,
    tasksSent: counts?.sent ?? 0,
  };
}

/** Стан обробника: воркер пише мітку раз на хвилину, навіть коли черга порожня. */
export async function workerState(now = new Date()): Promise<WorkerState> {
  const tick = await prisma.syncState.findUnique({ where: { key: MEETINGS_TICK_KEY } });
  if (!tick) return { lastTickAt: null, stale: true, missing: [] };
  let missing: string[] = [];
  try {
    const v = JSON.parse(tick.value) as { missing?: unknown };
    if (Array.isArray(v.missing)) missing = v.missing.filter((x): x is string => typeof x === "string");
  } catch {
    /* стара мітка без JSON */
  }
  return {
    lastTickAt: tick.updatedAt.toISOString(),
    stale: now.getTime() - tick.updatedAt.getTime() > MEETINGS_TICK_STALE_MS,
    missing,
  };
}

export async function listMeetings(limit = 100): Promise<{ items: MeetingRow[]; worker: WorkerState }> {
  const rows = await prisma.meeting.findMany({
    select: ROW_SELECT,
    orderBy: { recordedAt: "desc" },
    take: Math.min(limit, 300),
  });
  const [counts, worker] = await Promise.all([taskCounts(rows.map((r) => r.id)), workerState()]);
  return { items: rows.map((r) => shapeRow(r, counts.get(r.id))), worker };
}

function parseUtterances(raw: unknown): Utterance[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((u) => {
    if (!u || typeof u !== "object") return [];
    const o = u as Record<string, unknown>;
    if (typeof o.text !== "string") return [];
    return [{ speaker: String(o.speaker ?? "A"), start: Number(o.start) || 0, end: Number(o.end) || 0, text: o.text }];
  });
}

function parseStructured(raw: unknown): MeetingStructured | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Partial<MeetingStructured>;
  if (typeof o.summary !== "string") return null;
  return {
    suggestedTitle: o.suggestedTitle ?? "",
    summary: o.summary,
    speakers: Array.isArray(o.speakers) ? o.speakers : [],
    keyPoints: Array.isArray(o.keyPoints) ? o.keyPoints : [],
    decisions: Array.isArray(o.decisions) ? o.decisions : [],
    tasks: Array.isArray(o.tasks) ? o.tasks : [],
    progressUpdates: Array.isArray(o.progressUpdates) ? o.progressUpdates : [],
    openQuestions: Array.isArray(o.openQuestions) ? o.openQuestions : [],
  };
}

export async function getMeeting(id: string): Promise<MeetingDetail> {
  const m = await prisma.meeting.findUnique({
    where: { id },
    select: {
      ...ROW_SELECT,
      noteText: true,
      transcript: true,
      utterances: true,
      speakerCount: true,
      speakerMap: true,
      summary: true,
      structured: true,
      aiModel: true,
      aiPromptTokens: true,
      aiCompletionTokens: true,
      transcribeAttempts: true,
      summarizeAttempts: true,
      processedAt: true,
    },
  });
  if (!m) throw new MeetingError("Нараду не знайдено", 404);
  const [counts, tasks, worker] = await Promise.all([taskCounts([id]), listTasks({ meetingId: id }), workerState()]);
  return {
    ...shapeRow(m, counts.get(id)),
    noteText: m.noteText,
    transcript: m.transcript,
    utterances: parseUtterances(m.utterances),
    speakerCount: m.speakerCount,
    speakerMap: parseSpeakerMap(m.speakerMap),
    summary: m.summary,
    structured: parseStructured(m.structured),
    aiModel: m.aiModel,
    aiPromptTokens: m.aiPromptTokens,
    aiCompletionTokens: m.aiCompletionTokens,
    transcribeAttempts: m.transcribeAttempts,
    summarizeAttempts: m.summarizeAttempts,
    processedAt: m.processedAt?.toISOString() ?? null,
    tasks: tasks.filter((t) => t.status !== "CANCELLED" || t.sentAt),
    worker,
  };
}

/* ---------- Запис ---------- */

/** Ідентифікатор від браузера: uuid або подібне, без символів, небезпечних у шляху R2. */
const CLIENT_ID = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Створити нараду.
 *
 * Браузер може передати власний id — тоді повторний виклик із тим самим id
 * повертає вже створену нараду, а не другу. Потрібно, бо відповідь на
 * створення буває втрачено дорогою (Safari й обірване з'єднання): сервер
 * нараду записав, а сторінка про це не знає і натискає ще раз.
 */
export async function createMeeting(createdById: string, input: unknown): Promise<MeetingDetail> {
  const v = validateMeetingInput(input);
  const rawId = obj(input).id;
  const clientId = typeof rawId === "string" && CLIENT_ID.test(rawId) ? rawId : undefined;

  const existingOf = async (id: string): Promise<MeetingDetail | null> => {
    const found = await prisma.meeting.findUnique({ where: { id }, select: { createdById: true } });
    if (!found) return null;
    if (found.createdById !== createdById) throw new MeetingError("Нарада з таким ідентифікатором уже існує", 409);
    return getMeeting(id);
  };

  if (clientId) {
    const existing = await existingOf(clientId);
    if (existing) return existing;
  }

  const recordedAt = v.recordedAt ?? new Date();
  const isNote = !!v.noteText;
  try {
    const row = await prisma.meeting.create({
      data: {
        ...(clientId ? { id: clientId } : {}),
        title: v.title ?? defaultMeetingTitle(recordedAt),
        description: v.description ?? null,
        recordedAt,
        createdById,
        noteText: v.noteText ?? null,
        // Нотатку розпізнавати нема чого — одразу в чергу на підсумок.
        status: isNote ? "TRANSCRIBED" : "DRAFT",
        transcribedAt: isNote ? new Date() : null,
      },
      select: { id: true },
    });
    return getMeeting(row.id);
  } catch (e) {
    // Два повтори одночасно: перший уже записав — віддаємо його.
    if (clientId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await existingOf(clientId);
      if (existing) return existing;
    }
    throw e;
  }
}

export async function updateMeeting(id: string, input: unknown): Promise<MeetingDetail> {
  const v = validateMeetingInput(input);
  const data: Prisma.MeetingUpdateInput = {};
  if (v.title !== undefined) data.title = v.title;
  if (v.description !== undefined) data.description = v.description;
  if (v.recordedAt !== undefined) data.recordedAt = v.recordedAt;
  const res = await prisma.meeting.updateMany({ where: { id }, data });
  if (res.count === 0) throw new MeetingError("Нараду не знайдено", 404);
  return getMeeting(id);
}

/**
 * Видати посилання на завантаження аудіо.
 *
 * Ключ записуємо в нараду одразу, ще в чернетці: якщо завантаження не
 * завершиться, прибиральник воркера знатиме, який об'єкт стерти.
 */
export async function prepareUpload(
  id: string,
  input: unknown
): Promise<{ uploadUrl: string; key: string; contentType: string }> {
  const o = obj(input);
  const fileName = typeof o.fileName === "string" && o.fileName.trim() ? o.fileName.trim().slice(0, 200) : "audio";
  const rawType = typeof o.contentType === "string" ? o.contentType : "";
  const size = typeof o.size === "number" ? o.size : Number(o.size);
  if (!Number.isFinite(size) || size <= 0) throw new MeetingError("Файл порожній");
  if (size > MAX_AUDIO_BYTES) {
    throw new MeetingError(`Файл завеликий: до ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} МБ`, 413);
  }
  if (!isAcceptableAudio(rawType, fileName)) {
    throw new MeetingError("Це не схоже на аудіо: підійде m4a, mp3, webm, ogg, wav");
  }

  const m = await prisma.meeting.findUnique({
    where: { id },
    select: { status: true, noteText: true, transcript: true, audioR2Key: true },
  });
  if (!m) throw new MeetingError("Нараду не знайдено", 404);
  if (m.noteText) throw new MeetingError("Це текстова нарада — аудіо до неї не додається", 409);
  if (m.status !== "DRAFT" && m.status !== "FAILED") throw new MeetingError("Аудіо вже завантажено", 409);
  if (m.transcript) throw new MeetingError("Текст уже розпізнано — повторіть підсумок", 409);

  const contentType = normalizeContentType(rawType || "application/octet-stream");
  const key = audioKey(id, fileName, contentType);
  const uploadUrl = await presignedPutUrl(key, contentType, UPLOAD_URL_TTL_S);

  await prisma.meeting.update({
    where: { id },
    data: {
      status: "DRAFT",
      audioR2Key: key,
      audioMimeType: contentType,
      audioSizeBytes: Math.round(size),
      processingError: null,
    },
  });

  // Попередній файл цієї наради (невдалий чи недовантажений) більше не потрібен.
  if (m.audioR2Key && m.audioR2Key !== key) {
    await deleteFile(m.audioR2Key).catch((e) => console.warn("[meetings] старе аудіо не стерлось:", e));
  }

  return { uploadUrl, key, contentType };
}

/** Браузер доклав файл у R2 — перевіряємо, що він там справді є, і ставимо в чергу. */
export async function completeUpload(id: string, input: unknown): Promise<MeetingDetail> {
  const o = obj(input);
  const key = typeof o.key === "string" ? o.key : "";
  const m = await prisma.meeting.findUnique({ where: { id }, select: { status: true, audioR2Key: true } });
  if (!m) throw new MeetingError("Нараду не знайдено", 404);
  if (!isMeetingKey(id, key) || m.audioR2Key !== key) {
    throw new MeetingError("Файл не збігається з очікуваним — почніть завантаження спочатку", 409);
  }
  // Повторний виклик після успіху (обірвалась відповідь) — не помилка.
  if (m.status !== "DRAFT") return getMeeting(id);

  const size = await fileSize(key);
  if (!size) throw new MeetingError("Файл не долетів до сховища — завантажте ще раз", 404);

  const dur = Number(o.durationMs);
  const durationMs = Number.isFinite(dur) && dur > 0 && dur < 12 * 3600_000 ? Math.round(dur) : null;

  await prisma.meeting.updateMany({
    where: { id, status: "DRAFT", audioR2Key: key },
    data: {
      status: "UPLOADED",
      audioSizeBytes: size,
      audioDurationMs: durationMs,
      uploadedAt: new Date(),
      transcribeAttempts: 0,
      summarizeAttempts: 0,
      processingError: null,
      lockedAt: null,
      nextAttemptAt: null,
      lastPolledAt: null,
      assemblyTranscriptId: null,
    },
  });
  return getMeeting(id);
}

/** Повтор після FAILED: є текст — лише підсумок, інакше розпізнавання з початку. */
export async function retryMeeting(id: string): Promise<MeetingDetail> {
  const m = await prisma.meeting.findUnique({
    where: { id },
    select: { status: true, transcript: true, noteText: true, audioR2Key: true },
  });
  if (!m) throw new MeetingError("Нараду не знайдено", 404);
  if (m.status !== "FAILED") throw new MeetingError("Повторити можна лише нараду з помилкою", 409);
  const next = m.transcript || m.noteText ? "TRANSCRIBED" : m.audioR2Key ? "UPLOADED" : null;
  if (!next) throw new MeetingError("Немає ні аудіо, ні тексту — завантажте запис", 409);

  await prisma.meeting.updateMany({
    where: { id, status: "FAILED" },
    data: {
      status: next,
      transcribeAttempts: 0,
      summarizeAttempts: 0,
      processingError: null,
      lockedAt: null,
      nextAttemptAt: null,
      lastPolledAt: null,
      assemblyTranscriptId: null,
    },
  });
  return getMeeting(id);
}

/**
 * Перескласти підсумок готової наради.
 *
 * Транскрипт оплачений і лишається. Непідтверджені задачі стираються й
 * народяться заново; надіслані й виконані лишаються — модель побачить їх як
 * відомі, тож дублів не буде.
 */
export async function regenerateMeeting(id: string): Promise<MeetingDetail> {
  const m = await prisma.meeting.findUnique({ where: { id }, select: { status: true, transcript: true, noteText: true } });
  if (!m) throw new MeetingError("Нараду не знайдено", 404);
  if (m.status !== "READY") throw new MeetingError("Перескласти можна лише готовий підсумок", 409);
  if (!m.transcript && !m.noteText) throw new MeetingError("Немає тексту наради", 409);

  await prisma.$transaction([
    prisma.staffTask.deleteMany({ where: { meetingId: id, status: "PROPOSED" } }),
    prisma.meeting.update({
      where: { id },
      data: { status: "TRANSCRIBED", summarizeAttempts: 0, processingError: null, lockedAt: null, nextAttemptAt: null },
    }),
  ]);
  return getMeeting(id);
}

/** Хто є хто за лейблом: ім'я і, якщо це хтось із команди, його обліковий запис. */
export async function renameSpeaker(id: string, input: unknown): Promise<SpeakerMap> {
  const o = obj(input);
  const label = typeof o.label === "string" ? speakerKey(o.label) : "";
  if (!/^[A-Z]{1,3}$/.test(label)) throw new MeetingError("Невідомий спікер");
  const name = typeof o.name === "string" ? o.name.trim().slice(0, SPEAKER_NAME_MAX) : "";
  const userId = typeof o.userId === "string" && o.userId ? o.userId : null;

  let staffName: string | null = null;
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } });
    if (!u || !(STAFF_ROLE_LIST as readonly string[]).includes(u.role)) {
      throw new MeetingError("Людину не знайдено серед персоналу", 404);
    }
    staffName = u.name.trim();
  }

  const m = await prisma.meeting.findUnique({ where: { id }, select: { speakerMap: true, structured: true } });
  if (!m) throw new MeetingError("Нараду не знайдено", 404);

  const map = parseSpeakerMap(m.speakerMap);
  map[label] = { name: name || staffName, userId };

  const structured = parseStructured(m.structured);
  if (structured) {
    structured.speakers = structured.speakers.map((s) =>
      speakerKey(s.label) === label ? { ...s, guessedName: name || staffName, userId } : s
    );
  }

  await prisma.meeting.update({
    where: { id },
    data: {
      speakerMap: map as unknown as Prisma.InputJsonValue,
      ...(structured ? { structured: structured as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  return map;
}

/**
 * Видалити нараду разом із записом у R2 і транскриптом в AssemblyAI.
 *
 * Непідтверджені задачі йдуть разом із нарадою; надіслані лишаються
 * (meetingId стає null) — людина могла вже їх виконувати.
 */
export async function deleteMeeting(id: string): Promise<void> {
  const m = await prisma.meeting.findUnique({ where: { id }, select: { audioR2Key: true, assemblyTranscriptId: true } });
  if (!m) throw new MeetingError("Нараду не знайдено", 404);

  await prisma.$transaction([
    prisma.staffTask.deleteMany({ where: { meetingId: id, status: "PROPOSED" } }),
    prisma.meeting.delete({ where: { id } }),
  ]);

  if (m.audioR2Key) {
    await deleteFile(m.audioR2Key).catch((e) => console.warn("[meetings] аудіо не стерлось:", e));
  }
  if (m.assemblyTranscriptId) await deleteTranscript(m.assemblyTranscriptId);
}

/** Підписане посилання для плеєра: бакет публічний, але адреси записів ніде не світяться. */
export async function playbackUrl(id: string): Promise<string> {
  const m = await prisma.meeting.findUnique({ where: { id }, select: { status: true, audioR2Key: true } });
  if (!m) throw new MeetingError("Нараду не знайдено", 404);
  if (!m.audioR2Key || m.status === "DRAFT") throw new MeetingError("Аудіо немає", 404);
  return signedUrl(m.audioR2Key, PLAYBACK_URL_TTL_S);
}
