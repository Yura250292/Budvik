/**
 * Конвеєр нарад на воркері: аудіо → текст → підсумок → пропозиції задач.
 *
 * Тік кожні 20 секунд (worker/index.ts). Кожен крок — атомарне захоплення
 * рядка через updateMany зі статусом у where і лише потім робота: під час
 * railway up стара й нова копії воркера живуть одночасно, і findFirst + update
 * дав би обом узяти ту саму нараду й заплатити двічі.
 *
 * Що переживає перезапуск:
 * - id транскрипту AssemblyAI зберігається до опитування — новий контейнер
 *   просто питає про нього далі;
 * - TRANSCRIBING без id і SUMMARIZING зі старим замком (> 10 хв) — воркер
 *   помер посеред кроку; повертаємо на крок назад;
 * - невдалий підсумок ніколи не веде до повторного розпізнавання: транскрипт
 *   уже оплачений.
 *
 * Модуль без next/* — його збирає воркер (CLAUDE.md).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd } from "@/lib/date/kyiv";
import { deleteFile, isR2Configured, signedUrl } from "@/lib/r2";
import { getTranscript, renderTranscript, submitTranscript, transcriptErrorKind } from "./assemblyai";
import { ProviderError, asProviderError } from "./errors";
import { chatJson } from "./openai";
import { repForClient, resolveClient } from "./resolve";
import {
  MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS_COMPACT,
  RESPONSE_SCHEMA,
  SUMMARY_SCHEMA_NAME,
  SUMMARY_TEMPERATURE,
  SYSTEM_PROMPT,
  buildUserPrompt,
  validateStructured,
  type SpeakerHint,
  type StaffRef,
  type TaskRef,
} from "./summarize";
import {
  AUTO_TITLE,
  CONFIDENCE_GUESS,
  CONFIDENCE_SURE,
  MEETINGS_TICK_KEY,
  PROGRESS_LABELS,
  STAFF_ROLE_LIST,
  parseSpeakerMap,
  speakerKey,
  type MeetingEntity,
  type SpeakerMap,
} from "./types";
import { collectWordBoost } from "./vocabulary";

const STALE_LOCK_MS = 10 * 60_000;
/** AssemblyAI розпізнає годину за кілька хвилин; шість годин у черзі — щось зламалось. */
const STUCK_TRANSCRIPT_MS = 6 * 3600_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2 * 60_000;
const POLL_EVERY_MS = 20_000;
const BATCH = 3;
const DRAFT_TTL_MS = 24 * 3600_000;
const CLEANUP_EVERY_MS = 3600_000;
const TICK_WRITE_EVERY_MS = 60_000;
/** Посилання на аудіо для AssemblyAI: забирає за секунди, живе пів години. */
const AUDIO_LINK_TTL_S = 30 * 60;
const OPEN_TASKS_FOR_PROMPT = 60;

export type ProcessLog = { id: string; title: string; from: string; to: string; note?: string };

let warnedMissing = false;
let lastCleanupAt = 0;
let lastTickWrite = 0;

export function meetingsMissingEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.ASSEMBLYAI_API_KEY) missing.push("ASSEMBLYAI_API_KEY");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!isR2Configured()) missing.push("R2_*");
  return missing;
}

/** Мітка «обробник живий» — сторінка нарад показує, коли її давно не було. */
async function markTick(now: Date, missing: string[]): Promise<void> {
  if (now.getTime() - lastTickWrite < TICK_WRITE_EVERY_MS) return;
  lastTickWrite = now.getTime();
  const value = JSON.stringify({ missing });
  await prisma.syncState.upsert({
    where: { key: MEETINGS_TICK_KEY },
    create: { key: MEETINGS_TICK_KEY, value },
    update: { value },
  });
}

const dueNow = (now: Date): Prisma.MeetingWhereInput => ({
  OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
});

