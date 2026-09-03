"use client";

/**
 * Історія маршрутів: що було по днях.
 *
 * Три цифри в рядку зводяться вперше: скільки точок планували, скільки
 * відвідав і скільки проїхав насправді. Водієві це підтвердження роботи
 * перед розрахунком, керівникові — привід поставити питання.
 *
 * Тільки перегляд: виправити день може лише офіс, бо з цих чисел рахується
 * зарплата. Кнопки в рядку нічого не міняють — вони лише відкривають той
 * день на карті й у списку точок, бо самих цифр мало, щоб згадати поїздку.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { CabinetHeader } from "@/components/cabinet/Header";
import { Body, Button, Card, Note, Page } from "@/components/cabinet/ui";

type DayItem = {
  day: string;
  trackKm: number;
  trackPoints: number;
  visits: number;
  collected: number;
  routeNumber: string | null;
  plannedStops: number;
  plannedKm: number | null;
  fuelCost: number | null;
  sheet1CKm: number | null;
  /** Скільки заявив як здане за цей день, ₴ */
  handed: number;
  /** Скільки з цього офіс уже прийняв, ₴ */
  confirmed: number;
};

type Resp = {
  days: number;
  items: DayItem[];
  totals: { trackKm: number; visits: number; collected: number; handed: number; workDays: number };
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Кілометри — з комою: «15,8 км». Крапка в українському тексті читається як збій. */
const km = (n: number) => String(n).replace(".", ",");

function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    weekday: "short",
  }).format(d);
}

export default function DriverHistoryPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/driver/history")
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as Resp;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не вдалося завантажити"));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <CabinetHeader
        title="Історія маршрутів"
        subtitle={
          data
            ? `${data.totals.workDays} робочих днів · ${km(data.totals.trackKm)} км · ${money.format(data.totals.collected)} ₴ зібрано`
            : "За останні тижні"
        }
        backTo="/driver"
      />

      <Page>
        {!!error && (
          <Card tone="bad">
            <p className="text-sm font-semibold text-bad-fg">{error}</p>
          </Card>
        )}

        {!data && !error && (
          <Card>
            <Body>Завантаження…</Body>
          </Card>
        )}

        {data?.items.length === 0 && (
          <Card>
            <p className="text-[15px] font-semibold text-bk">Історія поки порожня</p>
            <Body>
              Дні зʼявляться, щойно ви попрацюєте з «Моїм днем»: він пише трек і зберігає відмітки
              візитів.
            </Body>
            <Button tone="dark" small href="/driver" className="mt-2 w-fit">
              До сьогоднішнього маршруту
            </Button>
          </Card>
        )}

        {data?.items.map((d) => (
          <Card key={d.day} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-[15px] font-bold text-bk">{formatDay(d.day)}</span>
                {!!d.routeNumber && (
                  <span className="shrink-0 text-xs text-cab-t3">{d.routeNumber}</span>
                )}
              </span>
              {d.collected > 0 && (
                <span className="shrink-0 text-[15px] font-bold text-ok-fg">
                  {money.format(d.collected)} ₴
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Stat label="Відвідано" value={`${d.visits}${d.plannedStops ? ` з ${d.plannedStops}` : ""}`} />
              <Stat label="Проїхано" value={d.trackKm > 0 ? `${km(d.trackKm)} км` : "—"} />
              {d.plannedKm != null && <Stat label="За планом" value={`${km(d.plannedKm)} км`} />}
              {d.sheet1CKm != null && <Stat label="Лист 1С" value={`${km(d.sheet1CKm)} км`} />}
              {d.fuelCost != null && d.fuelCost > 0 && (
                <Stat label="Пальне" value={`${money.format(d.fuelCost)} ₴`} />
              )}
            </div>

            {/* Каса: жовтим — поки гроші в дорозі, зеленим — коли офіс
                підтвердив прийом. Мовчимо лише коли й збирати не було чого. */}
            {(d.collected > 0 || d.handed > 0) && <CashLine day={d} />}

            {d.trackKm === 0 && d.visits > 0 && (
              <Note tone="warn">Треку немає — того дня застосунок не писав маршрут</Note>
            )}

            {/* Вихід у той день: досі історія була глухим кутом — цифри є, а
                подивитися, куди саме він тоді їздив, не було де. */}
            {(d.plannedStops > 0 || d.visits > 0) && (
              <div className="flex gap-2">
                <Link
                  href={`/driver/map?day=${d.day}`}
                  className="flex-1 rounded-xl py-2.5 text-center text-[13px] font-bold text-white"
                  style={{ background: "#2563EB" }}
                >
                  На карті
                </Link>
                <Link
                  href={`/driver/tablet?day=${d.day}`}
                  className="flex-1 rounded-xl border border-cab-line py-2.5 text-center text-[13px] font-bold text-bk"
                >
                  Точки дня
                </Link>
              </div>
            )}
          </Card>
        ))}

        {!!data?.items.length && (
          <Note>
            Історія — лише перегляд: виправити день може офіс. «Не здано» означає, що гроші ще у вас
            на руках.
          </Note>
        )}
      </Page>
    </>
  );
}

/**
 * Один рядок про гроші за день.
 *
 * Три різні стани, які легко злити в один і збрехати: гроші ще на руках,
 * здані й прийняті, здані й прийняті НЕ повністю. Останній випадок —
 * саме той, про який водій має дізнатися з історії, а не з розмови.
 */
function CashLine({ day }: { day: DayItem }) {
  const onHands = day.collected - day.handed;
  const pendingConfirm = day.handed - day.confirmed;

  const [text, tone] =
    onHands > 0
      ? [`Не здано ${money.format(onHands)} ₴`, "warn" as const]
      : day.handed === 0
        ? ["", "warn" as const]
        : pendingConfirm > 0.5
          ? day.confirmed > 0
            ? [
                `Здано ${money.format(day.handed)} ₴ · прийнято ${money.format(day.confirmed)} ₴`,
                "warn" as const,
              ]
            : [`Здано ${money.format(day.handed)} ₴ · чекає підтвердження`, "warn" as const]
          : [`Здано ${money.format(day.handed)} ₴ ✓`, "ok" as const];

  if (!text) return null;

  return (
    <p className={`text-xs font-semibold ${tone === "ok" ? "text-ok-fg" : "text-warn-fg"}`}>{text}</p>
  );
}

/** Підпис над числом, а не поруч: у ряд їх стає чотири, і пара «слово число» злипається. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[11px] text-cab-t3">{label}</span>
      <span className="text-[13px] font-semibold text-[#374151]">{value}</span>
    </span>
  );
}
