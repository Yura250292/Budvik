"use client";

/**
 * Список точок маршруту — те, з чим водій працює весь день.
 *
 * На планшеті стоїть збоку від карти, на телефоні — шторкою знизу. Це та
 * сама панель: розводити їх у два компоненти означало б два списки, які
 * розійдуться на першій же правці.
 *
 * Три речі, яких у ній не було й через які вона лишалася довідкою, а не
 * інструментом:
 *
 *   Порядок за замовчуванням — логістичний, а не з листа. Номери рядків у
 *   документі 1С обʼїздом не є: той самий район вони обходять за 900 км
 *   замість двохсот.
 *
 *   Точка, до якої їдемо ЗАРАЗ, підсвічена й пульсує — так само, як пін на
 *   карті. Тридцять однакових рядків за кермом не читаються.
 *
 *   Порядок можна перетягнути під себе. OSRM не знає, що цей магазин
 *   відчиняється о десятій, а в той двір не заїхати до обіду.
 */

import { useCallback, useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PlanStop } from "@/components/map/SalesClientsMap";

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/**
 * Тягнемо тільки вгору-вниз.
 *
 * Свій модифікатор, а не пакет @dnd-kit/modifiers: там на це рівно один
 * рядок, а зайва залежність у застосунку, який ставлять руками на планшети,
 * — це ще один привід збірці зламатися.
 */
