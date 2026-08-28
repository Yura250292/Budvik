/**
 * Відмітки візитів, які чекають на мережу — веб-версія.
 *
 * Дзеркало `mobile/src/track/pending-visits.ts`: правила поведінки мусять бути
 * однакові, бо це той самий екран дня, просто відкритий у браузері замість
 * застосунку. Спільного коду між ними немає — сайт і застосунок різні збірки —
 * тож логіку продубльовано свідомо, а розбіжність ловить
 * `mobile/scripts/check-visit-queue.ts`.
 *
 * Навіщо це на вебі, якщо є нативний екран. Поки люди не перейшли на нову
 * збірку, «Мій день» вони відкривають саме в браузері. Там відмітка без
 * зв'язку просто падала червоною смугою: водій стояв біля магазину, тиснув
 * «Виконано», бачив помилку і їхав далі — точка лишалася невідміченою, а
 * ввечері день не сходився ні за адресами, ні за грошима.
 */

const KEY = "budvik.visits.pending.v1";

export type PendingVisit = {
  /** Ключ точки (rs:/ds:) — щоб екран знав, яку саме показати виконаною. */
  stopKey: string;
  kind: "visit" | "errand";
  /** Куди слати й що саме — готове тіло запиту. */
  url: string;
  body: unknown;
  /** Що показати в списку, поки не надіслано. */
  label: string;
  createdAt: number;
};

function read(): PendingVisit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingVisit[]) : [];
  } catch {
    return [];
  }
}

function write(list: PendingVisit[]): void {
  if (typeof window === "undefined") return;
  try {
    if (list.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Сховище переповнене або заблоковане — черга не критична настільки,
    // щоб через неї падав екран.
  }
}

export function listPendingVisits(): PendingVisit[] {
  return read();
}

/**
 * Кладе відмітку в чергу.
 *
 * Повторна відмітка тієї самої точки ЗАМІНЮЄ попередню, а не додається: водій
 * міг спершу тицьнути «Не застав», а потім виправитися на «Виконано». Сервер
 * робить upsert по (користувач, день, клієнт), тож черга мусить тримати рівно
 * останній намір — інакше правильна відмітка поїхала б першою, а помилкова
 * затерла б її слідом.
 */
export function queueVisit(entry: PendingVisit): void {
  write([...read().filter((v) => v.stopKey !== entry.stopKey), entry]);
}

/** Скільки відміток чекає. Для лічильника на екрані. */
export function pendingCount(): number {
  return read().length;
}

/**
 * Пробує віддати чергу. Повертає, скільки лишилося.
 *
 * 4xx (крім 429) означає, що сервер цього не прийме ніколи — клієнта видалили,
 * маршрут переписали. Тримати таку відмітку означало б вічну чергу, яка блокує
 * решту.
 */
export async function flushPendingVisits(): Promise<number> {
  const list = read();
  if (list.length === 0) return 0;

  const left: PendingVisit[] = [];
  for (const entry of list) {
    try {
      const res = await fetch(entry.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.body),
      });
      if (res.ok) continue;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) continue;
      left.push(entry);
    } catch {
      // Немає мережі — лишаємо на потім.
      left.push(entry);
    }
  }
  write(left);
  return left.length;
}
