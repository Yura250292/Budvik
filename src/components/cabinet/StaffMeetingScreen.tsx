"use client";

import type { ReactNode } from "react";
import useSWR from "swr";
import { Callout, Card, CardHead, Eyebrow, Note, Page, Pill } from "@/components/cabinet/ui";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { dueLabel } from "@/components/meetings/api";
import { PROGRESS_LABELS, type ProgressStatus, type SharedMeetingView, type TeamTask } from "@/lib/meetings/types";
import { TaskItem } from "./StaffTasksScreen";
import { fetchJson, meetingWhen } from "./meeting-text";

/**
 * Нарада в кабінеті торгового, водія чи складу — у тому порядку, в якому її
 * читають: що мені робити, про що домовились, хто що робить, як рухаються
 * старі справи.
 *
 * Лише те, що керівник надіслав: без запису, транскрипту й непідтверджених
 * пропозицій (src/lib/meetings/share.ts).
 */

const PROGRESS_TONE: Record<ProgressStatus, "ok" | "info" | "bad" | "neutral"> = {
  DONE: "ok",
  IN_PROGRESS: "info",
  BLOCKED: "bad",
  NOT_STARTED: "neutral",
};

function List({ items, numbered = false }: { items: string[]; numbered?: boolean }) {
  const Tag = numbered ? "ol" : "ul";
  return (
    <Tag className={`mt-2 space-y-1.5 pl-5 text-[14px] leading-relaxed text-bk ${numbered ? "list-decimal" : "list-disc"}`}>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </Tag>
  );
}

/** Задачі команди по людях — у порядку, в якому їх надіслали. */
function byPerson(team: TeamTask[]): { name: string; role: string | null; tasks: TeamTask[] }[] {
  const groups = new Map<string, { name: string; role: string | null; tasks: TeamTask[] }>();
  for (const t of team) {
    const name = t.assigneeName ?? "Без виконавця";
    const g = groups.get(name) ?? { name, role: t.assigneeRoleLabel, tasks: [] };
    g.tasks.push(t);
    groups.set(name, g);
  }
  return [...groups.values()];
}

export default function StaffMeetingScreen({
  id,
  header,
  base,
  clientBase,
}: {
  id: string;
  header: ReactNode;
  /** Розділ кабінету: «/sales», «/driver», «/warehouse». */
  base: string;
  /** Префікс картки клієнта для своїх задач; без нього клієнт — просто назва. */
  clientBase?: string;
}) {
  const { data, error, mutate } = useSWR(`/api/meetings/${id}`, (u: string) => fetchJson<{ item: SharedMeetingView }>(u));
  const m = data?.item;
  const team = m ? byPerson(m.team) : [];

  return (
    <>
      {header}
      <Page>
        {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}
        {!m && !error && <Note>Завантаження…</Note>}

        {m && (
          <>
            <div className="flex flex-col gap-1 px-1">
              <h1 className="text-[20px] font-bold leading-tight text-bk">{m.title}</h1>
              <Note>
                {meetingWhen(m.recordedAt, m.audioDurationMs)} · провів {m.createdByName}
              </Note>
            </div>

            {m.updating && (
              <Callout tone="info" title="Підсумок перескладають">
                Тут поки попередня версія — загляньте за кілька хвилин.
              </Callout>
            )}

            {m.mine.length > 0 && (
              <>
                <Eyebrow>Ваші задачі з наради</Eyebrow>
                {m.mine.map((t) => (
                  <TaskItem
                    key={t.id}
                    t={t}
                    clientBase={clientBase}
                    back={`${base}/meetings/${id}`}
                    onChanged={() => void mutate()}
                  />
                ))}
              </>
            )}

            {m.summary && (
              <Card>
                <CardHead title="Коротко" />
                <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-bk">{m.summary}</p>
              </Card>
            )}

            {m.decisions.length > 0 && (
              <Card>
                <CardHead title="Що вирішили" />
                <List items={m.decisions} numbered />
              </Card>
            )}

            {team.length > 0 && (
              <Card>
                <CardHead title="Хто що робить" />
                <div className="mt-2 flex flex-col divide-y divide-cab-line">
                  {team.map((g) => (
                    <div key={g.name} className="py-2.5 first:pt-0 last:pb-0">
                      <p className="text-[13px] font-bold text-bk">
                        {g.name}
                        {g.role && <span className="font-normal text-cab-t3"> · {g.role}</span>}
                      </p>
                      <ul className="mt-1 flex flex-col gap-1.5">
                        {g.tasks.map((t) => (
                          <li key={t.id} className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span
                                className={`block text-[13px] leading-snug ${t.done ? "text-cab-t3 line-through" : "text-bk"}`}
                              >
                                {t.title}
                              </span>
                              {(t.clientName || t.dueAt) && (
                                <span className="block text-xs text-cab-t3">
                                  {[t.clientName, t.dueAt ? `до ${dueLabel(t.dueAt)}` : null].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </span>
                            {t.done ? (
                              <Pill tone="ok">Виконано</Pill>
                            ) : t.overdue ? (
                              <Pill tone="bad">Прострочено</Pill>
                            ) : t.priority === "HIGH" ? (
                              <Pill tone="warn">Терміново</Pill>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {m.progress.length > 0 && (
              <Card>
                <CardHead title="Як рухаємось" />
                <ul className="mt-2 flex flex-col gap-2.5">
                  {m.progress.map((p, i) => (
                    <li key={i} className="flex flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-semibold leading-snug text-bk">{p.taskTitle}</span>
                        <Pill tone={PROGRESS_TONE[p.status]}>{PROGRESS_LABELS[p.status]}</Pill>
                      </div>
                      <Note>{[p.assigneeName, p.note].filter(Boolean).join(" — ")}</Note>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {m.keyPoints.length > 0 && (
              <Card>
                <CardHead title="Про що говорили" />
                <List items={m.keyPoints} />
              </Card>
            )}

            {m.openQuestions.length > 0 && (
              <Card>
                <CardHead title="Питання без відповіді" />
                <List items={m.openQuestions} />
              </Card>
            )}
          </>
        )}
      </Page>
    </>
  );
}
