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

import { useCallback, useState } from "react";

type Variant = {
  order: string[];
  distanceKm: number;
  durationMin: number;
  fuelCost: number;
  geometry: { type: string; coordinates: [number, number][] } | null;
  stops: Array<{ key: string; name: string; reason: string; score: number; sequence: number }>;
};

type Plan = {
  cheapest: Variant;
  balanced: Variant | null;
  detourPercent: number;
  extraCost: number;
  startName: string | null;
  startedFromFirstStop: boolean;
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

export default function RouteOptimizer({
  driverId,
  date,
  onApplied,
}: {
  routeId: string;
  driverId: string | null;
  date: string;
  onApplied: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<"cheapest" | "balanced" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "farthest" — спершу довгий перегін у найдальшу точку, хвіст дня біля
  // складу: недовезене сьогодні водій легко закриває завтра, бо це поруч.
  const [direction, setDirection] = useState<"nearest" | "farthest">("nearest");

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
        setPlan(null);
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
              onClick={() => setPlan(null)}
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
}: {
  title: string;
  accent: string;
  variant: Variant;
  note: string;
  busy: boolean;
  disabled: boolean;
  onApply: () => void;
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

      <ol style={{ margin: "0 0 10px", padding: "0 0 0 18px", fontSize: "12px", color: "#374151" }}>
        {variant.stops.slice(0, 5).map((s) => (
          <li key={s.key} style={{ lineHeight: 1.6 }}>
            {s.name}
            {s.score >= 0.35 && (
              <span style={{ color: "#9CA3AF" }}> — {s.reason}</span>
            )}
          </li>
        ))}
        {variant.stops.length > 5 && (
          <li style={{ color: "#9CA3AF" }}>ще {variant.stops.length - 5}…</li>
        )}
      </ol>

      <button
        type="button"
        onClick={onApply}
        disabled={disabled}
        className="w-full cursor-pointer transition-colors duration-200"
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
    </div>
  );
}