export async function processMeetings(
  opts: { dry?: boolean; now?: Date; onlyId?: string } = {}
): Promise<ProcessLog[]> {
  const now = opts.now ?? new Date();
  const missing = meetingsMissingEnv();

  if (opts.dry) return planned(now, opts.onlyId);

  await markTick(now, missing);
  if (missing.length > 0) {
    if (!warnedMissing) {
      console.warn(`наради: обробку вимкнено — немає ${missing.join(", ")}`);
      warnedMissing = true;
    }
    return [];
  }

  const log: ProcessLog[] = [];
  await reclaimStale(now, log);
  await submitUploaded(now, opts.onlyId, log);
  await pollTranscribing(now, opts.onlyId, log);
  await summarizeTranscribed(now, opts.onlyId, log);
  if (now.getTime() - lastCleanupAt > CLEANUP_EVERY_MS) {
    lastCleanupAt = now.getTime();
    await cleanupDrafts(now, log);
  }
  return log;
}

/* ---------- Dry: що взяв би воркер ---------- */

const NEXT_STEP: Record<string, string> = {
  UPLOADED: "TRANSCRIBING",
  TRANSCRIBING: "TRANSCRIBED",
  TRANSCRIBED: "SUMMARIZING",
  SUMMARIZING: "READY",
};

async function planned(now: Date, onlyId?: string): Promise<ProcessLog[]> {
  const rows = await prisma.meeting.findMany({
    where: { status: { in: Object.keys(NEXT_STEP) }, ...(onlyId ? { id: onlyId } : {}) },
    select: { id: true, title: true, status: true, nextAttemptAt: true, lockedAt: true, assemblyTranscriptId: true },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });
  return rows.map((r) => {
    const notes = [
      r.nextAttemptAt && r.nextAttemptAt > now ? `чекає до ${r.nextAttemptAt.toISOString()}` : null,
      r.lockedAt ? `замок з ${r.lockedAt.toISOString()}` : null,
      r.assemblyTranscriptId ? `транскрипт ${r.assemblyTranscriptId}` : null,
    ].filter(Boolean);
    return { id: r.id, title: r.title, from: r.status, to: NEXT_STEP[r.status], note: notes.join("; ") || undefined };
  });
}

/* ---------- Невдачі ---------- */

type AttemptRow = { id: string; title: string; transcribeAttempts?: number; summarizeAttempts?: number };

async function failTranscribe(row: AttemptRow, err: unknown, now: Date, log: ProcessLog[]): Promise<void> {
  const e = asProviderError(err, "Розпізнавання");
  const message = e.message.slice(0, 1000);
  const retryAt = new Date(now.getTime() + RETRY_DELAY_MS);

  if (e.kind === "transient") {
    await prisma.meeting.updateMany({
      where: { id: row.id, status: "TRANSCRIBING" },
      data: { status: "UPLOADED", lockedAt: null, assemblyTranscriptId: null, nextAttemptAt: retryAt, processingError: message },
    });
    log.push({ id: row.id, title: row.title, from: "TRANSCRIBING", to: "UPLOADED", note: `повтор за 2 хв: ${message}` });
    return;
  }

  const attempts = (row.transcribeAttempts ?? 0) + 1;
  const failed = e.kind === "fatal" || attempts >= MAX_ATTEMPTS;
  await prisma.meeting.updateMany({
    where: { id: row.id, status: "TRANSCRIBING" },
    data: {
      status: failed ? "FAILED" : "UPLOADED",
      transcribeAttempts: attempts,
      lockedAt: null,
      assemblyTranscriptId: null,
      nextAttemptAt: failed ? null : retryAt,
      processingError: message,
    },
  });
  log.push({ id: row.id, title: row.title, from: "TRANSCRIBING", to: failed ? "FAILED" : "UPLOADED", note: message });
}

async function failSummarize(row: AttemptRow, err: unknown, now: Date, log: ProcessLog[]): Promise<void> {
  const e = asProviderError(err, "Підсумок");
  const message = e.message.slice(0, 1000);
  const retryAt = new Date(now.getTime() + RETRY_DELAY_MS);

  if (e.kind === "transient") {
    await prisma.meeting.updateMany({
      where: { id: row.id, status: "SUMMARIZING" },
      data: { status: "TRANSCRIBED", lockedAt: null, nextAttemptAt: retryAt, processingError: message },
    });
    log.push({ id: row.id, title: row.title, from: "SUMMARIZING", to: "TRANSCRIBED", note: `повтор за 2 хв: ${message}` });
    return;
  }

  const attempts = (row.summarizeAttempts ?? 0) + 1;
  const failed = e.kind === "fatal" || attempts >= MAX_ATTEMPTS;
  await prisma.meeting.updateMany({
    where: { id: row.id, status: "SUMMARIZING" },
    data: {
      status: failed ? "FAILED" : "TRANSCRIBED",
      summarizeAttempts: attempts,
      lockedAt: null,
      nextAttemptAt: failed ? null : retryAt,
      processingError: message,
    },
  });
  log.push({ id: row.id, title: row.title, from: "SUMMARIZING", to: failed ? "FAILED" : "TRANSCRIBED", note: message });
}

