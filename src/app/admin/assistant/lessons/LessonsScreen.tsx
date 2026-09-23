"use client";

/**
 * Правила помічника й регресійний набір — два наслідки розбору в одному місці.
 *
 * Правило міняє поведінку, кейс не дає її зламати. Розводити їх по різних
 * сторінках означало б розірвати пару: керівник, вмикаючи правило, має
 * бачити поруч, чим він це правило перевірить.
 *
 * Головна колонка списку правил — не текст, а «спрацювало N разів ·
 * востаннє тоді-то». Правило, яке за місяць не підклалося жодного разу,
 * або нікому не потрібне, або має надто вузькі тригери, і саме цей
 * стовпчик є механізмом прибирання: стеля 12 правил на хід не
 * змінюється, коли правил стане п'ятдесят.
 */

import { useState } from "react";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { LessonView } from "@/lib/assistant/lessons";
import type { EvalCaseView } from "@/lib/assistant/eval-cases";

const CHIP = (active: boolean) =>
  `cursor-pointer whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
    active ? "border-bk bg-bk text-white" : "border-g200 bg-white text-g600 hover:bg-g50"
  }`;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "чернетка",
  ACTIVE: "діє",
  OFF: "вимкнено",
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-amber-50 text-amber-800",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  OFF: "bg-g50 text-g500",
};

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Не вдалося завантажити");
  return res.json();
};

