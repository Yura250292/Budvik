"use client";

/**
 * Побудова маршруту для логіста: два варіанти з реальними цифрами.
 *
 * Той самий рушій, що й у планшеті водія (`/api/routes/optimize-day`), і
 * та сама логіка вибору: показуємо ціну обох варіантів, рішення за
 * людиною. Різниця лише в тому, звідки старт — логіст рахує зі складу,
 * водій від свого місця.
 *
 * Замінює попередню «AI-оптимізацію», де порядок точок вигадувала мовна
 * модель, а її ж оцінка кілометражу зберігалася як факт і йшла у
 * розрахунок пального.
 */

import { useCallback, useEffect, useState } from "react";
import DynamicDeliveryMap from "@/components/map/DynamicMap";

type VariantStop = {
  key: string;
  /** Рядки маршруту, які представляє точка (кілька накладних на адресу) */
  mergedKeys: string[];
  name: string;
  reason: string;
  score: number;
  /** Номер точки в СПИСКУ маршруту — той самий, що на пін і в редакторі */
  sequence: number;
  /** false — точка без координат: у розрахунок км і на карту не потрапляє */
  routed: boolean;
  lat: number | null;
  lng: number | null;
};

type Variant = {
  order: string[];
  distanceKm: number;
  durationMin: number;
  fuelCost: number;
  geometry: { type: string; coordinates: [number, number][] } | null;
  stops: VariantStop[];
};

type Plan = {
  cheapest: Variant;
  balanced: Variant | null;
  detourPercent: number;
  extraCost: number;
  startName: string | null;
  startedFromFirstStop: boolean;
  /** [lng, lat] точки виїзду — для карти й посилання на Google Maps */
  start?: [number, number] | null;
};

/**
 * Посилання на Google Maps по затвердженому порядку.
 *
 * Google приймає щонайбільше ~10 точок на посилання (початок + 8 проміжних
 * + кінець), а в денному маршруті їх буває 25. Тому ділимо на частини:
 * кожна наступна стартує з останньої точки попередньої — водій доїхав до
 * кінця частини 1, відкрив частину 2 і поїхав далі без розриву.
 */
function googleMapsLinks(points: Array<{ lat: number; lng: number }>): string[] {
  const MAX_PER_LINK = 10;
  const links: string[] = [];
  let i = 0;
  while (i < points.length - 1) {
    const chunk = points.slice(i, i + MAX_PER_LINK);
    const origin = chunk[0];
    const dest = chunk[chunk.length - 1];
    const waypoints = chunk
      .slice(1, -1)
      .map((p) => `${p.lat},${p.lng}`)
      .join("|");
    links.push(
      `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}` +
        `&destination=${dest.lat},${dest.lng}` +
        (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "") +
        `&travelmode=driving`
    );
    i += MAX_PER_LINK - 1;
  }
  return links;
}

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

