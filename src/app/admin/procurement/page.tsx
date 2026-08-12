"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { TableScroll } from "@/components/ui/TableScroll";
import type { LowStockReport, LowStockSection } from "@/lib/procurement/low-stock";

/**
 * Закупівлі: чого мало на складі по бренду.
 *
 * Робоче місце закупівельника: вибрав бренд — побачив дефіцит, згрупований
 * за ієрархією номенклатури, з підсвіткою «нема / мало». Пороги «мало»
 * настроюються: дорога техніка рахується штуками, оснастка — десятками.
 * Кнопка Excel віддає той самий звіт кольоровим .xlsx для постачальника.
 */

type Brand = { id: string; name: string; products: number };

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });

const ROW_COLORS = ["#FEE2E2", "#FEF9C3", "transparent"]; // нема / мало / ок
const STATUS_LABELS = ["ЗАМОВИТИ — нема!", "ЗАМОВИТИ — мало", "ок"];
const STATUS_COLORS = ["#B91C1C", "#A16207", "#6B7280"];

export default function ProcurementPage() {
  const [brandId, setBrandId] = useState("");
  const [expensivePrice, setExpensivePrice] = useState(1000);
  const [expensiveMin, setExpensiveMin] = useState(5);
  const [cheapMin, setCheapMin] = useState(10);
  const [onlyDeficit, setOnlyDeficit] = useState(true);

  const { data: brandsData } = useSWR<{ brands: Brand[] }>("/api/admin/procurement", fetcher);

  const query = brandId
    ? `/api/admin/procurement?brandId=${brandId}&expensivePrice=${expensivePrice}&expensiveMin=${expensiveMin}&cheapMin=${cheapMin}`
    : null;
  const { data, error, isLoading } = useSWR<{ report: LowStockReport }>(query, fetcher, {
    keepPreviousData: true,
  });
  const report = data?.report;

  const visibleSections = useMemo<LowStockSection[]>(() => {
    if (!report) return [];
    if (!onlyDeficit) return report.sections;
    return report.sections
      .map((s) => ({
        ...s,
        groups: s.groups
          .map((g) => ({ ...g, items: g.items.filter((i) => i.severity < 2) }))
          .filter((g) => g.items.length > 0),
      }))
      .filter((s) => s.groups.length > 0);
  }, [report, onlyDeficit]);

  const exportUrl = query ? query.replace("/api/admin/procurement?", "/api/admin/procurement/export?") : null;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold">Закупівлі</h1>
        <p className="text-sm text-g400">
          Дефіцит на складі за брендом: дорога техніка рахується штуками, оснастка — десятками.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-g400">Бренд</span>
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="h-10 min-w-56 rounded-[var(--radius-btn)] border border-g100 bg-white px-3"
            >
              <option value="">— оберіть бренд —</option>
              {brandsData?.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.products})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-g400">«Дорогий» від, грн</span>
            <input
              type="number" min={1} value={expensivePrice}
              onChange={(e) => setExpensivePrice(Number(e.target.value) || 1000)}
              className="h-10 w-32 rounded-[var(--radius-btn)] border border-g100 px-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-g400">Мін. дорогі, шт</span>
            <input
              type="number" min={1} value={expensiveMin}
              onChange={(e) => setExpensiveMin(Number(e.target.value) || 5)}
              className="h-10 w-24 rounded-[var(--radius-btn)] border border-g100 px-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-g400">Мін. кількісні, шт</span>
            <input
              type="number" min={1} value={cheapMin}
              onChange={(e) => setCheapMin(Number(e.target.value) || 10)}
              className="h-10 w-24 rounded-[var(--radius-btn)] border border-g100 px-3"
            />
          </label>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyDeficit} onChange={(e) => setOnlyDeficit(e.target.checked)} />
            Лише дефіцит
          </label>
          {exportUrl && (
            <a
              href={exportUrl}
              className="ml-auto flex h-10 items-center rounded-[var(--radius-btn)] bg-bk px-4 text-sm font-semibold text-white hover:opacity-85"
            >
              ⬇ Excel для замовлення
            </a>
          )}
        </div>
      </Card>

      {!brandId && (
        <EmptyState title="Оберіть бренд" hint="Звіт будується по одному бренду — так, як його замовляють у постачальника." />
      )}
      {error && <div className="rounded-[var(--radius-card)] bg-red-50 p-4 text-sm text-red-700">{String(error.message)}</div>}
      {isLoading && brandId && !report && <div className="p-4 text-sm text-g400">Рахуємо залишки…</div>}

      {report && (
        <>
          <div className="flex flex-wrap gap-3">
            <Stat label="Товарів у бренді" value={report.total} />
            <Stat label="Треба замовити" value={report.toOrder} tone="#A16207" />
            <Stat label="Взагалі нема" value={report.zeroStock} tone="#B91C1C" />
          </div>

          {visibleSections.length === 0 && (
            <EmptyState title="Дефіциту немає" hint="За поточними порогами всі позиції в нормі." />
          )}

          {visibleSections.map((section) => (
            <Card key={section.name}>
              <div className="flex items-baseline justify-between gap-2 border-b border-g100 px-4 py-3">
                <h2 className="font-bold">{section.name}</h2>
                <span className="text-sm text-g400">
                  товарів: {section.total} · замовити: <b className="text-bk">{section.toOrder}</b>
                </span>
              </div>
              <TableScroll minWidth={760}>
                <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                      <Th>Артикул</Th>
                      <Th style={{ width: "45%" }}>Назва</Th>
                      <Th align="right">Ціна, грн</Th>
                      <Th align="right">Залишок</Th>
                      <Th align="right">Мін. норма</Th>
                      <Th>Статус</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {/*
                      Бренд у ключі — навмисно: назви груп («Тримери»,
                      «Мотокоси») повторюються між брендами, і без нього React
                      перевикористав би рядок разом зі станом «згорнуто».
                      Закупівельник бачив би «замовити 12» і жодного рядка під ним.
                    */}
                    {section.groups.map((group) => (
                      <GroupRows key={`${brandId}:${section.name}:${group.name}`} group={group} />
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-g100 bg-white px-4 py-3">
      <div className="text-xs text-g400">{label}</div>
      <div className="text-xl font-bold" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

function Th({ children, align, style }: { children: React.ReactNode; align?: "right"; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: "10px 16px", textAlign: align ?? "left", fontWeight: 600, color: "#6B7280", fontSize: 12, ...style }}>
      {children}
    </th>
  );
}

function GroupRows({ group }: { group: LowStockSection["groups"][number] }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        style={{ background: "#EEF2FA", borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}
      >
        <td colSpan={6} style={{ padding: "8px 16px", fontWeight: 600 }}>
          <span className="mr-2 inline-block w-3 text-g400">{open ? "▾" : "▸"}</span>
          {group.name}
          <span className="ml-2 text-xs font-normal text-g400">
            {group.total} шт · замовити {group.toOrder}
          </span>
        </td>
      </tr>
      {open &&
        group.items.map((item) => (
          <tr key={item.id} style={{ background: ROW_COLORS[item.severity], borderBottom: "1px solid #F3F4F6" }}>
            <Td>{item.sku ?? "—"}</Td>
            <Td>{item.name}</Td>
            <Td align="right">{item.price.toLocaleString("uk-UA", { minimumFractionDigits: 2 })}</Td>
            <Td align="right"><b>{item.stock}</b></Td>
            <Td align="right">{item.threshold}</Td>
            <Td>
              <span style={{ fontWeight: item.severity < 2 ? 700 : 400, color: STATUS_COLORS[item.severity], fontSize: 12 }}>
                {STATUS_LABELS[item.severity]}
              </span>
            </Td>
          </tr>
        ))}
    </>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return <td style={{ padding: "8px 16px", textAlign: align ?? "left" }}>{children}</td>;
}