function day(iso: string | null): string {
  if (!iso) return "жодного разу";
  return new Date(iso).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

export default function LessonsScreen() {
  const [tab, setTab] = useState<"lessons" | "cases">("lessons");

  const lessons = useSWR("/api/admin/assistant/lessons", getJson<{ items: LessonView[] }>);
  const cases = useSWR("/api/admin/assistant/eval-cases", getJson<{ items: EvalCaseView[] }>);

  async function patchLesson(id: string, patch: Record<string, unknown>) {
    await fetch("/api/admin/assistant/lessons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    void lessons.mutate();
  }

  async function archive(id: string) {
    await fetch("/api/admin/assistant/lessons", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void lessons.mutate();
  }

  async function patchCase(id: string, patch: Record<string, unknown>) {
    await fetch("/api/admin/assistant/eval-cases", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    void cases.mutate();
  }

  async function dropCase(id: string) {
    await fetch("/api/admin/assistant/eval-cases", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void cases.mutate();
  }

  const items = lessons.data?.items ?? [];
  const active = items.filter((l) => l.status === "ACTIVE");
  const caseItems = cases.data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold leading-tight text-bk">Правила помічника</h1>
        <p className="mt-0.5 text-[13px] text-g500">
          Те, у що перетворюються ваші 👎. Кожне діюче правило підкладається помічникові в кожну наступну
          розмову — але не більше дванадцяти за хід, тож зайві просто не поїдуть.
        </p>
        <a href="/admin/assistant/review" className="mt-1 inline-block text-[13px] font-semibold text-bk underline">
          ← Черга розбору
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setTab("lessons")} className={CHIP(tab === "lessons")}>
          Правила{items.length > 0 ? ` · ${items.length}` : ""}
        </button>
        <button type="button" onClick={() => setTab("cases")} className={CHIP(tab === "cases")}>
          Регресія{caseItems.length > 0 ? ` · ${caseItems.length}` : ""}
        </button>
      </div>

      {tab === "lessons" && (
        <>
          {active.length >= 12 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Діючих правил {active.length}, а в хід їх поміщається 12. Зайві не поїдуть — вимкніть ті, у яких
              «спрацювало 0».
            </p>
          )}

          {lessons.error && <ErrorBox message="Не вдалося завантажити правила" onRetry={() => void lessons.mutate()} />}
          {!lessons.error && lessons.isLoading && <p className="text-[13px] text-g500">Завантажую…</p>}
          {!lessons.error && !lessons.isLoading && items.length === 0 && (
            <EmptyState
              title="Правил ще немає"
              hint="Позначте невдалу відповідь 👎, напишіть, як мало бути, — і заведіть правило з черги розбору."
            />
          )}

          {items.map((l) => (
            <Card key={l.id}>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_STYLE[l.status]}`}>
                    {STATUS_LABEL[l.status]}
                  </span>
                  {l.kind && <span className="rounded-full bg-g50 px-2 py-0.5 font-medium text-g600">{l.kind}</span>}
                  {l.triggers.length === 0 ? (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-800">у кожному питанні</span>
                  ) : (
                    l.triggers.map((t) => (
                      <span key={t} className="rounded-full bg-g50 px-2 py-0.5 font-medium text-g600">
                        {t}
                      </span>
                    ))
                  )}
                </div>

                <p className="text-[14px] text-bk">{l.text}</p>

                <div className="flex flex-wrap gap-x-3 text-[11px] text-g500">
                  <span className={l.usedCount === 0 && l.status === "ACTIVE" ? "font-semibold text-amber-700" : undefined}>
                    спрацювало {l.usedCount}
                  </span>
                  <span>востаннє {day(l.lastUsedAt)}</span>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {l.status !== "ACTIVE" && (
                    <button type="button" onClick={() => void patchLesson(l.id, { status: "ACTIVE" })} className={CHIP(false)}>
                      Увімкнути
                    </button>
                  )}
                  {l.status === "ACTIVE" && (
                    <button type="button" onClick={() => void patchLesson(l.id, { status: "OFF" })} className={CHIP(false)}>
                      Вимкнути
                    </button>
                  )}
                  <button type="button" onClick={() => void archive(l.id)} className={CHIP(false)}>
                    Прибрати
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </>
      )}

      {tab === "cases" && (
        <>
          <p className="text-[12px] text-g500">
            Кейс перевіряє <b>форму</b> відповіді, а не числа: які інструменти мали відпрацювати, що мало
            намалюватись, чого не можна казати. Числа змінюються щодня, форма — ні. Еталони (👍) потрібні не щоб
            зловити помилку, а щоб зловити правило, яке зіпсувало те, що працювало.
          </p>

          {cases.error && <ErrorBox message="Не вдалося завантажити набір" onRetry={() => void cases.mutate()} />}
          {!cases.error && !cases.isLoading && caseItems.length === 0 && (
            <EmptyState title="Набір порожній" hint="Натисніть «У регресію» або «В еталони» на картці в черзі розбору." />
          )}

          {caseItems.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {c.golden && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">еталон 👍</span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_STYLE[c.status]}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                  <span className="rounded-full bg-g50 px-2 py-0.5 font-medium text-g600">{c.kind}</span>
                </div>

                <p className="text-[14px] font-semibold text-bk">{c.question}</p>
                {c.rubric && <p className="text-[13px] text-g600">Мало бути: {c.rubric}</p>}

                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-g500">
                  {c.expectTools.length > 0 && <span>інструменти: {c.expectTools.join(", ")}</span>}
                  {c.expectBlocks.length > 0 && <span>блоки: {c.expectBlocks.join(", ")}</span>}
                  {c.expectVia && <span>{c.expectVia === "MODEL" ? "через модель" : "без моделі"}</span>}
                  {c.maxUnverified != null && <span>чисел поза даними ≤ {c.maxUnverified}</span>}
                  {c.expectTools.length === 0 && c.expectBlocks.length === 0 && !c.expectVia && (
                    <span className="font-semibold text-amber-700">очікувань немає — у прогін не піде</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {c.status !== "ACTIVE" && (
                    <button type="button" onClick={() => void patchCase(c.id, { status: "ACTIVE" })} className={CHIP(false)}>
                      Увімкнути
                    </button>
                  )}
                  {c.status === "ACTIVE" && (
                    <button type="button" onClick={() => void patchCase(c.id, { status: "OFF" })} className={CHIP(false)}>
                      Вимкнути
                    </button>
                  )}
                  <button type="button" onClick={() => void dropCase(c.id)} className={CHIP(false)}>
                    Прибрати
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
