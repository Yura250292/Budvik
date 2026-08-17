"use client";

import { useCallback } from "react";
import useSWR from "swr";

/**
 * Завантаження JSON — тонка обгортка над SWR зі старою сигнатурою.
 *
 * Раніше тут був сирий fetch в useEffect: кожен маунт компонента — новий
 * запит, два віджети з одним URL — два запити, повернення на вкладку —
 * все з нуля. SWR дає дедуплікацію, кеш поза деревом React (переживає
 * розмонтування вкладок TabsViewport) і keepPreviousData при зміні URL.
 *
 * Захист від гонки застарілих відповідей зберігається: SWR зіставляє
 * відповідь із ключем, тож стара відповідь не перезапише новий URL.
 *
 * Налаштування задані тут, а не успадковані з провайдера, бо useApi
 * живе і поза AdminSwrProvider (кабінети sales/driver) — поведінка має
 * бути однакова всюди.
 */

async function fetchJson(url: string) {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
  return json;
}

export function useApi<T>(url: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const { data, error, isLoading, mutate } = useSWR<T>(url, fetchJson, {
    dedupingInterval: 30_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  const reload = useCallback(() => {
    void mutate();
  }, [mutate]);

  return {
    data: data ?? null,
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : "Не вдалося завантажити дані") : null,
    reload,
  };
}