export default function RouteOptimizer({
  driverId,
  date,
  onApplied,
  onPreviewOrder,
}: {
  routeId: string;
  driverId: string | null;
  date: string;
  onApplied: () => void;
  /**
   * Показати запропонований порядок у списку точок ПЕРЕД збереженням.
   *
   * Порядок спершу лягає в список, і вже список задає номери пінів —
   * інакше карта нумерує лише геокодовані точки, список нумерує всі, і
   * той самий номер означає в них різних клієнтів.
   */
  onPreviewOrder?: (stopIds: string[] | null) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<"cheapest" | "balanced" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "farthest" — спершу довгий перегін у найдальшу точку, хвіст дня біля
  // складу: недовезене сьогодні водій легко закриває завтра, бо це поруч.
  const [direction, setDirection] = useState<"nearest" | "farthest">("nearest");
  /** Який варіант зараз показано на карті. null — карту згорнуто. */
  const [preview, setPreview] = useState<"cheapest" | "balanced" | null>(null);
  /** Після збереження порядку: посилання Google Maps для передачі водієві. */
  const [applied, setApplied] = useState<{ title: string; links: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  const day = date?.slice(0, 10);

  const build = useCallback(
    async (dir: "nearest" | "farthest") => {
      if (!driverId) {
        setError("Спершу призначте водія — маршрут будується для конкретної людини");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/routes/optimize-day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ driverId, day, direction: dir }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
        setPlan(json as Plan);
        setApplied(null);
        // Одразу показуємо найдешевший: спершу порядок лягає у СПИСОК
        // точок, і вже звідти — на карту. Дивитися на карту з номерами,
        // яких немає в списку під нею, — це і був головний баг.
        setPreview("cheapest");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося прокласти маршрут");
      } finally {
        setLoading(false);
      }
    },
    [driverId, day]
  );

  // Перемикання напрямку з уже показаним планом одразу перераховує:
  // тримати на екрані план одного напрямку під підписом іншого не можна.
  const switchDirection = useCallback(
    (dir: "nearest" | "farthest") => {
      setDirection(dir);
      if (plan) build(dir);
    },
    [plan, build]
  );

  /**
   * Порядок обраного варіанта — у список точок під картками.
   *
   * Емітимо з ефекту, а не з обробника кнопки: план перераховується ще й
   * при зміні напрямку обʼїзду та після видалення точки, і список має
   * їхати за планом у всіх трьох випадках.
   */
  const previewVariant =
    preview === "cheapest" ? plan?.cheapest ?? null : preview === "balanced" ? plan?.balanced ?? null : null;
  useEffect(() => {
    if (!onPreviewOrder) return;
    onPreviewOrder(
      previewVariant
        ? previewVariant.order.filter((k) => k.startsWith("ds:")).map((k) => k.slice(3))
        : null
    );
  }, [previewVariant, onPreviewOrder]);
  // Панель згорнули разом із маршрутом — список має повернутись у свій
  // збережений порядок, а не завмерти в непідтвердженому.
  useEffect(() => () => onPreviewOrder?.(null), [onPreviewOrder]);

  /**
   * Прибрати точку прямо з карти-прев'ю.
   *
   * Видаляє точку з маршруту по-справжньому (той самий ендпоінт, що «✕» у
   * планувальнику: перенумерація, накладна звільняється) і одразу
   * перераховує обидва варіанти — карта показує маршрут уже без неї.
   */
  const removeStop = useCallback(
    async (key: string) => {
      if (!key.startsWith("ds:")) {
        setError("Цю точку можна прибрати лише після конверсії листа в маршрут сайту");
        return;
      }
      if (!confirm("Прибрати точку з маршруту?\n\nНакладна повернеться у «спосіб доставки не визначено».")) {
        return;
      }
      setError(null);
      try {
        const res = await fetch(`/api/erp/delivery-routes/stop/${key.slice(3)}`, { method: "DELETE" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "Не вдалося прибрати точку");
        onApplied();
        await build(direction);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося прибрати точку");
      }
    },
    [direction, build, onApplied]
  );

  const apply = useCallback(
    async (which: "cheapest" | "balanced") => {
      const variant = which === "cheapest" ? plan?.cheapest : plan?.balanced;
      if (!variant) return;
      setApplying(which);
      setError(null);
      try {
        const res = await fetch("/api/routes/apply-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driverId,
            day,
            order: variant.order,
            distanceKm: variant.distanceKm,
            fuelCost: variant.fuelCost,
            // Геометрія — планшет водія намалює лінію обраного маршруту
            geometry: variant.geometry,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти порядок");
        // Посилання будуємо в момент збереження: після setPlan(null) точок
        // уже не буде звідки взяти.
        const start = plan?.start;
        const coords = [
          ...(start ? [{ lat: start[1], lng: start[0] }] : []),
          ...variant.stops
            .filter((s) => s.lat != null && s.lng != null)
            .map((s) => ({ lat: s.lat!, lng: s.lng! })),
        ];
        setApplied({
          title: which === "cheapest" ? "Найдешевший" : "З пріоритетами",
          links: coords.length >= 2 ? googleMapsLinks(coords) : [],
        });
        setCopied(false);
        setPlan(null);
        setPreview(null);
        onApplied();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося зберегти порядок");
      } finally {
        setApplying(null);
      }
    },
    [plan, driverId, day, onApplied]
  );

  return (
    <div style={{ padding: "12px 20px", background: "#FAFAFA", borderTop: "1px solid #F3F4F6" }}>
      {!plan ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => build(direction)}
            disabled={loading}
            className="cursor-pointer transition-colors duration-200"
            style={{
              minHeight: "40px",
              padding: "9px 18px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              background: loading ? "#E5E7EB" : "#2563EB",
              color: loading ? "#6B7280" : "#fff",
              border: "none",
            }}
          >
            {loading ? "Рахую маршрут…" : "Прокласти маршрут"}
          </button>
          <DirectionToggle direction={direction} disabled={loading} onChange={switchDirection} />
          <span style={{ fontSize: "12px", color: "#6B7280" }}>
            Порахує найкоротший обʼїзд і варіант, у якому боржники та важливі
            клієнти йдуть раніше. «Спершу дальні» — виїзд одразу в найдальшу
            точку, кінець дня біля складу.
          </span>
        </div>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#0A0A0A" }}>
              Оберіть варіант
              {plan.startName && (
                <span style={{ fontWeight: 400, color: "#6B7280" }}> · старт: {plan.startName}</span>
              )}
            </span>
            <DirectionToggle direction={direction} disabled={loading || applying !== null} onChange={switchDirection} />
            <button
              type="button"
              onClick={() => {
                setPlan(null);
                setPreview(null);
              }}
              className="cursor-pointer transition-colors duration-200"
              style={{
                background: "none",
                border: "none",
                color: "#6B7280",
                fontSize: "13px",
                minHeight: "40px",
                padding: "0 8px",
              }}
            >
              Скасувати
            </button>
          </div>

          {plan.startedFromFirstStop && (
            <p style={{ fontSize: "12px", color: "#D97706", marginBottom: "8px" }}>
              Складу з координатами немає — порахував від першої точки. Задайте
              координати складу, щоб цифри були точні.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Card
              title="Найдешевший"
              accent="#16A34A"
              variant={plan.cheapest}
              note="Мінімум кілометрів"
              busy={applying === "cheapest"}
              disabled={applying !== null}
              onApply={() => apply("cheapest")}
              previewing={preview === "cheapest"}
              onPreview={() => setPreview(preview === "cheapest" ? null : "cheapest")}
            />
            {plan.balanced ? (
              <Card
                title="З пріоритетами"
                accent="#F97316"
                variant={plan.balanced}
                note={
                  plan.extraCost > 0
                    ? `Довше на ${plan.detourPercent}% · дорожче на ${money.format(plan.extraCost)} ₴`
                    : "Той самий пробіг, кращий порядок"
                }
                busy={applying === "balanced"}
                disabled={applying !== null}
                onApply={() => apply("balanced")}
                previewing={preview === "balanced"}
                onPreview={() => setPreview(preview === "balanced" ? null : "balanced")}
              />
            ) : (
              <div
                className="flex-1"
                style={{
                  minWidth: "260px",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "#F9FAFB",
                  border: "1px dashed #E5E7EB",
                  fontSize: "12px",
                  color: "#6B7280",
                  lineHeight: 1.5,
                }}
              >
                Окремий варіант з пріоритетами не потрібен: найкоротший маршрут
                уже обслуговує важливих клієнтів вчасно.
              </div>
            )}
          </div>

          {(() => {
            const variant = previewVariant;
            if (!variant) return null;
            // Номери пінів — це `sequence` зі списку, а не позиція в
            // геокодованому підмножині: точка без координат теж займає
            // свій номер у списку, і карта мусить це поважати, інакше
            // «четвертий» на карті і «четвертий» у списку — різні люди.
            const mapStops = [
              ...(plan.start
                ? [{ lat: plan.start[1], lng: plan.start[0], label: plan.startName ?? "Старт", type: "start" as const }]
                : []),
              ...variant.stops
                .filter((s) => s.routed && s.lat != null && s.lng != null)
                .map((s) => ({
                  lat: s.lat!,
                  lng: s.lng!,
                  label: `${s.sequence}. ${s.name}`,
                  sequence: s.sequence,
                  type: "stop" as const,
                  id: s.key,
                })),
            ];
            const unrouted = variant.stops.filter((s) => !s.routed);
            return (
              <div style={{ marginTop: "12px" }}>
                <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "6px" }}>
                  Номери на карті — це номери зі списку точок нижче. Порядок ще
                  не збережено: натисніть «Обрати цей».
                </p>
                {unrouted.length > 0 && (
                  <p style={{ fontSize: "12px", color: "#D97706", marginBottom: "6px" }}>
                    Без координат, тому в кінці списку і не на карті:{" "}
                    {unrouted.map((s) => `${s.sequence}. ${s.name}`).join("; ")}. Уточніть
                    пін — і точка стане в маршрут.
                  </p>
                )}
                <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid #E5E7EB" }}>
                  <DynamicDeliveryMap
                    stops={mapStops}
                    routeGeometry={(variant.geometry as GeoJSON.LineString | null) ?? null}
                    height="420px"
                    onRemoveStop={removeStop}
                  />
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {applied && !plan && (
        <div
          style={{
            marginTop: "4px",
            padding: "12px",
            borderRadius: "10px",
            background: "#F0FDF4",
            border: "1px solid #BBF7D0",
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>
              Порядок збережено ({applied.title}).
            </span>
            {applied.links.length > 0 ? (
              <>
                <span style={{ fontSize: "12px", color: "#166534" }}>Навігація в Google Maps:</span>
                {applied.links.map((link, i) => (
                  <a
                    key={link}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "#166534",
                      textDecoration: "underline",
                    }}
                  >
                    {applied.links.length === 1 ? "Відкрити маршрут" : `Частина ${i + 1}`}
                  </a>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(applied.links.join("\n"))
                      .then(() => setCopied(true))
                      .catch(() => setError("Не вдалося скопіювати — виділіть посилання вручну"));
                  }}
                  className="cursor-pointer"
                  style={{
                    minHeight: "32px",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "1px solid #86EFAC",
                    background: "#fff",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#166534",
                  }}
                >
                  {copied ? "Скопійовано ✓" : "Скопіювати посилання"}
                </button>
                {applied.links.length > 1 && (
                  <span style={{ fontSize: "11.5px", color: "#4D7C0F" }}>
                    Google Maps вміщує до 10 точок на посилання, тому маршрут поділено: кожна
                    наступна частина стартує з кінця попередньої.
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: "12px", color: "#4D7C0F" }}>
                Посилання нема з чого скласти — у точок бракує координат.
              </span>
            )}
            <button
              type="button"
              onClick={() => setApplied(null)}
              className="cursor-pointer"
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                color: "#166534",
                fontSize: "13px",
                minHeight: "32px",
                padding: "0 8px",
              }}
            >
              Сховати
            </button>
          </div>
        </div>
      )}

      {error && (
        <p style={{ fontSize: "12px", color: "#B91C1C", marginTop: "8px" }}>{error}</p>
      )}
    </div>
  );
}

/**
 * Напрямок обʼїзду. Це не третій варіант маршруту, а дзеркало тих самих
 * двох: тому перемикач живе окремо від карток і перераховує план одразу.
 */
function DirectionToggle({
  direction,
  disabled,
  onChange,
}: {
  direction: "nearest" | "farthest";
  disabled: boolean;
  onChange: (dir: "nearest" | "farthest") => void;
}) {
  const options = [
    { key: "nearest" as const, label: "Спершу ближні" },
    { key: "farthest" as const, label: "Спершу дальні" },
  ];
  return (
    <div
      role="group"
      aria-label="Напрямок обʼїзду"
      style={{ display: "inline-flex", borderRadius: "8px", border: "1px solid #E5E7EB", overflow: "hidden" }}
    >
      {options.map((o) => {
        const active = direction === o.key;
        return (
          <button
            key={o.key}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => !active && onChange(o.key)}
            className="cursor-pointer transition-colors duration-200"
            style={{
              minHeight: "40px",
              padding: "0 12px",
              fontSize: "12px",
              fontWeight: 600,
              border: "none",
              background: active ? "#0A0A0A" : "#fff",
              color: active ? "#fff" : "#6B7280",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Card({
  title,
  accent,
  variant,
  note,
  busy,
  disabled,
  onApply,
  previewing,
  onPreview,
}: {
  title: string;
  accent: string;
  variant: Variant;
  note: string;
  busy: boolean;
  disabled: boolean;
  onApply: () => void;
  previewing: boolean;
  onPreview: () => void;
}) {
  return (
    <div
      className="flex-1"
      style={{
        minWidth: "260px",
        background: "#fff",
        border: `1px solid ${accent}33`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: "10px",
        padding: "12px",
      }}
    >
      <div className="flex items-baseline gap-2">
        <span style={{ fontSize: "13px", fontWeight: 700 }}>{title}</span>
        <span style={{ fontSize: "12px", color: "#6B7280" }}>
          {variant.distanceKm} км · {Math.floor(variant.durationMin / 60)} год{" "}
          {variant.durationMin % 60} хв
        </span>
        <span style={{ marginLeft: "auto", fontSize: "15px", fontWeight: 700, color: accent }}>
          {money.format(variant.fuelCost)} ₴
        </span>
      </div>
      <p style={{ fontSize: "11.5px", color: "#6B7280", margin: "3px 0 8px" }}>{note}</p>

      {/* Номери проставляємо самі, а не нумерацією <ol>: точка може
          представляти кілька рядків маршруту, і тоді її номер у списку
          не дорівнює позиції в цьому переліку. */}
      <ul style={{ margin: "0 0 10px", padding: 0, listStyle: "none", fontSize: "12px", color: "#374151" }}>
        {variant.stops.slice(0, 5).map((s) => (
          <li key={s.key} style={{ lineHeight: 1.6 }}>
            <span style={{ color: "#9CA3AF", fontWeight: 700 }}>{s.sequence}.</span> {s.name}
            {!s.routed && <span style={{ color: "#D97706" }}> — без координат</span>}
            {s.routed && s.score >= 0.35 && (
              <span style={{ color: "#9CA3AF" }}> — {s.reason}</span>
            )}
          </li>
        ))}
        {variant.stops.length > 5 && (
          <li style={{ color: "#9CA3AF" }}>ще {variant.stops.length - 5}…</li>
        )}
      </ul>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={disabled}
          className="flex-1 cursor-pointer transition-colors duration-200"
          style={{
            minHeight: "40px",
            borderRadius: "8px",
            border: "none",
            background: busy ? "#E5E7EB" : accent,
            color: busy ? "#6B7280" : "#fff",
            fontSize: "13px",
            fontWeight: 700,
            opacity: disabled && !busy ? 0.5 : 1,
          }}
        >
          {busy ? "Застосовую…" : "Обрати цей"}
        </button>
        <button
          type="button"
          onClick={onPreview}
          aria-pressed={previewing}
          className="cursor-pointer transition-colors duration-200"
          style={{
            minHeight: "40px",
            padding: "0 14px",
            borderRadius: "8px",
            border: `1px solid ${previewing ? accent : "#E5E7EB"}`,
            background: previewing ? `${accent}14` : "#fff",
            color: previewing ? accent : "#374151",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          {previewing ? "Сховати карту" : "На карті"}
        </button>
      </div>
    </div>
  );
}
