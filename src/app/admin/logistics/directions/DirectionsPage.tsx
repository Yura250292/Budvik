"use client";

/**
 * «Напрямки торгових»: шаблони напрямків, постійний розклад, мапа дня й зони.
 *
 * Жили підвкладкою «Маршрути» в аналітиці продажів. Назва змінилася, бо поруч
 * у розділі тепер «Доставка» — маршрути водіїв, — і два «Маршрути» в одній
 * смужці читалися б як одне.
 *
 * ?rep=&date= — фокус мапи дня: з архіву поїздок сюди ведуть кліком «поза
 * маршрутом». Читається один раз і з адреси зникає, інакше перезавантаження
 * знову перескакувало б на давно переглянутий день.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodPicker, type Period } from "@/components/ui/PeriodPicker";
import { RoutesTab } from "../components/RoutesTab";
import { periodFromParams, replaceQuery } from "../components/url-state";

export function DirectionsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => periodFromParams(params));
  const [focus] = useState(() => {
    const repId = params.get("rep");
    const date = params.get("date");
    return repId && date ? { repId, date } : null;
  });

  useEffect(() => {
    replaceQuery(router, "/admin/logistics/directions", {
      from: period.from,
      to: period.to,
      rep: null,
      date: null,
    });
  }, [period, router]);

  return (
    <div className="space-y-4">
      {/* Період задає діапазон разових призначень, які потрапляють на карту. */}
      <PeriodPicker value={period} onChange={setPeriod} />
      <RoutesTab period={period} focus={focus} />
    </div>
  );
}
