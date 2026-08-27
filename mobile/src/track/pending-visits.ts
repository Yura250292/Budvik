/**
 * Відмітки візитів, які чекають на мережу.
 *
 * Це і є головна причина, заради якої екран дня переїхав із WebView у натив.
 * У браузері відмітка без зв'язку просто падала з помилкою: водій стояв біля
 * магазину, тикав «Виконано», бачив «Не вдалося зберегти» — і їхав далі, а
 * точка лишалася невідміченою. Увечері день не сходився ні за грошима, ні за
 * кількістю адрес.
 *
 * Тепер відмітка лягає сюди й показується як виконана одразу. Черга розсмокчеться
 * сама — її ганяє і сторож (кожні 15 хв), і кожне відкриття екрана дня.
 */

import { staffApi, StaffApiError, type VisitInput } from "@/api/staff";
import { getMeta, setMeta } from "./db";

const KEY = "pendingVisits";

export type PendingVisit = {
  /** Ключ точки (rs:/ds:) — щоб екран знав, яку саме позначити виконаною. */
  stopKey: string;
  kind: "visit" | "errand";
  /** Для бонусної поїздки — id зупинки; для звичайного візиту не потрібен. */
  errandStopId?: string;
  errandStatus?: "DELIVERED" | "FAILED";
  visit?: VisitInput;
  comment?: string;
  createdAt: number;
};

export async function listPendingVisits(): Promise<PendingVisit[]> {
  const raw = await getMeta(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingVisit[]) : [];
  } catch {
    return [];
  }
}

/**
 * Кладе відмітку в чергу.
 *
 * Повторна відмітка тієї самої точки замінює попередню, а не додається: водій
 * міг спершу тицьнути «Не застав», а потім виправитися на «Виконано». Сервер
 * робить upsert по (користувач, день, клієнт), тож і черга має тримати рівно
 * останній намір — інакше правильна відмітка поїхала б першою, а помилкова
 * затерла б її слідом.
 */
export async function queueVisit(entry: PendingVisit): Promise<void> {
  const list = await listPendingVisits();
  const next = list.filter((v) => v.stopKey !== entry.stopKey);
  next.push(entry);
  await setMeta(KEY, JSON.stringify(next));
}

export async function flushPendingVisits(): Promise<number> {
  const list = await listPendingVisits();
  if (list.length === 0) return 0;

  const left: PendingVisit[] = [];
  for (const entry of list) {
    try {
      if (entry.kind === "errand" && entry.errandStopId) {
        await staffApi.markErrand(entry.errandStopId, {
          status: entry.errandStatus ?? "DELIVERED",
          comment: entry.comment,
        });
      } else if (entry.visit) {
        await staffApi.markVisit(entry.visit);
      }
    } catch (e) {
      const status = e instanceof StaffApiError ? e.status : 0;
      /**
       * 4xx (крім 429) — сервер не прийме цього ніколи: клієнта видалили,
       * маршрут переписали. Тримати таку відмітку означало б вічну чергу, яка
       * блокує решту.
       */
      if (status >= 400 && status < 500 && status !== 429) continue;
      left.push(entry);
    }
  }

  await setMeta(KEY, left.length ? JSON.stringify(left) : null);
  return left.length;
}