/* ---------- Кроки ---------- */

async function reclaimStale(now: Date, log: ProcessLog[]): Promise<void> {
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);

  // Воркер помер між захопленням і відправкою в AssemblyAI.
  const orphans = await prisma.meeting.updateMany({
    where: { status: "TRANSCRIBING", assemblyTranscriptId: null, lockedAt: { lt: staleBefore } },
    data: { status: "UPLOADED", lockedAt: null },
  });
  if (orphans.count > 0) {
    log.push({ id: "-", title: `${orphans.count} нарад`, from: "TRANSCRIBING", to: "UPLOADED", note: "замок протух до відправки" });
  }

  const stuck = await prisma.meeting.findMany({
    where: {
      status: "TRANSCRIBING",
      assemblyTranscriptId: { not: null },
      lockedAt: { lt: new Date(now.getTime() - STUCK_TRANSCRIPT_MS) },
    },
    select: { id: true, title: true, transcribeAttempts: true },
  });
  for (const s of stuck) {
    await failTranscribe(s, new ProviderError("Розпізнавання не завершилось за 6 годин", "retry"), now, log);
  }

  const summarizing = await prisma.meeting.findMany({
    where: { status: "SUMMARIZING", lockedAt: { lt: staleBefore } },
    select: { id: true, title: true, summarizeAttempts: true },
  });
  for (const s of summarizing) {
    await failSummarize(s, new ProviderError("Складання підсумку обірвалось — обробник перезапускався", "retry"), now, log);
  }
}

async function submitUploaded(now: Date, onlyId: string | undefined, log: ProcessLog[]): Promise<void> {
  const rows = await prisma.meeting.findMany({
    where: { AND: [{ status: "UPLOADED" }, dueNow(now), ...(onlyId ? [{ id: onlyId }] : [])] },
    orderBy: { uploadedAt: "asc" },
    take: BATCH,
    select: { id: true, title: true, audioR2Key: true, transcribeAttempts: true },
  });

  let vocabulary: string[] | null = null;
  for (const row of rows) {
    const claimed = await prisma.meeting.updateMany({
      where: { id: row.id, status: "UPLOADED" },
      data: { status: "TRANSCRIBING", lockedAt: now, lastPolledAt: null },
    });
    if (claimed.count !== 1) continue;

    try {
      if (!row.audioR2Key) throw new ProviderError("У нараді немає аудіо", "fatal");
      vocabulary ??= await collectWordBoost();
      const audioUrl = await signedUrl(row.audioR2Key, AUDIO_LINK_TTL_S);
      const { id: transcriptId, dropped } = await submitTranscript({ audioUrl, wordBoost: vocabulary });
      // lockedAt лишається часом відправки: за ним ловимо транскрипт, що завис.
      await prisma.meeting.updateMany({
        where: { id: row.id, status: "TRANSCRIBING" },
        data: { assemblyTranscriptId: transcriptId, lockedAt: now, lastPolledAt: now, processingError: null, nextAttemptAt: null },
      });
      log.push({
        id: row.id,
        title: row.title,
        from: "UPLOADED",
        to: "TRANSCRIBING",
        note: dropped.length ? `без ${dropped.join(", ")} (для uk не прийнято)` : undefined,
      });
    } catch (e) {
      await failTranscribe(row, e, now, log);
    }
  }
}

