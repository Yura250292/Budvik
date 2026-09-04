/**
 * Серверні дані робочих екранів — через кеш запитів.
 *
 * Раніше кожен робочий екран тримав власні useState і перечитував усе наново
 * на КОЖЕН фокус. Повернення з екрана одометра — а це найчастіший перехід за
 * день — щоразу означало вертушку на пів секунди замість уже відомої картинки.
 *
 * Кешуємо ЛИШЕ те, що приходить із сервера. Живі локальні сигнали — чи пишеться
 * трек, скільки точок у буфері, які дозволи, що з батареєю — читаються з
 * пристрою на кожен фокус, як і раніше: показати «трек пишеться» зі старого
 * кешу означало б збрехати саме там, де ціна брехні найбільша.
 *
 * На диск нічого з цього не лягає: постійне сховище в src/app/_layout.tsx
 * зберігає лише перелічені там покупецькі ключі, а робочі починаються з
 * `staff-`. Так робочі дані не опиняються у відкритому файлі AsyncStorage.
 */

import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  staffApi,
  type DayResponse,
  type ShiftDetail,
  type ShiftHistory,
  type ShiftState,
} from "./staff";
import { setShiftOpen } from "@/track/state";
import { flushPendingVisits } from "@/track/pending-visits";
import { within, PROBE_MS } from "@/lib/within";

/** Скільки чекаємо на віддачу черги, перш ніж малювати день без неї. */
const FLUSH_MS = 8_000;

/**
 * Наскільки свіжі дані фокус уже не перепитує.
 *
 * Повернення з одометра чи з картки зміни трапляється за секунди — питати
 * сервер удруге за той самий стан немає сенсу.
 */
const FOCUS_MIN_AGE_MS = 5_000;

type Refetchable = {
  refetch: () => unknown;
  dataUpdatedAt: number;
  isFetching: boolean;
};

/**
 * Перепитати сервер, якщо відповідь уже не свіжа.
 *
 * Окремою функцією, а не лише хуком: екран дня мусить дочекатися відповіді,
 * перш ніж перечитувати чергу з пристрою.
 */
export async function refetchIfStale(query: Refetchable): Promise<void> {
  if (query.isFetching) return;
  if (query.dataUpdatedAt && Date.now() - query.dataUpdatedAt < FOCUS_MIN_AGE_MS) return;
  await query.refetch();
}

/**
 * Оновлення при поверненні на екран.
 *
 * Робочі дані живі: зміну міг закрити офіс, маршрут — переставити логіст. Тому
 * фокус завжди йде на сервер, і лише щойно прочитане пропускає оберт.
 *
 * Стан запиту тримаємо в ref і оновлюємо його вже після рендера: інакше
 * ефект фокуса довелося б перевішувати на кожну зміну запиту, а це той самий
 * запит по колу.
 */
export function useRefetchOnFocus(query: Refetchable): void {
  const ref = useRef(query);
  useEffect(() => {
    ref.current = query;
  });

  useFocusEffect(
    useCallback(() => {
      void refetchIfStale(ref.current);
    }, [])
  );
}

export const staffKeys = {
  shiftCurrent: ["staff-shift-current"] as const,
  shiftHistory: ["staff-shift-history"] as const,
  shiftDetail: (id: string) => ["staff-shift-detail", id] as const,
  day: ["staff-day"] as const,
};

/**
 * Поточна зміна.
 *
 * Побічний ефект тут не випадковий: локальний прапорець у SQLite читає фонова
 * служба в новому процесі, де памʼяті вже немає, і оновлювати його треба саме
 * тоді, коли сервер сказав правду про зміну.
 */
export function useShiftCurrent() {
  return useQuery({
    queryKey: staffKeys.shiftCurrent,
    queryFn: async (): Promise<ShiftState> => {
      const s = await staffApi.shiftCurrent();
      // З межею очікування: застрягла база не має тримати екран маршруту.
      await within(setShiftOpen(!!s.shift), PROBE_MS, undefined);
      return s;
    },
    staleTime: 15_000,
  });
}

/**
 * День водія.
 *
 * Чергу віддаємо ПЕРЕД запитом: інакше сервер поверне день без відміток, які
 * водій уже зробив, і вони «зникнуть» з екрана.
 */
/**
 * День водія. Порожні аргументи — сьогодні.
 *
 * Ключ кеша включає лист: відкривши вчорашній і повернувшись до
 * сьогоднішнього, водій інакше побачив би вчорашні точки з кеша.
 */
export function useDay(opts?: { day?: string; route?: string }) {
  const scope = opts?.route ?? opts?.day ?? "today";
  return useQuery({
    queryKey: [...staffKeys.day, scope],
    queryFn: async (): Promise<DayResponse> => {
      await within(flushPendingVisits(), FLUSH_MS, 0);
      return staffApi.day(opts);
    },
    staleTime: 15_000,
  });
}

export function useShiftHistory() {
  return useQuery({
    queryKey: staffKeys.shiftHistory,
    queryFn: (): Promise<ShiftHistory> => staffApi.shiftHistory(),
    staleTime: 60_000,
  });
}

/** Закрита зміна вже не змінюється — тримаємо довше. */
export function useShiftDetail(id: string | undefined) {
  return useQuery({
    queryKey: staffKeys.shiftDetail(id ?? ""),
    queryFn: (): Promise<ShiftDetail> => staffApi.shiftDetail(id as string),
    enabled: !!id,
    staleTime: 300_000,
  });
}
