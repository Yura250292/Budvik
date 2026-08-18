"use client";

/**
 * Обгортка секції: кеш, генерація, збереження в архів.
 *
 * Патерн той самий, що в InsightsPanel по торговому, і з тієї ж причини:
 * GET показує вже пораховане, а POST витрачає токени і тому вимагає
 * натискання. Копія, а не спільний компонент, бо там payload жорстко
 * типізований під Insight[], а тут у кожної секції своя структура —
 * зводити їх в один узагальнений компонент вийшло б заплутаніше за копію.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { CardSkeleton } from "@/components/ui/Skeleton";
import type { Period } from "@/components/ui/PeriodPicker";

type Report = {
  insights: unknown;
  facts: unknown;
  model: string;
  tokens: number;
  generatedAt: string;
  fresh: boolean;
};

type Response = {
  configured?: boolean;
  report?: Report | null;
  periodNote?: string | null;
  rejected?: number;
  error?: string;
  missing?: string[];
};

/** Назва розділу з відповіді сервера → вкладка, куди вести. */
const MISSING_TABS: Record<string, string> = {
  Торгові: "reps",
  Товари: "products",
  Логістика: "logistics",
};

const KIND: Record<string, string> = {
  reps: "company_reps",
  products: "company_products",
  logistics: "company_logistics",
  strategy: "company_strategy",
};