const verticalOnly = ({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => ({
  ...transform,
  x: 0,
});

/** Який порядок показуємо. `mine` зʼявляється, лише коли водій щось перетягнув. */
export type RouteOrder = "optimal" | "sheet" | "mine";

/** Скільки найближчих точок показувати. Число — «наступні N», null — усі. */
export type Horizon = 1 | 3 | 5 | null;

const HORIZONS: Array<{ value: Horizon; label: string }> = [
  { value: 1, label: "1" },
  { value: 3, label: "3" },
  { value: 5, label: "5" },
  { value: null, label: "усі" },
];

const ORDER_LABEL: Record<RouteOrder, string> = {
  optimal: "Логістичний",
  sheet: "З листа",
  mine: "Мій",
};

export type PanelStop = PlanStop & {
  legKm?: number | null;
  /** Дорога від місця водія (або складу) до цієї точки. Лише в першої. */
  approachKm?: number | null;
  approachFrom?: "me" | "warehouse" | null;
};

export default function RoutePanel({
  stops,
  order,
  orders,
  onOrderChange,
  horizon,
  onHorizonChange,
  editing,
  onEditingChange,
  onReorder,
  onResetOrder,
  onPick,
  onFocus,
  totals,
  loading,
  strayCount,
  labels,
}: {
  /** Точки в поточному порядку, перша невідмічена помічена як current */
  stops: PanelStop[];
  order: RouteOrder;
  /** Які порядки взагалі доступні — «Мій» лише коли він збережений */
  orders: RouteOrder[];
  onOrderChange: (o: RouteOrder) => void;
  horizon: Horizon;
  onHorizonChange: (h: Horizon) => void;
  editing: boolean;
  onEditingChange: (v: boolean) => void;
  onReorder: (keys: string[]) => void;
  onResetOrder: () => void;
  /** Тап по рядку — питаємо «побудувати маршрут сюди?» */
  onPick: (stop: PanelStop) => void;
  /** Показати точку на карті, не питаючи нічого */
  onFocus: (stop: PanelStop) => void;
  totals: { km: string; hours: string; approach?: string } | null;
  loading: boolean;
  strayCount: number;
  /**
   * Свої підписи для кнопок порядку. Потрібні через маршрут сайту: там
   * «З листа» означає не номери документа, а обʼїзд, прокладений логістом.
   */
  labels?: Partial<Record<RouteOrder, string>>;
}) {
  const sensors = useSensors(
    // Поріг, щоб тап по рядку не читався як початок перетягування.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Затримка на тачі — інакше вертикальний скрол списку перехоплювався б.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );

  /**
   * Горизонт ріже список ВІД ПОТОЧНОЇ ТОЧКИ, а не від початку дня.
   *
   * «Наступні три» після обіду означає три попереду, а не перші три з
   * ранку, які давно позаду.
   */
  const shown = useMemo(() => {
    if (horizon == null || editing) return stops;
    const from = Math.max(0, stops.findIndex((s) => s.current));
    return stops.slice(from, from + horizon);
  }, [stops, horizon, editing]);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = stops.findIndex((s) => s.key === active.id);
      const to = stops.findIndex((s) => s.key === over.id);
      if (from === -1 || to === -1) return;
      onReorder(arrayMove(stops, from, to).map((s) => s.key));
    },
    [stops, onReorder]
  );

  const done = stops.filter((s) => s.status !== "PENDING").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Шапка: скільки пройдено, скільки дороги */}
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid #F1F1EF" }}>
        {/* На телефоні ці ж числа вже стоять у шапці шторки, під якою
            панель і живе, — повторювати їх удруге немає сенсу. */}
        <span className="hidden lg:inline" style={{ fontSize: "14px", fontWeight: 700, color: "#0A0A0A" }}>
          {done} з {stops.length}
        </span>
        <span className="hidden lg:inline" style={{ fontSize: "12px", color: "#6B7280" }}>
          {loading
            ? "рахую дорогу…"
            : totals
              ? `${totals.km} км · ${totals.hours}` + (totals.approach ? ` · ${totals.approach}` : "")
              : ""}
        </span>

        <button
          type="button"
          onClick={() => onEditingChange(!editing)}
          className="ml-auto cursor-pointer rounded-lg transition-colors duration-200"
          style={{
            minHeight: "34px",
            padding: "0 12px",
            border: "1px solid #E5E7EB",
            background: editing ? "#0A0A0A" : "#fff",
            color: editing ? "#fff" : "#374151",
            fontSize: "12.5px",
            fontWeight: 700,
          }}
        >
          {editing ? "Готово" : "Змінити порядок"}
        </button>
      </div>

      {/* Порядок обʼїзду і горизонт. У режимі правки ховаємо: там і так
          видно весь список, а перемикання порядку посеред перетягування
          стерло б щойно зроблене. */}
      {!editing && (
        <div className="flex flex-col gap-1.5 px-3 py-2" style={{ borderBottom: "1px solid #F1F1EF" }}>
          <div className="flex gap-1 rounded-full p-1" style={{ background: "#F3F4F6" }}>
            {orders.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onOrderChange(o)}
                aria-pressed={order === o}
                className="flex-1 cursor-pointer rounded-full transition-colors duration-200"
                style={{
                  minHeight: "34px",
                  border: "none",
                  background: order === o ? "#0A0A0A" : "transparent",
                  color: order === o ? "#fff" : "#374151",
                  fontSize: "12.5px",
                  fontWeight: order === o ? 700 : 500,
                }}
              >
                {labels?.[o] ?? ORDER_LABEL[o]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span style={{ fontSize: "12px", color: "#6B7280" }}>Показувати:</span>
            <div className="flex gap-1 rounded-full p-0.5" style={{ background: "#F3F4F6" }}>
              {HORIZONS.map((h) => (
                <button
                  key={String(h.value)}
                  type="button"
                  onClick={() => onHorizonChange(h.value)}
                  aria-pressed={horizon === h.value}
                  className="cursor-pointer rounded-full transition-colors duration-200"
                  style={{
                    minWidth: "38px",
                    minHeight: "30px",
                    border: "none",
                    background: horizon === h.value ? "#0A0A0A" : "transparent",
                    color: horizon === h.value ? "#fff" : "#6B7280",
                    fontSize: "12px",
                    fontWeight: 700,
                  }}
                >
                  {h.label}
                </button>
              ))}
            </div>
            {order === "mine" && (
              <button
                type="button"
                onClick={onResetOrder}
                className="ml-auto cursor-pointer"
                style={{
                  border: "none",
                  background: "none",
                  color: "#6B7280",
                  fontSize: "12px",
                  textDecoration: "underline",
                  padding: "6px 0",
                }}
              >
                Скинути
              </button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <p className="px-3 py-2" style={{ fontSize: "12px", color: "#6B7280", lineHeight: 1.4 }}>
          Тримайте рядок і тягніть, куди зручно. Порядок збережеться тільки для вас — у листі й в
          офісі він лишається тим самим.
        </p>
      )}

      {/* Сам список */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[verticalOnly]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={shown.map((s) => s.key)} strategy={verticalListSortingStrategy}>
            {shown.map((s, i) => (
              <Row
                key={s.key}
                stop={s}
                index={stops.indexOf(s)}
                editing={editing}
                isLastShown={i === shown.length - 1}
                onPick={() => onPick(s)}
                onFocus={() => onFocus(s)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {shown.length === 0 && (
          <p className="px-3 py-4" style={{ fontSize: "13px", color: "#9CA3AF" }}>
            Точок немає.
          </p>
        )}
      </div>

      {strayCount > 0 && !editing && (
        <p
          className="px-3 py-2"
          style={{ fontSize: "11px", color: "#D97706", borderTop: "1px solid #F1F1EF", lineHeight: 1.4 }}
        >
          {strayCount} точок стоять далеко від решти — там координати лише за назвою міста. У
          розрахунок дороги вони не входять.
        </p>
      )}
    </div>
  );
}

/** Один рядок списку. Окремо, бо useSortable — це хук, а хук у циклі не поставиш. */
function Row({
  stop,
  index,
  editing,
  isLastShown,
  onPick,
  onFocus,
}: {
  stop: PanelStop;
  index: number;
  editing: boolean;
  isLastShown: boolean;
  onPick: () => void;
  onFocus: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.key,
    disabled: !editing,
  });

  const badge =
    stop.status === "DONE" ? "#16A34A" : stop.status === "MISSED" ? "#DC2626" : stop.current ? "#2563EB" : "#0A0A0A";

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        borderBottom: "1px solid #F1F1EF",
        background: stop.current && !editing ? "#EFF6FF" : "#fff",
        touchAction: editing ? "none" : undefined,
      }}
      className={stop.current && !editing ? "driver-target-row" : undefined}
      /*
        Атрибути dnd-kit вішаємо ЛИШЕ в режимі правки.
        Поза ним він ставить на рядок role="button" і aria-disabled: рядок
        починає прикидатися вимкненою кнопкою, хоча всередині нього живі
        кнопки «→» і назва клієнта. Для екранного читача це означає «тут
        нічого не натиснеш», а браузерні перевірки натискань це підтвердили.
      */
      {...(editing ? { ...attributes, ...listeners } : {})}
    >
      <div className="flex items-center gap-2.5 px-3" style={{ paddingTop: "9px", paddingBottom: "9px" }}>
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center"
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "9px",
            fontSize: "12.5px",
            fontWeight: 800,
            background: badge,
            color: stop.status === "PENDING" && !stop.current ? "#FFD600" : "#fff",
          }}
        >
          {stop.errand ? "+" : index + 1}
        </span>

        <button
          type="button"
          onClick={editing ? undefined : onFocus}
          disabled={editing}
          className="min-w-0 flex-1 cursor-pointer text-left"
          style={{ border: "none", background: "none", padding: 0 }}
        >
          {stop.current && !editing && (
            <span
              style={{
                display: "block",
                fontSize: "10.5px",
                fontWeight: 800,
                color: "#2563EB",
                letterSpacing: "0.04em",
              }}
            >
              ЇДЕТЕ СЮДИ
              {/* Подача — головне число для того, хто щойно виїхав: скільки
                  до ПЕРШОЇ точки. Далі йдуть перегони між точками, а до
                  першої дороги в них немає за побудовою. */}
              {stop.approachKm != null && (
                <span style={{ fontWeight: 700, color: "#1D4ED8" }}>
                  {" · "}
                  {stop.approachFrom === "warehouse" ? "від складу" : "від вас"}{" "}
                  {String(stop.approachKm).replace(".", ",")} км
                </span>
              )}
            </span>
          )}
          <span
            className="block truncate"
            style={{ fontSize: "13.5px", fontWeight: 600, color: "#0A0A0A" }}
          >
            {stop.name}
          </span>
          {!!stop.address && (
            <span className="block truncate" style={{ fontSize: "11.5px", color: "#9CA3AF" }}>
              {stop.address}
            </span>
          )}
        </button>

        {editing ? (
          <span aria-hidden className="shrink-0" style={{ color: "#9CA3AF", fontSize: "18px", padding: "0 4px" }}>
            ⠿
          </span>
        ) : (
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            {stop.amount > 0 && (
              <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#374151" }}>
                {money.format(stop.amount)} ₴
              </span>
            )}
            {stop.legKm != null && !isLastShown && (
              <span style={{ fontSize: "11.5px", color: "#9CA3AF" }}>↓ {stop.legKm} км</span>
            )}
          </span>
        )}

        {!editing && stop.status === "PENDING" && (
          <button
            type="button"
            onClick={onPick}
            aria-label={`Побудувати маршрут до «${stop.name}»`}
            className="shrink-0 cursor-pointer rounded-lg transition-colors duration-200"
            style={{
              minWidth: "38px",
              minHeight: "38px",
              border: "none",
              background: stop.current ? "#2563EB" : "#EFF6FF",
              color: stop.current ? "#fff" : "#1D4ED8",
              fontSize: "15px",
              fontWeight: 700,
            }}
          >
            →
          </button>
        )}
      </div>
    </div>
  );
}
