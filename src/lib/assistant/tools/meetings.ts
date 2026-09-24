/**
 * Наради і задачі команді — щоб помічник керівника (і MCP-конектор) був
 * у курсі того, що вирішили й кому що доручили.
 *
 * Наради записують і розбирають на сайті (/admin/meetings, src/lib/meetings):
 * воркер транскрибує запис і складає структурований підсумок — теми з
 * пунктами, рішення, ризики, відкриті питання, згаданих клієнтів, задачі.
 * Задачі (StaffTask) спершу PROPOSED — людям ідуть лише після підтвердження.
 *
 * Окремий інструмент, а не режим наявного: наради — своя тема, яку жоден
 * звіт про продажі, склад чи зміни не покриває (так само свідомо колись
 * додали export_file). Усередині — три режими, щоб далі рости режимами.
 *
 * Нічого не пише.
 */

import type { Prisma } from "@prisma/client";
import type { ToolDef } from "@/lib/assistant/types";
import { enumOf, int, str } from "@/lib/assistant/validate";
import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { parseStructured } from "@/lib/meetings";
import { MEETING_STATUS_LABELS, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, asMeetingStatus, asTaskPriority, asTaskStatus } from "@/lib/meetings/types";

const LIST_LIMIT = 10;
/** Скільки символів транскрипту навколо знайденого слова віддаємо уривком. */
const SNIPPET_HALF = 220;

type Topic = { title?: string; timeRange?: string; points?: string[] };
type Client = { name?: string; note?: string };

/**
 * Поля, які воркер пише з 22.09.2026 (теми, ризики, клієнти), у типі
 * MeetingStructured гілки main ще не описані — читаємо їх із сирого JSON,
 * а старі наради без них дають порожні масиви.
 */
function extras(raw: unknown): { topics: Topic[]; risks: string[]; clients: Client[] } {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    topics: arr<Topic>(o.topics),
    risks: arr<unknown>(o.risks).filter((x): x is string => typeof x === "string"),
    clients: arr<Client>(o.clients),
  };
}

