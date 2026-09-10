/**
 * Здоров'я шару треку — каналом, який не залежить від шару треку.
 *
 * ЧОМУ ЦЕ ПОТРІБНО. Весь наш зв'язок із планшетом іде через пульс, а пульс
 * (`uploader.heartbeat`) починається з тринадцяти читань із SQLite одним
 * `Promise.all`. Журнал подій — теж SQLite. Буфер точок — теж. Якщо база треку
 * не відкривається, падає ВСЕ це одночасно, а кожен виклик обгорнутий у
 * `.catch(() => {})` — і назовні виходить бездоганна тиша.
 *
 * 10.09.2026 саме так і сталося: три планшети мали застосунок відкритим у межах
 * сорока хвилин (це видно з відмітки `app:staff:installed`, яку пише сам
 * застосунок авторизованим запитом), а шар треку не сказав нічого — ні пульсу,
 * ні журналу, ні точок, ні буфера. І з сервера це не відрізнити від планшета,
 * який просто лежить вимкнений у шухляді.
 *
 * Тобто наш єдиний канал діагностики помирає РАЗОМ із тим, що він мав
 * діагностувати. Ця проба існує, щоб розірвати цю залежність: вона їде разом із
 * перевіркою версії — запитом, який на тих самих планшетах демонстративно
 * працює, — і кожен її крок загороджений окремо. Впала база — прийде текст
 * помилки. Впало все — прийде хоча б рядок про те, що впало.
 *
 * ПРАВИЛО ЦЬОГО ФАЙЛА: звідси не можна кинути виняток і не можна зависнути.
 * Проба, яка ламає перевірку оновлень, забирає з планшета останній живий канал.
 */

import { getMeta, bufferedCount } from "./db";
import { within } from "@/lib/within";

/** Скільки чекаємо кожен крок. Проба локальна: секунда — вже дуже щедро. */
const STEP_MS = 1_500;

export type TrackProbe = {
  /** "ok" або текст помилки бази — головне поле всієї проби. */
  db: string;
  /** Режим запису за даними планшета: SHIFT | AFTER_SHIFT | null. */
  mode: string | null;
  /** Скільки хвилин тому був останній фікс GPS. null — жодного. */
  fixAgo: number | null;
  /** Скільки точок чекає відправки. */
  buffered: number | null;
};

/**
 * Найдешевша операція, яка доводить, що база жива: читання одного рядка.
 *
 * Саме читання, а не запис: якщо диск переповнений або база стала «тільки для
 * читання», запис упаде, а читання ні — і ми дізнаємося більше, ніж від
 * загального «не працює».
 */
async function probeDb(): Promise<string> {
  try {
    const value = await Promise.race([
      getMeta("lastFixAt"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("база не відповіла за 1,5 с")), STEP_MS)
      ),
    ]);
    // Порожньо — теж «ok»: означає лише, що фіксів ще не було.
    return value === undefined ? "порожня відповідь" : "ok";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Обрізаємо: рядок їде в адресі запиту, а нам потрібна суть, не стек.
    return message.slice(0, 120) || "невідома помилка бази";
  }
}

export async function probeTrackLayer(): Promise<TrackProbe> {
  const db = await probeDb();

  // База мертва — решту навіть не пробуємо: усі вони ходять у неї ж.
  if (db !== "ok") return { db, mode: null, fixAgo: null, buffered: null };

  const [mode, fixAtRaw, buffered] = await Promise.all([
    within(getMeta("mode"), STEP_MS, null),
    within(getMeta("lastFixAt"), STEP_MS, null),
    within(bufferedCount(), STEP_MS, null),
  ]);

  const fixAt = Number(fixAtRaw) || 0;
  return {
    db,
    mode: mode ?? null,
    fixAgo: fixAt > 0 ? Math.round((Date.now() - fixAt) / 60_000) : null,
    buffered,
  };
}

/**
 * Проба в рядок для адреси запиту.
 *
 * Компактно навмисно: вона їде параметром GET, а не тілом, бо чіпляється до
 * перевірки версії — єдиного запиту, який на зламаному планшеті ще проходить.
 * Формат «ключ:значення через кому» читається очима в логах сервера без
 * розбору JSON.
 */
export async function trackProbeParam(): Promise<string> {
  try {
    const p = await probeTrackLayer();
    const parts = [`db=${p.db}`];
    if (p.mode) parts.push(`mode=${p.mode}`);
    if (p.fixAgo != null) parts.push(`fix=${p.fixAgo}хв`);
    if (p.buffered != null) parts.push(`buf=${p.buffered}`);
    return parts.join(",").slice(0, 200);
  } catch (e) {
    // Навіть тут: проба, яка сама впала, мусить сказати про це, а не зникнути.
    return `db=проба впала: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`;
  }
}
