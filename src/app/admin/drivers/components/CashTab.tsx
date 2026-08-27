"use client";

/**
 * Інкасація: що водії заявили як здане і що офіс уже прийняв.
 *
 * Робочий список, а не звіт: головна дія тут — кнопка «Прийняв» навпроти
 * рядка, який ще висить. Тому непідтверджені стоять зверху окремим
 * блоком, навіть якщо вони старші за підтверджені.
 *
 * Колонка «розбіжність» — це заявлене мінус зібране за відмітками того
 * дня. Не помилка сама по собі (решта, розмін, здача частинами), але
 * саме вона показує, куди дивитись.
 */

import { useState } from "react";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { money } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { STATUS } from "@/lib/analytics/colors";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { TableScroll } from "@/components/ui/TableScroll";

type Handover = {
  id: string;
  day: string;
  driverId: string;
  driverName: string;
  amount: number;
  expectedAmount: number | null;
  delta: number | null;
  comment: string | null;
  handedAt: string;
  confirmedAt: string | null;
  confirmedAmount: number | null;
  confirmedByName: string | null;
};

type Resp = {
  canEdit: boolean;
  period: { from: string; to: string };
  handovers: Handover[];
  totals: { declared: number; confirmed: number; pending: number };
};

function formatDay(day: string): string {
  return new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(
    new Date(`${day}T12:00:00Z`)
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

export function CashTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<Resp>(
    `/api/admin/drivers/cash-handovers?from=${period.from}&to=${period.to}`
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function confirm(row: Handover, amount?: number) {
    setBusy(row.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/drivers/cash-handovers/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(amount != null ? { confirmedAmount: amount } : {}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося підтвердити");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка підтвердження");
    } finally {
      setBusy(null);
    }
  }

  async function undo(row: Handover) {
    if (!confirmWindow("Скасувати підтвердження прийому?")) return;
    setBusy(row.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/drivers/cash-handovers/${row.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося скасувати");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка скасування");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <TableSkeleton rows={6} />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const pending = data.handovers.filter((h) => !h.confirmedAt);
  const confirmed = data.handovers.filter((h) => h.confirmedAt);

  return (
    <div className="space-y-4">
      {message && <ErrorBox message={message} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SumCard label="Заявлено за період" value={data.totals.declared} />
        <SumCard label="Прийнято" value={data.totals.confirmed} tone="ok" />
        <SumCard label="Чекає прийому" value={data.totals.pending} tone="warn" />
      </div>

      <Card>
        <CardHeader
          title="Чекають прийому"
          hint="Водій заявив здачу — гроші ще не проведені через касу"
          // Скільки рядків чекає — видно з шапки, не читаючи таблицю.
          action={pending.length > 0 ? <Badge status="warn" dot>{pending.length}</Badge> : undefined}
        />
        {pending.length === 0 ? (
          <EmptyState title="Немає непідтверджених здач за цей період" />
        ) : (
          <HandoverTable
            rows={pending}
            canEdit={data.canEdit}
            busy={busy}
            onConfirm={confirm}
            onUndo={undo}
          />
        )}
      </Card>

      <Card>
        <CardHeader title="Прийнято" hint="Історія підтверджених здач" />
        {confirmed.length === 0 ? (
          <EmptyState title="Ще нічого не підтверджено" />
        ) : (
          <HandoverTable
            rows={confirmed}
            canEdit={data.canEdit}
            busy={busy}
            onConfirm={confirm}
            onUndo={undo}
          />
        )}
      </Card>
    </div>
  );
}

function SumCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  // Кольори — зі спільної шкали статусів: «прийнято» тут має бути тим
  // самим зеленим, що й «прийнято» в бейджі поруч.
  const color = tone === "ok" ? STATUS.good.fg : tone === "warn" ? STATUS.warn.fg : undefined;
  return (
    <div className="rounded-[var(--radius-card)] border border-g200 bg-white px-4 py-3">
      <p className="text-xs text-g500">{label}</p>
      <p
        className={`mt-0.5 text-lg font-bold tabular-nums ${color ? "" : "text-bk"}`}
        style={color ? { color } : undefined}
      >
        {money(value)}
      </p>
    </div>
  );
}

function HandoverTable({
  rows,
  canEdit,
  busy,
  onConfirm,
  onUndo,
}: {
  rows: Handover[];
  canEdit: boolean;
  busy: string | null;
  onConfirm: (row: Handover, amount?: number) => void;
  onUndo: (row: Handover) => void;
}) {
  return (
    <TableScroll>
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-g200 text-left text-xs text-g500">
            <th className="px-3 py-2 font-medium">День</th>
            <th className="px-3 py-2 font-medium">Водій</th>
            <th className="px-3 py-2 text-right font-medium">Зібрано</th>
            <th className="px-3 py-2 text-right font-medium">Заявлено</th>
            <th className="px-3 py-2 text-right font-medium">Розбіжність</th>
            <th className="px-3 py-2 font-medium">Здав</th>
            <th className="px-3 py-2 font-medium">Стан</th>
            {canEdit && <th className="px-3 py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-g100 align-top">
              <td className="whitespace-nowrap px-3 py-2.5 text-g700">{formatDay(row.day)}</td>
              <td className="px-3 py-2.5 font-medium text-bk">{row.driverName}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-g600">
                {row.expectedAmount != null ? money(row.expectedAmount) : "—"}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-bk">
                {money(row.amount)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {row.delta == null || Math.abs(row.delta) < 0.5 ? (
                  <span className="text-g400">—</span>
                ) : (
                  <span className={row.delta > 0 ? "text-green-700" : "text-red-600"}>
                    {row.delta > 0 ? "+" : ""}
                    {money(row.delta)}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-g600">
                {formatTime(row.handedAt)}
                {row.comment && (
                  <span className="block max-w-[220px] truncate text-xs text-g400">
                    {row.comment}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5">
                {row.confirmedAt ? (
                  <span>
                    <Badge status="good">Прийнято</Badge>
                    <span className="mt-0.5 block text-xs text-g400">
                      {row.confirmedByName ?? "офіс"}
                      {row.confirmedAmount != null && row.confirmedAmount !== row.amount && (
                        <> · {money(row.confirmedAmount)}</>
                      )}
                    </span>
                  </span>
                ) : (
                  <Badge status="warn" dot>В дорозі</Badge>
                )}
              </td>
              {canEdit && (
                <td className="px-3 py-2.5 text-right">
                  {row.confirmedAt ? (
                    <button
                      type="button"
                      disabled={busy === row.id}
                      onClick={() => onUndo(row)}
                      className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1.5 text-xs font-medium text-g600 hover:bg-g50 disabled:opacity-50"
                    >
                      Скасувати
                    </button>
                  ) : (
                    <ConfirmCell row={row} busy={busy === row.id} onConfirm={onConfirm} />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/**
 * Кнопка «Прийняв» із можливістю вписати іншу суму.
 *
 * За замовчуванням приймаємо рівно те, що заявив водій — один клік на
 * типовий випадок. Поле відкривається лише коли каса перерахувала й
 * побачила іншу цифру.
 */
function ConfirmCell({
  row,
  busy,
  onConfirm,
}: {
  row: Handover;
  busy: boolean;
  onConfirm: (row: Handover, amount?: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(row.amount));

  if (!editing) {
    return (
      <span className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(row)}
          className="cursor-pointer rounded-[var(--radius-badge)] bg-bk px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "…" : "Прийняв"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(true)}
          className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1.5 text-xs font-medium text-g600 hover:bg-g50 disabled:opacity-50"
        >
          Інша сума
        </button>
      </span>
    );
  }

  return (
    <span className="flex justify-end gap-2">
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        aria-label="Фактично прийнята сума"
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ""))}
        className="w-24 rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-right tabular-nums text-g700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
      />
      <button
        type="button"
        disabled={busy || !draft}
        onClick={() => onConfirm(row, Number(draft.replace(",", ".")))}
        className="cursor-pointer rounded-[var(--radius-badge)] bg-bk px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        ОК
      </button>
    </span>
  );
}

/** Обгортка над window.confirm — щоб не тягнути глобал у тіло компонента. */
function confirmWindow(text: string): boolean {
  return typeof window === "undefined" ? false : window.confirm(text);
}