async function pollTranscribing(now: Date, onlyId: string | undefined, log: ProcessLog[]): Promise<void> {
  const threshold = new Date(now.getTime() - POLL_EVERY_MS);
  const pollable: Prisma.MeetingWhereInput = { OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: threshold } }] };
  const rows = await prisma.meeting.findMany({
    where: {
      AND: [{ status: "TRANSCRIBING", assemblyTranscriptId: { not: null } }, pollable, ...(onlyId ? [{ id: onlyId }] : [])],
    },
    take: 10,
    select: { id: true, title: true, assemblyTranscriptId: true, transcribeAttempts: true, audioDurationMs: true },
  });

  for (const row of rows) {
    const transcriptId = row.assemblyTranscriptId!;
    const claimed = await prisma.meeting.updateMany({
      where: { AND: [{ id: row.id, status: "TRANSCRIBING", assemblyTranscriptId: transcriptId }, pollable] },
      data: { lastPolledAt: now },
    });
    if (claimed.count !== 1) continue;

    let poll;
    try {
      poll = await getTranscript(transcriptId);
    } catch (e) {
      const pe = asProviderError(e, "AssemblyAI");
      if (pe.kind !== "transient") await failTranscribe(row, pe, now, log);
      continue;
    }

    if (poll.status === "queued" || poll.status === "processing") continue;

    if (poll.status === "error") {
      const message = poll.error ?? "помилка розпізнавання";
      await failTranscribe(row, new ProviderError(`AssemblyAI: ${message}`, transcriptErrorKind(message)), now, log);
      continue;
    }

    if (poll.utterances.length === 0) {
      await failTranscribe(row, new ProviderError("У записі не розпізнано мовлення", "fatal"), now, log);
      continue;
    }

    const done = await prisma.meeting.updateMany({
      where: { id: row.id, status: "TRANSCRIBING", assemblyTranscriptId: transcriptId },
      data: {
        status: "TRANSCRIBED",
        transcript: renderTranscript(poll.utterances),
        utterances: poll.utterances as unknown as Prisma.InputJsonValue,
        entities: poll.entities as unknown as Prisma.InputJsonValue,
        speakerCount: new Set(poll.utterances.map((u) => u.speaker)).size,
        audioDurationMs: poll.audioDurationMs ?? row.audioDurationMs,
        transcribedAt: now,
        lockedAt: null,
        nextAttemptAt: null,
        processingError: null,
      },
    });
    if (done.count === 1) {
      log.push({
        id: row.id,
        title: row.title,
        from: "TRANSCRIBING",
        to: "TRANSCRIBED",
        note: `${poll.utterances.length} реплік`,
      });
    }
  }
}

/* ---------- Підсумок ---------- */

export type PreparedPrompt = {
  meeting: { id: string; title: string; createdById: string; recordedAt: Date; summarizeAttempts: number };
  staff: StaffRef[];
  tasks: TaskRef[];
  speakerMap: SpeakerMap;
  text: string;
  truncated: boolean;
  compact: boolean;
};

