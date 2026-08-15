"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/components/ui/useApi";
import type { CurrencyResponse } from "@/app/api/admin/tools/currency/route";
import { WidgetBody } from "./parts";

const FLAG: Record<string, string> = { USD: "🇺🇸", EUR: "🇪🇺", PLN: "🇵🇱" };

const rate = (n: number | null, digits = 2) =>
  n == null ? "—" : n.toLocaleString("uk-UA", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Курси валют: офіційний НБУ, готівковий «Мінфіну» і внутрішній «Будвік».
 *
 * Три колонки, бо це три різні числа для трьох різних задач: за курсом
 * НБУ рахують документи, за готівковим — реально міняють гроші, а
 * «Будвік» (продаж + 55 коп.) — курс, до якого надалі привʼяжуться ціни.
 */
export function CurrencyRates() {
  const { data, loading, error } = useApi<CurrencyResponse>("/api/admin/tools/currency");

  const dateLabel = data?.officialDate
    ? new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit" }).format(
        new Date(`${data.officialDate}T12:00:00`)
      )
    : null;

  // Підпис відповідає тому, звідки насправді прийшла готівка цього разу.
  const cashSource = data?.sources.minfin ? "Мінфін" : "банки";

  return (
    <WidgetBody
      title="Курс валют"
      hint={dateLabel ? `НБУ на ${dateLabel} · готівка: ${cashSource}` : "НБУ та готівковий курс"}
      loading={loading && !data}
      error={error}
      empty={!!data && data.rates.every((r) => r.official == null && r.buy == null)}
    >
      {data && (
        <div className="flex h-full flex-col">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-g400">
            <span>Валюта</span>
            <span className="flex gap-3">
              <span className="w-[52px] text-right">НБУ</span>
              <span className="w-[88px] text-right">Купівля / Продаж</span>
              <span className="w-[52px] text-right">Budvik</span>
            </span>
          </div>

          {data.rates.map((r) => (
            <div key={r.code} className="flex items-center justify-between gap-2 border-t border-g100 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="text-[15px] leading-none">
                  {FLAG[r.code]}
                </span>
                <span className="text-[13px] font-medium text-bk">{r.code}</span>
                {/* Стрілка зміни офіційного курсу: одразу видно рух дня. */}
                {r.delta != null && r.delta !== 0 && (
                  <span
                    className={`text-[10px] font-semibold tabular-nums ${
                      r.delta > 0 ? "text-[#C62828]" : "text-[#1B7F3B]"
                    }`}
                  >
                    {r.delta > 0 ? "▲" : "▼"} {rate(Math.abs(r.delta), 2)}
                  </span>
                )}
              </span>

              <span className="flex flex-shrink-0 gap-3">
                <span className="w-[52px] text-right text-[13px] tabular-nums text-g600">{rate(r.official)}</span>
                {/* Банки котирують не всі валюти (напр. злотий) — тоді один
                    прочерк замість «— / —»: так видно, що даних просто немає. */}
                <span className="w-[88px] text-right text-[13px] tabular-nums text-g600">
                  {r.buy == null && r.sell == null ? (
                    "—"
                  ) : (
                    <>
                      {rate(r.buy)} <span className="text-g300">/</span> {rate(r.sell)}
                    </>
                  )}
                </span>
                {/* Свій курс — головне число рядка, тому єдиний жирний. */}
                <span className="w-[52px] text-right text-[13px] font-semibold tabular-nums text-bk">
                  {rate(r.budvik)}
                </span>
              </span>
            </div>
          ))}

          {!data.sources.nbu && (
            <p className="mt-auto pt-2 text-[10px] text-g400">Офіційний курс тимчасово недоступний</p>
          )}
        </div>
      )}
    </WidgetBody>
  );
}

/* ─────────────────────────── Калькулятор ─────────────────────────── */

const KEYS = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "0", ".", "=", "+"] as const;

/**
 * Обчислення виразу з двох операндів.
 * Свій міні-парсер, а не eval: eval на рядку з інтерфейсу — це діра,
 * а більше двох операндів кишеньковому калькулятору й не потрібно.
 */
function compute(a: number, op: string, b: number): number | null {
  switch (op) {
    case "+":
      return a + b;
    case "−":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b === 0 ? null : a / b;
    default:
      return null;
  }
}

const fmtResult = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString("uk-UA") : Number(n.toFixed(4)).toLocaleString("uk-UA");

/**
 * Калькулятор + конвертер валют за живим курсом НБУ.
 *
 * Обидва в одному віджеті свідомо: сценарій «порахував суму — перевів у
 * гривню» — це одна дія, і розривати її на дві плитки незручно.
 */
