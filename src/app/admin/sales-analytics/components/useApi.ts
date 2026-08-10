"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Завантаження JSON з відміною застарілих відповідей.
 *
 * AbortController тут не косметика: при швидкому перемиканні періодів
 * відповідь на старий запит могла прийти пізніше за новий і перезаписати
 * свіжі дані старими.
 */
export function useApi<T>(url: string | null): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
        return json as T;
      })
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Не вдалося завантажити дані");
        setLoading(false);
      });

    return () => controller.abort();
  }, [url, nonce]);

  return { data, loading, error, reload };
}
