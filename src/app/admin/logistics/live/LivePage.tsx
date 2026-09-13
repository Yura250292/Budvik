"use client";

/**
 * «Рух на карті»: де зараз торгові й водії, і трек будь-якої людини за будь-який день.
 *
 * Карта жила вкладкою «На маршруті» в «Аналітиці водіїв» і вже тоді показувала
 * обидві ролі — просто знайти її там ніхто не здогадувався: розділ був про
 * зарплату. Тепер це перша сторінка «Логістики».
 *
 * День, обрана людина й фільтр ролі дзеркаляться в адресу (?day=&person=&role=):
 * «Зміни → Водії» ведуть сюди на конкретну добу конкретного водія.
 */

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { kyivToday } from "@/components/ui/PeriodPicker";
import { LiveTrackTab, type LiveState, type RoleFilter } from "../components/live/LiveTrackTab";
import { replaceQuery } from "../components/url-state";

function roleFrom(value: string | null): RoleFilter {
  return value === "reps" || value === "drivers" ? value : "all";
}

export function LivePage() {
  const router = useRouter();
  const params = useSearchParams();

  // Адресу читаємо один раз: далі станом володіє карта, інакше кожен replace
  // смикав би її й перезапускав опитування.
  const [initial] = useState(() => ({
    day: params.get("day"),
    person: params.get("person"),
    role: roleFrom(params.get("role")),
  }));

  const onStateChange = useCallback(
    (state: LiveState) => {
      replaceQuery(router, "/admin/logistics/live", {
        // Сьогоднішній день в адресі не пишемо: закладка «рух на карті» має
        // завтра відкривати завтрашній день, а не застиглу дату.
        day: state.day === kyivToday() ? null : state.day,
        person: state.selected,
        role: state.role === "all" ? null : state.role,
      });
    },
    [router]
  );

  return (
    <LiveTrackTab
      initialDay={initial.day}
      initialPerson={initial.person}
      initialRole={initial.role}
      onStateChange={onStateChange}
    />
  );
}