function formatMoment(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function SectionPanel({
  section,
  title,
  query,
  period,
  render,
}: {
  section: string;
  title: string;
  query: string;
  period: Period;
  render: (payload: unknown, facts: unknown) => ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [rejected, setRejected] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saveNote, setSaveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(null);
    try {
      const res = await fetch(`/api/admin/ai-analysis/${section}?${query}`);
      const data: Response = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не вдалося завантажити");
      setConfigured(data.configured !== false);
      setReport(data.report ?? null);
      setNote(data.periodNote ?? null);
      // Стратегія повідомляє про брак сусідніх секцій уже при відкритті —
      // щоб людина побачила це до натискання, а не після.
      setMissing(data.missing?.length ? data.missing : null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [section, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setMissing(null);
    setSaved(null);
    try {
      const res = await fetch(`/api/admin/ai-analysis/${section}?${query}`, { method: "POST" });
      const data: Response = await res.json();
      if (!res.ok) {
        if (data.missing) setMissing(data.missing);
        throw new Error(data.error ?? "Не вдалося згенерувати");
      }
      setReport(data.report ?? null);
      setNote(data.periodNote ?? null);
      setRejected(data.rejected ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [section, query]);

  const save = useCallback(async () => {
    if (!report) return;
    setSaved(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/sales-analytics/insights/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: KIND[section],
          fromDay: period.from,
          toDay: period.to,
          note: saveNote.trim() || undefined,
          insights: report.insights,
          facts: report.facts,
          model: report.model,
          tokens: report.tokens,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не вдалося зберегти");
      setSaved("Збережено. Звіт лежить у вкладці «Збережені» і токенів більше не витрачає.");
      setSaveNote("");
      setNoteOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [report, section, period, saveNote]);

  /** Генерувати нема сенсу: бракує секцій, на яких стоїть ця. */
  const blocked = !report && !!missing?.length;

  // Скелетон навмисно тримає висоту екрана. Це не косметика: Safari на
  // початку жесту колеса запам'ятовує, який контейнер і докуди гортається.
  // При короткому скелетоні гортати ніде, жест «залипає» на нульовій висоті
  // — і поки не згасне інерція (2-3 с), сторінка стоїть, хоча звіт уже
  // вставився. Із запасом висоти скролер валідний з першого кадру.
  if (loading) {
    return (
      <div className="min-h-[75vh] space-y-4">
        <CardSkeleton rows={6} />
        <CardSkeleton rows={4} />
      </div>
    );
  }


  if (!configured) {
    return (
      <Card>
        <EmptyState
          title="AI-аналіз не налаштований"
          hint="Бракує ANTHROPIC_API_KEY. Додайте ключ у налаштуваннях середовища — і розділ запрацює."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader
          title={title}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {report && (
                <button
                  type="button"
                  onClick={() => setNoteOpen((v) => !v)}
                  aria-expanded={noteOpen}
                  className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs font-medium text-g600 transition-colors hover:border-g300 hover:text-bk"
                >
                  Зберегти
                </button>
              )}
              {/* Заблокована кнопка з поясненням краща за активну, яка
                  через хвилину віддасть 409: людина бачить, чого бракує,
                  ще до того, як витратить час. */}
              <button
                type="button"
                onClick={generate}
                disabled={generating || blocked}
                title={
                  blocked
                    ? `Спершу згенеруйте: ${missing!.join(", ")}`
                    : undefined
                }
                className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-3.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generating ? "Аналізую…" : report ? "Оновити" : "Згенерувати"}
              </button>
            </div>
          }
        />

        {noteOpen && report && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-g200 bg-g50 p-3">
            <label htmlFor="save-note" className="sr-only">
              Підпис до звіту
            </label>
            <input
              id="save-note"
              type="text"
              value={saveNote}
              onChange={(e) => setSaveNote(e.target.value)}
              placeholder="Підпис: навіщо відкладаємо (необов'язково)"
              maxLength={500}
              className="min-w-0 flex-1 rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-3.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? "Зберігаю…" : "Зберегти в архів"}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2 text-xs text-g500">
          {note && <p className="text-g600">{note}</p>}

          {report && (
            <>
              <p>
                {report.model} · {report.tokens.toLocaleString("uk-UA")} токенів витрачено при
                генерації · {formatMoment(report.generatedAt)}
                {!report.fresh && (
                  <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                    старший за добу
                  </span>
                )}
              </p>
              {/* Головне, чого не видно з інтерфейсу: цей звіт уже готовий і
                  перегляд його безкоштовний. Без цього рядка «Оновити»
                  натискають щоразу при поверненні на вкладку. */}
              <p>
                Звіт збережений — повертатися до нього можна скільки завгодно, токени не
                витрачаються. «Оновити» потрібне, лише якщо дані в 1С помітно змінилися.
              </p>
            </>
          )}

          {rejected > 0 && (
            <p className="text-amber-700">
              Відкинуто перевіркою: {rejected}. Це висновки, у яких були цифри або клієнти, яких
              немає у ваших даних.
            </p>
          )}

          {saved && <p className="text-emerald-700">{saved}</p>}

          {generating && (
            <p className="text-g600">
              Це займає до кількох хвилин: розділ рахується з ваших даних, а модель проходить по
              кожній людині окремо.
            </p>
          )}
        </div>
      </Card>

      {missing && !report && (
        <Card>
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <h3 className="text-sm font-semibold text-bk">Спершу згенеруйте інші розділи</h3>
            <p className="max-w-lg text-sm text-g500">
              Стратегія не рахує компанію заново — вона зводить висновки решти розділів. Бракує:{" "}
              <span className="font-medium text-g700">{missing.join(", ")}</span>. Згенеруйте їх за
              цей самий період і поверніться сюди.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {missing.map((label) => {
                const key = MISSING_TABS[label];
                if (!key) return null;
                return (
                  <Link
                    key={label}
                    href={`/admin/ai-analysis?tab=${key}&from=${period.from}&to=${period.to}`}
                    className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3.5 py-2 text-xs font-medium text-g600 transition-colors hover:border-g300 hover:text-bk"
                  >
                    {label} →
                  </Link>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {error && !missing && <ErrorBox message={error} onRetry={load} />}

      {!report && !error && !generating && !missing && (
        <Card>
          <EmptyState
            title="Ще не аналізували"
            hint="Натисніть «Згенерувати» — розділ порахується за обраний період і збережеться на добу."
          />
        </Card>
      )}

      {report && render(report.insights, report.facts)}
    </div>
  );
}
