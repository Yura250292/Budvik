"use client";

/**
 * Скільки непрочитаного — для бейджа в шапці й крапки на вкладці.
 *
 * Хвилина, а не секунди: бейдж — це «щось є», а не годинник. Розмову, яка
 * відкрита, оновлює свій запит, і платити за нього двічі нема сенсу.
 * Помилка мережі дає нуль: червоний бейдж, що завис через обрив, гірший за
 * його відсутність.
 */

import useSWR from "swr";
import { fetcher } from "./api";

export const UNREAD_URL = "/api/chat/unread";

export function useChatUnread(): number {
  const { data } = useSWR<{ total: number }>(UNREAD_URL, fetcher, {
    refreshInterval: 60_000,
    dedupingInterval: 30_000,
    revalidateOnFocus: true,
  });
  return data?.total ?? 0;
}
