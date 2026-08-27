/**
 * Буфер точок маршруту на пристрої.
 *
 * SQLite, а не AsyncStorage: буфер росте до тисяч рядків, і читання-запис
 * усього масиву JSON на кожну точку — це і зайва робота, і ризик утратити
 * увесь день на одному обірваному записі. Тут же кожна точка — окремий рядок,
 * а `recordedAt` — первинний ключ, тож повторна вставка тієї самої точки не
 * створює дубля навіть після перезапуску служби.
 *
 * Навіщо буфер узагалі: у селі зв'язку немає годинами. Kotlin-служба тримала
 * до 6000 точок (понад тридцять годин руху), і ця стеля переїжджає сюди без
 * змін — вона обрана не з голови, а після дня, з якого зник трек.
 */

import * as SQLite from "expo-sqlite";

/** Стеля буфера. Далі найстаріші точки витісняються — день у русі важливіший. */
const BUFFER_CAP = 6000;

export type BufferedPoint = {
  recordedAt: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  phase: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("budvik-track.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS points (
          recordedAt TEXT PRIMARY KEY NOT NULL,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          accuracyM INTEGER,
          speedKmh INTEGER,
          headingDeg INTEGER,
          phase TEXT
        );
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

/**
 * Кладе точку в буфер.
 *
 * INSERT OR IGNORE, а не REPLACE: якщо точка з такою міткою часу вже є, вона
 * достовірніша за нову — перезапис означав би, що ретрай із перештампованим
 * часом затирає оригінал (сервер саме такі дублі й відсіює).
 */
export async function addPoint(p: BufferedPoint): Promise<void> {
  const db = await open();
  await db.runAsync(
    `INSERT OR IGNORE INTO points (recordedAt, lat, lng, accuracyM, speedKmh, headingDeg, phase)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    p.recordedAt,
    p.lat,
    p.lng,
    p.accuracyM,
    p.speedKmh,
    p.headingDeg,
    p.phase
  );

  const { n } = (await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM points")) ?? { n: 0 };
  if (n > BUFFER_CAP) {
    await db.runAsync(
      `DELETE FROM points WHERE recordedAt IN (
         SELECT recordedAt FROM points ORDER BY recordedAt ASC LIMIT ?
       )`,
      n - BUFFER_CAP
    );
  }
}

/** Найстаріші точки — саме в тому порядку, в якому їх чекає сервер. */
export async function oldestPoints(limit: number): Promise<BufferedPoint[]> {
  const db = await open();
  return db.getAllAsync<BufferedPoint>(
    "SELECT * FROM points ORDER BY recordedAt ASC LIMIT ?",
    limit
  );
}

/**
 * Викидає рівно ті точки, які сервер підтвердив.
 *
 * Саме підтверджені, а не «перші N»: під час відправки трек пишеться далі, і
 * зріз за кількістю зніс би свіжі точки, яких сервер ще не бачив. На цьому вже
 * колись загубили день маршруту.
 */
export async function dropPoints(points: BufferedPoint[]): Promise<void> {
  if (points.length === 0) return;
  const db = await open();
  const marks = points.map(() => "?").join(",");
  await db.runAsync(
    `DELETE FROM points WHERE recordedAt IN (${marks})`,
    ...points.map((p) => p.recordedAt)
  );
}

export async function bufferedCount(): Promise<number> {
  const db = await open();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM points");
  return row?.n ?? 0;
}

/** Скидання буфера — на виході з акаунта: чужий трек не має поїхати під новим токеном. */
export async function clearPoints(): Promise<void> {
  const db = await open();
  await db.runAsync("DELETE FROM points");
}

/* ---------- meta: дрібний стан, який мусить пережити перезапуск процесу ---------- */

export async function getMeta(key: string): Promise<string | null> {
  const db = await open();
  const row = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM meta WHERE key = ?",
    key
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string | null): Promise<void> {
  const db = await open();
  await db.runAsync(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value
  );
}
