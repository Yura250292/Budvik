"use client";

import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import type { AdminRole } from "@/lib/admin-nav";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import WidgetFrame from "./WidgetFrame";
import { widgetsForRole, type WidgetGroup } from "./widget-registry";
import { useDashboardLayout } from "./useDashboardLayout";
import { DashboardDataProvider, useDashboardData } from "./DashboardData";
import type { WidgetType } from "./layout-schema";

export default function DashboardGrid({ userId, role }: { userId: string | undefined; role: AdminRole }) {
  return (
    <DashboardDataProvider role={role}>
      <DashboardInner userId={userId} role={role} />
    </DashboardDataProvider>
  );
}

function DashboardInner({ userId, role }: { userId: string | undefined; role: AdminRole }) {
  const { widgets, loaded, update, addWidget, removeWidget, cycleSize, move, reset } = useDashboardLayout(userId, role);
  const { period, setPeriod } = useDashboardData();
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const sensors = useSensors(
    // Невеликий поріг, щоб клік по віджету не читався як початок перетягування.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Затримка на тачі — інакше вертикальний скрол сторінки перехоплювався б.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } })
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = widgets.findIndex((w) => w.id === active.id);
    const to = widgets.findIndex((w) => w.id === over.id);
    if (from === -1 || to === -1) return;
    update(arrayMove(widgets, from, to));
  };

  const available = widgetsForRole(role).filter((def) => !widgets.some((w) => w.type === def.type));

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight text-bk">Дашборд</h1>
          <p className="text-[12px] text-g400">
            {editing ? "Перетягуйте віджети, змінюйте розмір або приберіть зайві" : "Ваша особиста розкладка"}
          </p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {editing && (
            <>
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className="rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-[13px] font-semibold text-bk transition-colors hover:bg-g50"
              >
                Додати віджет
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-[13px] font-medium text-g500 transition-colors hover:bg-g50 hover:text-bk"
              >
                Скинути
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setPickerOpen(false);
            }}
            className={`rounded-[var(--radius-btn)] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              editing ? "bg-bk text-primary" : "bg-primary text-bk hover:bg-primary-hover"
            }`}
          >
            {editing ? "Готово" : "Налаштувати"}
          </button>
        </div>
      </div>

      {/* Період керує всіма віджетами одразу — окремий пікер у кожному
          означав би різні цифри в сусідніх картках. */}
      <div className="mb-4">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {pickerOpen && editing && (
        <div className="mb-4 rounded-[var(--radius-card)] border border-g200 bg-white p-3">
          {available.length === 0 ? (
            <p className="py-2 text-center text-[13px] text-g400">Усі доступні віджети вже на дашборді</p>
          ) : (
            <div className="flex flex-col gap-3">
              {(["Аналітика торгових", "Склад", "Магазин"] as WidgetGroup[]).map((group) => {
                const items = available.filter((d) => d.group === group);
                if (!items.length) return null;
                return (
                  <div key={group}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-g400">{group}</p>
                    <div className="flex flex-wrap gap-2">
                      {items.map((def) => (
                        <button
                          key={def.type}
                          type="button"
                          onClick={() => {
                            addWidget(def.type as WidgetType);
                            setPickerOpen(false);
                          }}
                          className="rounded-[var(--radius-btn)] border border-g200 px-3 py-1.5 text-[13px] font-medium text-bk transition-colors hover:border-g300 hover:bg-g50"
                        >
                          + {def.title}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!loaded && widgets.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="col-span-1 h-[150px] animate-pulse rounded-[var(--radius-card)] bg-g100 md:col-span-3" />
          ))}
        </div>
      ) : widgets.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-g300 py-12 text-center">
          <p className="text-[14px] font-medium text-g500">Дашборд порожній</p>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setPickerOpen(true);
            }}
            className="mt-3 rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-[13px] font-semibold text-bk"
          >
            Додати віджети
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid auto-rows-[minmax(150px,auto)] grid-cols-2 gap-3 md:grid-cols-12">
              {widgets.map((widget, i) => (
                <WidgetFrame
                  key={widget.id}
                  widget={widget}
                  role={role}
                  editing={editing}
                  isFirst={i === 0}
                  isLast={i === widgets.length - 1}
                  onRemove={removeWidget}
                  onCycleSize={cycleSize}
                  onMove={move}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