export function CalculatorWidget() {
  const [display, setDisplay] = useState("0");
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  /** Наступна цифра починає нове число, а не дописується до попереднього. */
  const [fresh, setFresh] = useState(true);
  const [mode, setMode] = useState<"calc" | "convert">("calc");

  const press = (key: string) => {
    if (key === "=") {
      if (op == null || acc == null) return;
      const res = compute(acc, op, Number(display));
      setDisplay(res == null ? "Помилка" : fmtResult(res));
      setAcc(null);
      setOp(null);
      setFresh(true);
      return;
    }

    if (["+", "−", "×", "÷"].includes(key)) {
      const current = Number(display.replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(current)) return;
      // Ланцюжок 2+3+4: перед новим оператором доганяємо попередній.
      if (op != null && acc != null && !fresh) {
        const res = compute(acc, op, current);
        if (res == null) {
          setDisplay("Помилка");
          setAcc(null);
          setOp(null);
          setFresh(true);
          return;
        }
        setAcc(res);
        setDisplay(fmtResult(res));
      } else {
        setAcc(current);
      }
      setOp(key);
      setFresh(true);
      return;
    }

    if (key === ".") {
      if (fresh) {
        setDisplay("0.");
        setFresh(false);
      } else if (!display.includes(".")) {
        setDisplay(display + ".");
      }
      return;
    }

    setDisplay(fresh || display === "0" || display === "Помилка" ? key : display + key);
    setFresh(false);
  };

  const clear = () => {
    setDisplay("0");
    setAcc(null);
    setOp(null);
    setFresh(true);
  };

  return (
    <WidgetBody
      title={mode === "calc" ? "Калькулятор" : "Конвертер валют"}
      hint={mode === "calc" ? "Швидкий рахунок" : "За курсом НБУ"}
    >
      <div className="flex h-full flex-col">
        <div className="mb-2 flex gap-1">
          {(["calc", "convert"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                mode === m ? "bg-bk text-white" : "bg-g100 text-g500 hover:text-bk"
              }`}
            >
              {m === "calc" ? "Рахунок" : "Валюта"}
            </button>
          ))}
        </div>

        {mode === "calc" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-g50 px-3 py-2">
              <button
                type="button"
                onClick={clear}
                className="text-[11px] font-semibold text-g400 transition-colors hover:text-bk"
              >
                C
              </button>
              <span className="truncate text-right text-[20px] font-bold tabular-nums text-bk">{display}</span>
            </div>
            <div className="grid flex-1 grid-cols-4 gap-1">
              {KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  className={`rounded-lg py-1.5 text-[13px] font-semibold transition-colors ${
                    ["÷", "×", "−", "+", "="].includes(k)
                      ? "bg-g100 text-bk hover:bg-g200"
                      : "bg-white text-bk hover:bg-g50"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Converter />
        )}
      </div>
    </WidgetBody>
  );
}

/** Конвертер: сума в одній валюті → у решті, за офіційним курсом НБУ. */
function Converter() {
  const { data, loading } = useApi<CurrencyResponse>("/api/admin/tools/currency");
  const [amount, setAmount] = useState("1000");
  const [from, setFrom] = useState("UAH");

  /** Курси до гривні. UAH додаємо вручну — НБУ себе не котирує. */
  const rates = useMemo(() => {
    const map: Record<string, number> = { UAH: 1 };
    for (const r of data?.rates ?? []) if (r.official != null) map[r.code] = r.official;
    return map;
  }, [data]);

  const codes = Object.keys(rates);

  // Якщо вибрана валюта зникла з відповіді (курс не прийшов), падаємо на
  // гривню прямо при рендері — вона в списку є завжди. Синхронізувати це
  // ефектом означало б зайвий прохід рендера заради того самого результату.
  const active = codes.includes(from) ? from : "UAH";

  const value = Number(amount.replace(/\s/g, "").replace(",", "."));
  const inUah = Number.isFinite(value) ? value * (rates[active] ?? 1) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="min-w-0 flex-1 rounded-lg border border-g200 px-2.5 py-1.5 text-[14px] font-semibold tabular-nums text-bk outline-none focus:border-g400"
        />
        <select
          value={active}
          onChange={(e) => setFrom(e.target.value)}
          className="flex-shrink-0 rounded-lg border border-g200 bg-white px-2 py-1.5 text-[13px] font-medium text-bk outline-none focus:border-g400"
        >
          {codes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <div className="h-8 animate-pulse rounded bg-g100" />
      ) : inUah == null ? (
        <p className="text-[12px] text-g400">Введіть число</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {codes
            .filter((c) => c !== active)
            .map((c) => (
              <div key={c} className="flex items-center justify-between gap-2 border-t border-g100 py-1.5">
                <span className="text-[12px] text-g500">
                  {FLAG[c] ?? "🇺🇦"} {c}
                </span>
                <span className="text-[14px] font-semibold tabular-nums text-bk">
                  {(inUah / (rates[c] ?? 1)).toLocaleString("uk-UA", { maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
