"use client";

/**
 * «Зміни»: пробіг торгових за одометром і робочі дні водіїв.
 *
 * Дві половини окремими видами, а не однією таблицею: у торгового рядок — це
 * зміна з фото одометра, у водія — доба з треком і маршрутним листом. Водій
 * зміну не відкриває взагалі (трек пише застосунок від входу), тож змішувати
 * їх в одних колонках означало б половину клітинок лишити порожніми.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodPicker, type Period } from "@/components/ui/PeriodPicker";
import { ShiftsTab } from "../components/ShiftsTab";
import { DriverDaysTab } from "../components/DriverDaysTab";
import { periodFromParams, replaceQuery } from "../components/url-state";

type Who = "reps" | "drivers";

const WHO: Array<{ key: Who; label: string }> = [
  { key: "reps", label: "Торгові" },
  { key: "drivers", label: "Водії" },
];

export function ShiftsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => periodFromParams(params));
  const [who, setWho] = useState<Who>(() => (params.get("who") === "drivers" ? "drivers" : "reps"));

  useEffect(() => {
    replaceQuery(router, "/admin/logistics/shifts", {
      from: period.from,
      to: period.to,
      who: who === "drivers" ? "drivers" : null,
    });
  }, [period, who, router]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Чиї зміни показати"
          className="flex rounded-[var(--radius-btn)] border border-g200 bg-white p-0.5"
        >
          {WHO.map((w) => (
            <button
              key={w.key}
              type="button"
              aria-pressed={who === w.key}
              onClick={() => setWho(w.key)}
              className={`min-h-[34px] cursor-pointer rounded-[calc(var(--radius-btn)-2px)] px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark ${
                who === w.key ? "bg-bk text-white" : "text-g600 hover:bg-g100 hover:text-bk"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {who === "reps" ? (
        <ShiftsTab period={period} onPeriodChange={setPeriod} />
      ) : (
        <DriverDaysTab period={period} onPeriodChange={setPeriod} />
      )}
    </div>
  );
}
