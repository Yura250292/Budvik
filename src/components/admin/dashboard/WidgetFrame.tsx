"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AdminRole } from "@/lib/admin-nav";
import { WIDGET_REGISTRY } from "./widget-registry";
import { sizeToClass, type WidgetInstance } from "./layout-schema";

export default function WidgetFrame({
  widget,
  role,
  editing,
  isFirst,
  isLast,
  onRemove,
  onCycleSize,
  onMove,
}: {
  widget: WidgetInstance;
  role: AdminRole;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onRemove: (id: string) => void;
  onCycleSize: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editing,
  });

  const def = WIDGET_REGISTRY[widget.type];
  if (!def) return null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${sizeToClass(widget.size)} relative min-h-[150px] overflow-hidden rounded-[var(--radius-card)] border bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${
        isDragging ? "z-10 border-primary opacity-80 shadow-lg" : "border-g200"
      } ${editing ? "ring-1 ring-dashed ring-g300" : ""}`}
    >
      {editing && (
        <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-0.5 rounded-lg border border-g200 bg-white/95 p-0.5 shadow-sm">
          {/* Стрілки — не лише доступність: на тачскріні вони надійніші за перетягування. */}
          <IconBtn label="Вгору" onClick={() => onMove(widget.id, -1)} disabled={isFirst}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </IconBtn>
          <IconBtn label="Вниз" onClick={() => onMove(widget.id, 1)} disabled={isLast}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </IconBtn>
          <IconBtn label={`Розмір: ${widget.size}`} onClick={() => onCycleSize(widget.id)}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 8V4m0 0h4M4 4l5 5m11-5v4m0-4h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"
            />
          </IconBtn>
          <IconBtn label="Прибрати" onClick={() => onRemove(widget.id)} danger>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </IconBtn>
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Перетягнути"
            className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-g400 transition-colors hover:bg-g100 hover:text-bk active:cursor-grabbing"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
            </svg>
          </button>
        </div>
      )}

      {/* У режимі редагування вміст не має ловити кліки — інакше перетягування
          перетворюється на перехід за посиланням усередині віджета. */}
      <div className={`h-full ${editing ? "pointer-events-none select-none" : ""}`}>
        {def.Render({ role })}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-30 ${
        danger ? "text-red-500 hover:bg-red-50" : "text-g400 hover:bg-g100 hover:text-bk"
      }`}
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
