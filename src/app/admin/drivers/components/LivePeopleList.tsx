"use client";

/**
 * Хто сьогодні в дорозі — компактний список праворуч від карти.
 *
 * Був таблицею на вісім колонок під картою: щоб вибрати людину, доводилося
 * гортати вниз, а щоб побачити її трек — назад угору. Тепер вибір стоїть
 * поруч із картою, а цифри звірки переїхали в деталь під ними: у списку
 * лишилося рівно те, за чим шукають людину очима — ім'я, стан, пробіг і чи
 * є замовлення.
 */

import type { Person } from "./LiveTrackTab";

/**
 * Найсвіжіше з того, що ми знаємо про збірку на планшеті.
 *
 * Пульс надійніший: його шле сама служба, і він приходить щохвилини. Але
 * шлють його лише збірки від 1.3 — а найцікавіші якраз старіші, і про
 * них розповідає User-Agent кабінету, збережений при відкритті.
 */
function appVersion(p: Person): string | null {
  return p.device?.appVersion ?? p.installedVersion;
}

/**
 * Поточна збірка. Свідомо рядком, а не звіркою з /api/app/version:
 * зайвий запит заради кольору однієї підказки не вартий того, а
 * розходження після релізу помітно одразу — уся колонка стає
 * помаранчевою, поки планшети не оновляться.
 */
const CURRENT_BUILD = "1.5";

function isCurrentBuild(v: string | null): boolean {
  return v === CURRENT_BUILD;
}

/** Що написати про людину одним рядком: де вона і коли озивалася востаннє. */
function stateText(p: Person): string {
  if (p.online) {
    return p.speedKmh != null && p.speedKmh > 5 ? `їде ${p.speedKmh} км/год` : "на місці";
  }
  if (p.minutesAgo != null) return `${p.minutesAgo} хв тому`;
  if (p.shift?.silentSinceStartMin != null) {
    return `жодної точки за ${p.shift.silentSinceStartMin} хв зміни`;
  }
  return "точок немає";
}

export function LivePeopleList({
  people,
  selectedId,
  onSelect,
  troubledCount,
}: {
  people: Person[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  troubledCount: number;
}) {
  const onlineCount = people.filter((p) => p.online).length;

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-g200 bg-white px-3 py-2 text-xs text-g500">
        {onlineCount} на маршруті
        {troubledCount > 0 && <b className="text-red-600"> · {troubledCount} з проблемою</b>}
      </div>

      {/*
        Порядок — той, що прийшов із сервера, без клієнтського сортування.
        Список оновлюється кожні пів хвилини: якби проблемні спливали вгору
        самі, рядок міг би поїхати з-під курсора рівно в мить кліку.
      */}
      {people.map((p) => {
        const mine = selectedId === p.userId;
        const version = appVersion(p);
        return (
          <button
            key={p.userId}
            type="button"
            aria-pressed={mine}
            onClick={() => onSelect(mine ? null : p.userId)}
            className={`flex w-full cursor-pointer items-start justify-between gap-2 border-b border-g100 px-3 py-2.5 text-left transition-colors last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-dark ${
              mine ? "bg-primary/10" : "hover:bg-g50"
            }`}
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    p.online ? "bg-green-600" : p.problem ? "bg-red-600" : "bg-g300"
                  }`}
                />
                <span className="text-sm font-medium text-bk">{p.name}</span>
                <span className="text-xs text-g400">
                  {p.role === "DRIVER" ? "водій" : "торговий"}
                </span>
                {/*
                  Збірка застосунку — поруч з іменем, дрібним. Половина
                  розборів «чому немає треку» починається саме з цього
                  питання. Помаранчевим — усе, що старіше за поточну: там
                  немає сторожа, який піднімає вбиту службу.
                */}
                {version && (
                  <span
                    title={
                      isCurrentBuild(version)
                        ? "Актуальна збірка"
                        : "Стара збірка — оновити застосунок"
                    }
                    className={`text-[11px] ${isCurrentBuild(version) ? "text-g400" : "text-amber-700"}`}
                  >
                    v{version}
                  </span>
                )}
              </span>

              <span
                className={`mt-0.5 block text-xs ${
                  p.online ? "text-green-700" : p.problem ? "text-red-600" : "text-g400"
                }`}
              >
                {stateText(p)}
              </span>

              {/* Проблема — окремим рядком: її не можна пропустити в потоці цифр. */}
              {p.problem && (
                <span className="mt-0.5 block text-xs leading-snug text-red-700">{p.problem}</span>
              )}

              {p.device && (
                <span className="mt-0.5 block text-[11px] text-g400">
                  пульс {p.device.minutesAgo} хв тому
                  {p.device.buffered > 0 && ` · у буфері ${p.device.buffered}`}
                  {p.device.batteryPct != null && ` · батарея ${p.device.batteryPct}%`}
                </span>
              )}
            </span>

            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold tabular-nums text-bk">
                {p.distanceKm} км
              </span>
              {/* Сто кілометрів і жодного замовлення — теж результат, і
                  побачити його треба поруч із пробігом. */}
              <span
                className={`block text-xs tabular-nums ${
                  p.ordersToday > 0 ? "font-semibold text-bk" : "text-g400"
                }`}
              >
                {p.ordersToday || "—"} зам.
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
