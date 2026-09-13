"use client";

/**
 * «Паливо»: авто, норми витрати і гроші на пальне — для торгових і водіїв.
 *
 * Кілометри беруться зі змін (одометр), тож паливо стоїть у «Логістиці» поруч
 * зі «Змінами», а не в аналітиці продажів, де жило до 13.09.2026.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodPicker, type Period } from "@/components/ui/PeriodPicker";
import { FuelTab } from "../components/FuelTab";
import { periodFromParams, replaceQuery } from "../components/url-state";

export function FuelPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => periodFromParams(params));

  useEffect(() => {
    replaceQuery(router, "/admin/logistics/fuel", { from: period.from, to: period.to });
  }, [period, router]);

  return (
    <div className="space-y-4">
      <PeriodPicker value={period} onChange={setPeriod} />
      <FuelTab period={period} />
    </div>
  );
}