/** Зібрати промпт без виклику моделі — і для воркера, і для скрипта перевірки. */
export async function preparePrompt(id: string): Promise<PreparedPrompt> {
  const m = await prisma.meeting.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      recordedAt: true,
      createdById: true,
      noteText: true,
      transcript: true,
      entities: true,
      speakerMap: true,
      summarizeAttempts: true,
    },
  });
  if (!m) throw new ProviderError("Нараду видалено", "fatal");
  const body = m.transcript?.trim() || m.noteText?.trim() || "";
  if (!body) throw new ProviderError("Немає ні транскрипту, ні нотатки", "fatal");

  const staffRows = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLE_LIST] } },
    select: { id: true, name: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const staff: StaffRef[] = staffRows.map((u, i) => ({ ref: i + 1, id: u.id, name: u.name.trim(), role: u.role }));
  const staffById = new Map(staff.map((s) => [s.id, s]));

  // Відкриті по всій фірмі плюс уже надіслані з цієї ж наради (при
  // переповторі підсумку), щоб модель не народила їх удруге.
  const taskRows = await prisma.staffTask.findMany({
    where: { OR: [{ status: "ASSIGNED" }, { meetingId: id, status: { in: ["ASSIGNED", "DONE"] } }] },
    orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }],
    take: OPEN_TASKS_FOR_PROMPT,
    select: { id: true, title: true, status: true, dueAt: true, assignee: { select: { name: true } } },
  });
  const tasks: TaskRef[] = taskRows.map((t, i) => ({
    ref: i + 1,
    id: t.id,
    title: t.title,
    assigneeName: t.assignee?.name.trim() ?? null,
    status: t.status,
    dueDay: t.dueAt ? kyivDate(t.dueAt) : null,
  }));

  const speakerMap = parseSpeakerMap(m.speakerMap);
  const speakers: SpeakerHint[] = Object.entries(speakerMap)
    .filter(([, v]) => v.name || v.userId)
    .map(([label, v]) => {
      const s = v.userId ? staffById.get(v.userId) : undefined;
      return { label, name: v.name ?? s?.name ?? "?", staffRef: s?.ref ?? null };
    });

  const entities: MeetingEntity[] = Array.isArray(m.entities)
    ? (m.entities as unknown[]).flatMap((e) => {
        const o = e as Record<string, unknown> | null;
        return o && typeof o.type === "string" && typeof o.text === "string" ? [{ type: o.type, text: o.text }] : [];
      })
    : [];

  const compact = m.summarizeAttempts > 0;
  const { text, truncated } = buildUserPrompt({
    recordedAt: m.recordedAt,
    title: m.title,
    description: m.description,
    isTextNote: !m.transcript?.trim(),
    body,
    staff,
    openTasks: tasks,
    speakers,
    entities,
    compact,
  });

  return {
    meeting: { id: m.id, title: m.title, createdById: m.createdById, recordedAt: m.recordedAt, summarizeAttempts: m.summarizeAttempts },
    staff,
    tasks,
    speakerMap,
    text,
    truncated,
    compact,
  };
}