function snippet(text: string | null, q: string): string | undefined {
  if (!text) return undefined;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return undefined;
  const from = Math.max(0, at - SNIPPET_HALF);
  const to = Math.min(text.length, at + q.length + SNIPPET_HALF);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

const overdue = (t: { status: string; dueAt: Date | null }, now: Date) =>
  t.status === "ASSIGNED" && !!t.dueAt && t.dueAt.getTime() < now.getTime();

export const meetingsTool: ToolDef = {
  name: "meetings",
  label: "Дивлюся наради й задачі",
  kinds: ["ADMIN"],
  description:
    "Наради команди і задачі з них. mode=\"list\" (за замовчуванням): останні наради — дата, назва, коротко, що вирішили, скільки задач у якому стані; з q — пошук слова в назві, підсумку й ТРАНСКРИПТІ з уривком навколо («що говорили про Атаман»). mode=\"meeting\": одна нарада повністю — теми з пунктами, рішення, ризики, відкриті питання, згадані клієнти, учасники, задачі з виконавцями й станами (meeting — id або шматок назви; без нього — остання). mode=\"tasks\": задачі команді — відкриті й прострочені по людях, що чекає підтвердження, що виконали (person — лише одна людина). Викликай на «що було на нараді», «що вирішили», «про що говорили», «хто що має зробити», «які задачі прострочені», «будь у курсі подій».",
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["list", "meeting", "tasks"], description: "list — наради; meeting — одна нарада; tasks — задачі. Без поля — list." },
      q: { type: "string", description: "Тільки для list: слово чи фраза для пошуку в назві, підсумку й транскрипті." },
      meeting: { type: "string", description: "Тільки для meeting: id наради або шматок назви. Без нього — остання готова." },
      person: { type: "string", description: "Тільки для tasks: імʼя або прізвище виконавця." },
      days: { type: "integer", description: "За скільки останніх днів. Без цього — 60 для нарад, 30 для виконаних задач." },
    },
  },
  async run(_ctx, args) {
    const mode = enumOf(args.mode, "mode", ["list", "meeting", "tasks"] as const, "list");
    const now = new Date();

    /* ── Одна нарада ──────────────────────────────────────────────────── */
    if (mode === "meeting") {
      const key = str(args.meeting, "meeting", { required: false, max: 120 });
      const m = key
        ? ((await prisma.meeting.findUnique({ where: { id: key } })) ??
          (await prisma.meeting.findFirst({
            where: { title: { contains: key, mode: "insensitive" } },
            orderBy: { recordedAt: "desc" },
          })))
        : await prisma.meeting.findFirst({ where: { status: "READY" }, orderBy: { recordedAt: "desc" } });
      if (!m) return { помилка: key ? `Наради «${key}» не знайшов — спитай список (mode=list).` : "Готових нарад ще немає." };

      const s = parseStructured(m.structured);
      const x = extras(m.structured);
      const tasks = await prisma.staffTask.findMany({
        where: { meetingId: m.id },
        orderBy: { createdAt: "asc" },
        select: {
          title: true, details: true, status: true, priority: true, dueAt: true, doneAt: true, doneNote: true,
          assigneeNameHeard: true, assignee: { select: { name: true } }, counterparty: { select: { name: true } },
        },
      });
      const status = asMeetingStatus(m.status);
      return {
        id: m.id,
        дата: kyivDate(m.recordedAt),
        назва: m.title,
        стан: MEETING_STATUS_LABELS[status],
        хвилин: m.audioDurationMs ? Math.round(m.audioDurationMs / 60_000) : null,
        коротко: s?.summary ?? m.summary ?? null,
        теми: x.topics.map((t) => ({ тема: t.title ?? "", час: t.timeRange, пункти: t.points ?? [] })),
        рішення: s?.decisions ?? [],
        ризики: x.risks,
        відкриті_питання: s?.openQuestions ?? [],
        клієнти: x.clients.map((c) => ({ назва: c.name ?? "", що: c.note })),
        учасники: (s?.speakers ?? []).map((sp) => {
          const p = sp as unknown as { guessedName?: string; label?: string; role?: string };
          return { хто: p.guessedName ?? p.label ?? "", роль: p.role };
        }),
        хід_попередніх_задач: (s?.progressUpdates ?? []).map((u) => ({ задача: u.taskTitle, стан: u.status, що: u.note })),
        задачі: tasks.map((t) => ({
          що: t.title,
          подробиці: t.details ?? undefined,
          кому: t.assignee?.name ?? t.assigneeNameHeard ?? null,
          клієнт: t.counterparty?.name,
          строк: t.dueAt ? kyivDate(t.dueAt) : null,
          пріоритет: TASK_PRIORITY_LABELS[asTaskPriority(t.priority)],
          стан: TASK_STATUS_LABELS[asTaskStatus(t.status)],
          прострочено: overdue(t, now) || undefined,
          виконано: t.doneAt ? kyivDate(t.doneAt) : undefined,
          відповідь: t.doneNote ?? undefined,
        })),
        примітка:
          status === "READY"
            ? "Задачі в стані «Чекає підтвердження» людям ще не пішли — їх підтверджує адмін на сторінці наради."
            : "Нарада ще обробляється або з помилкою — підсумок може бути неповним.",
        посилання: `/admin/meetings/${m.id}`,
      };
    }

    /* ── Задачі ───────────────────────────────────────────────────────── */
    if (mode === "tasks") {
      const days = int(args.days, "days", { min: 1, max: 365, fallback: 30 });
      const since = new Date(now.getTime() - days * 86_400_000);
      const personQ = str(args.person, "person", { required: false, max: 60 });
      let assigneeIds: string[] | null = null;
      if (personQ) {
        const words = personQ.split(/\s+/).filter((w) => w.length >= 2);
        const people = await prisma.user.findMany({
          where: { AND: words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })) },
          select: { id: true },
        });
        if (people.length === 0) return { помилка: `Людини «${personQ}» не знайшов.` };
        assigneeIds = people.map((p) => p.id);
      }

      const where: Prisma.StaffTaskWhereInput = {
        ...(assigneeIds ? { assigneeId: { in: assigneeIds } } : {}),
        OR: [{ status: { in: ["PROPOSED", "ASSIGNED"] } }, { status: "DONE", doneAt: { gte: since } }],
      };
      const tasks = await prisma.staffTask.findMany({
        where,
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: 300,
        select: {
          title: true, status: true, dueAt: true, doneAt: true, doneNote: true, sentAt: true, createdAt: true,
          assigneeNameHeard: true, assignee: { select: { name: true } }, meeting: { select: { title: true } },
        },
      });

      const who = (t: (typeof tasks)[number]) => t.assignee?.name ?? t.assigneeNameHeard ?? "не призначено";
      const byPerson = new Map<string, { відкриті: number; прострочені: number; виконано_за_період: number }>();
      for (const t of tasks) {
        if (t.status === "PROPOSED") continue; // людям ще не пішли
        const row = byPerson.get(who(t)) ?? { відкриті: 0, прострочені: 0, виконано_за_період: 0 };
        if (t.status === "ASSIGNED") row.відкриті++;
        if (overdue(t, now)) row.прострочені++;
        if (t.status === "DONE") row.виконано_за_період++;
        byPerson.set(who(t), row);
      }
      const brief = (t: (typeof tasks)[number]) => ({
        що: t.title,
        кому: who(t),
        строк: t.dueAt ? kyivDate(t.dueAt) : null,
        нарада: t.meeting?.title,
      });
      const proposed = tasks.filter((t) => t.status === "PROPOSED");

      return {
        по_людях: [...byPerson.entries()]
          .map(([хто, r]) => ({ хто, ...r }))
          .sort((a, b) => b.прострочені - a.прострочені || b.відкриті - a.відкриті),
        прострочені: tasks.filter((t) => overdue(t, now)).map(brief),
        відкриті: tasks.filter((t) => t.status === "ASSIGNED" && !overdue(t, now)).slice(0, 30).map(brief),
        чекають_підтвердження: proposed.slice(0, 30).map(brief),
        чекають_підтвердження_всього: proposed.length,
        виконані: tasks
          .filter((t) => t.status === "DONE")
          .slice(0, 20)
          .map((t) => ({ ...brief(t), виконано: t.doneAt ? kyivDate(t.doneAt) : null, відповідь: t.doneNote ?? undefined })),
        примітка: `Виконані — за ${days} дн. «Чекають підтвердження» людям ще не пішли: їх підтверджує адмін на сторінці наради.`,
        посилання: "/admin/tasks",
      };
    }

    /* ── Список нарад / пошук ─────────────────────────────────────────── */
    const q = str(args.q, "q", { required: false, min: 2, max: 80 });
    const days = int(args.days, "days", { min: 1, max: 730, fallback: q ? 365 : 60 });
    const since = new Date(now.getTime() - days * 86_400_000);
    const meetings = await prisma.meeting.findMany({
      where: {
        recordedAt: { gte: since },
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { summary: { contains: q, mode: "insensitive" } },
                { transcript: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { recordedAt: "desc" },
      take: LIST_LIMIT,
      select: {
        id: true, title: true, status: true, recordedAt: true, audioDurationMs: true, summary: true, structured: true,
        transcript: Boolean(q),
        tasks: { select: { status: true } },
      },
    });

    return {
      період_днів: days,
      пошук: q || undefined,
      наради: meetings.map((m) => {
        const s = parseStructured(m.structured);
        const count = (st: string) => m.tasks.filter((t) => t.status === st).length;
        const brief = s?.summary ?? m.summary ?? "";
        return {
          id: m.id,
          дата: kyivDate(m.recordedAt),
          назва: m.title,
          стан: MEETING_STATUS_LABELS[asMeetingStatus(m.status)],
          хвилин: m.audioDurationMs ? Math.round(m.audioDurationMs / 60_000) : null,
          коротко: brief.length > 500 ? `${brief.slice(0, 500)}…` : brief,
          рішення: s?.decisions ?? [],
          задачі: { чекають_підтвердження: count("PROPOSED"), надіслано: count("ASSIGNED"), виконано: count("DONE") },
          уривок: q ? (snippet((m as { transcript?: string | null }).transcript ?? null, q) ?? snippet(brief, q)) : undefined,
        };
      }),
      примітка: meetings.length
        ? "Повністю одну нараду (теми, ризики, задачі з виконавцями) — mode=meeting з її id."
        : q
          ? `Про «${q}» за ${days} дн. на нарадах не говорили.`
          : `За ${days} дн. нарад немає.`,
    };
  },
};
