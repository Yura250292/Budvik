"use client";

/**
 * «Архів поїздок»: поїздки Telegram-бота.
 *
 * Бот зупинено 14.08.2026 — нових записів тут не буде. Сторінку не видалено:
 * за нею розбирали пробіг і відхилення від напрямків за весь період до
 * застосунку, і ці числа досі згадують. Тому архів — останній у розділі і з
 * прямою підказкою, де тепер живі дані.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodPicker, type Period } from "@/components/ui/PeriodPicker";
import { TripsTab } from "../components/TripsTab";
import { periodFromParams, replaceQuery } from "../components/url-state";

export function TripsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => periodFromParams(params));
  const [rep, setRep] = useState(() => params.get("rep") ?? "");

  useEffect(() => {
    replaceQuery(router, "/admin/logistics/trips", {
      from: period.from,
      to: period.to,
      rep: rep || null,
    });
  }, [period, rep, router]);

  // «Поза маршрутом» → мапа дня в «Напрямках торгових» на тому самому
  // торговому й дні. push, а не replace: звідти природно повернутися «Назад».
  const showDay = useCallback(
    (repId: string, date: string) => {
      const q = new URLSearchParams({ rep: repId, date, from: period.from, to: period.to });
      router.push(`/admin/logistics/directions?${q.toString()}`);
    },
    [period, router]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
        <b>Архів.</b> Поїздки з Telegram-бота — його зупинено 14.08.2026, нових записів тут не буде.
        Де хто зараз — у{" "}
        <Link href="/admin/logistics/live" className="font-semibold underline underline-offset-2 hover:text-bk">
          «Рух на карті»
        </Link>
        , пробіг торгових і дні водіїв — у{" "}
        <Link
          href={`/admin/logistics/shifts?from=${period.from}&to=${period.to}`}
          className="font-semibold underline underline-offset-2 hover:text-bk"
        >
          «Змінах»
        </Link>
        .
      </div>
      <PeriodPicker value={period} onChange={setPeriod} />
      <TripsTab period={period} rep={rep} onRepChange={setRep} onShowDay={showDay} />
    </div>
  );
}