async function summarizeOne(id: string, now: Date): Promise<string> {
  const p = await preparePrompt(id);
  const res = await chatJson({
    system: SYSTEM_PROMPT,
    user: p.text,
    schemaName: SUMMARY_SCHEMA_NAME,
    schema: RESPONSE_SCHEMA,
    maxTokens: p.compact ? MAX_OUTPUT_TOKENS_COMPACT : MAX_OUTPUT_TOKENS,
    temperature: SUMMARY_TEMPERATURE,
  });

  let validated;
  try {
    validated = validateStructured(res.parsed, {
      staffByRef: new Map(p.staff.map((s) => [s.ref, s])),
      taskByRef: new Map(p.tasks.map((t) => [t.ref, t])),
      recordedAt: p.meeting.recordedAt,
    });
  } catch (e) {
    throw new ProviderError(e instanceof Error ? e.message : "Відповідь моделі не пройшла перевірку", "retry");
  }
  const { structured, warnings } = validated;
  if (warnings.length) console.warn(`наради: ${p.meeting.title}: ${warnings.join("; ")}`);

  const staffById = new Map(p.staff.map((s) => [s.id, s]));
  const creates: Prisma.StaffTaskCreateManyInput[] = [];
  for (const t of structured.tasks) {
    let assigneeId = t.assigneeUserId;
    let assigneeConfidence = assigneeId ? CONFIDENCE_SURE : 0;
    const assignee = assigneeId ? staffById.get(assigneeId) : undefined;

    const client = t.clientNameHeard
      ? await resolveClient({
          nameHeard: t.clientNameHeard,
          hint: t.clientHint,
          repId: assignee?.role === "SALES" ? assignee.id : p.meeting.createdById,
          repIsSales: assignee?.role === "SALES",
        })
      : null;

    // Кому — не сказали, а клієнт однозначний: підказуємо його торгового,
    // але як здогад — у «Надіслати всі» така задача не піде.
    if (!assigneeId && client?.counterpartyId) {
      const rep = await repForClient(client.counterpartyId);
      if (rep) {
        assigneeId = rep;
        assigneeConfidence = CONFIDENCE_GUESS;
      }
    }

    creates.push({
      meetingId: id,
      createdById: p.meeting.createdById,
      assigneeId,
      assigneeNameHeard: t.assigneeNameHeard,
      assigneeConfidence,
      counterpartyId: client?.counterpartyId ?? null,
      clientNameHeard: t.clientNameHeard,
      clientHint: t.clientHint,
      ...(client && !client.counterpartyId && client.candidates.length > 0
        ? { clientCandidates: client.candidates as unknown as Prisma.InputJsonValue }
        : {}),
      clientConfidence: client ? client.confidence : null,
      title: t.title,
      details: t.details,
      dueAt: t.dueDate ? kyivDayEnd(t.dueDate) : null,
      priority: t.priority,
      status: "PROPOSED",
    });
  }

  // Імена спікерів від моделі — лише якщо керівник ще нікого не перейменував.
  let speakerMap = p.speakerMap;
  if (Object.keys(speakerMap).length === 0 && structured.speakers.length > 0) {
    speakerMap = Object.fromEntries(
      structured.speakers.map((s) => [speakerKey(s.label), { name: s.guessedName, userId: s.userId }])
    );
  }

  const title = AUTO_TITLE.test(p.meeting.title) && structured.suggestedTitle ? structured.suggestedTitle : p.meeting.title;

  await prisma.$transaction(
    async (tx) => {
      const upd = await tx.meeting.updateMany({
        where: { id, status: "SUMMARIZING" },
        data: {
          status: "READY",
          title,
          summary: structured.summary,
          structured: structured as unknown as Prisma.InputJsonValue,
          speakerMap: speakerMap as unknown as Prisma.InputJsonValue,
          aiModel: res.model,
          aiPromptTokens: res.promptTokens,
          aiCompletionTokens: res.completionTokens,
          processedAt: now,
          lockedAt: null,
          nextAttemptAt: null,
          processingError: p.truncated ? "Текст наради задовгий — підсумок складено з першої частини" : null,
        },
      });
      // Нараду видалили чи перезапустили під час виклику моделі — нічого не пишемо.
      if (upd.count !== 1) throw new ProviderError("Нарада змінилась під час складання підсумку", "transient");

      if (creates.length > 0) await tx.staffTask.createMany({ data: creates });
      for (const u of structured.progressUpdates) {
        await tx.staffTask.updateMany({
          where: { id: u.taskId },
          data: { progressNote: `${PROGRESS_LABELS[u.status]}: ${u.note}`, progressAt: now, progressMeetingId: id },
        });
      }
    },
    { timeout: 30_000 }
  );

  return [
    `${creates.length} задач`,
    structured.progressUpdates.length ? `${structured.progressUpdates.length} по попередніх` : null,
    `${res.promptTokens}+${res.completionTokens} токенів`,
    warnings.length ? `попереджень ${warnings.length}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

async function summarizeTranscribed(now: Date, onlyId: string | undefined, log: ProcessLog[]): Promise<void> {
  const rows = await prisma.meeting.findMany({
    where: { AND: [{ status: "TRANSCRIBED" }, dueNow(now), ...(onlyId ? [{ id: onlyId }] : [])] },
    orderBy: { transcribedAt: "asc" },
    take: BATCH,
    select: { id: true, title: true, summarizeAttempts: true },
  });

  for (const row of rows) {
    const claimed = await prisma.meeting.updateMany({
      where: { id: row.id, status: "TRANSCRIBED" },
      data: { status: "SUMMARIZING", lockedAt: now },
    });
    if (claimed.count !== 1) continue;
    try {
      const note = await summarizeOne(row.id, now);
      log.push({ id: row.id, title: row.title, from: "TRANSCRIBED", to: "READY", note });
    } catch (e) {
      await failSummarize(row, e, now, log);
    }
  }
}

/** Чернетки без аудіо й тексту, покинуті на добу, — разом із недовантаженим файлом. */
async function cleanupDrafts(now: Date, log: ProcessLog[]): Promise<void> {
  const old = await prisma.meeting.findMany({
    where: { status: "DRAFT", noteText: null, transcript: null, updatedAt: { lt: new Date(now.getTime() - DRAFT_TTL_MS) } },
    select: { id: true, title: true, audioR2Key: true },
    take: 20,
  });
  for (const d of old) {
    const del = await prisma.meeting.deleteMany({ where: { id: d.id, status: "DRAFT" } });
    if (del.count !== 1) continue;
    if (d.audioR2Key) await deleteFile(d.audioR2Key).catch(() => {});
    log.push({ id: d.id, title: d.title, from: "DRAFT", to: "видалено", note: "покинута чернетка" });
  }
}
