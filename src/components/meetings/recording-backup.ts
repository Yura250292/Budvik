/**
 * Страховка запису наради: кожен шматок одразу в IndexedDB браузера.
 *
 * Запис жив лише в пам'яті вкладки, і все, що вкладку перезавантажує, стирало
 * його без сліду: F5, повне завантаження Next після деплою, вихід з адмінки в
 * кабінет. 15.09.2026 так пропала справжня нарада — зупинена, але не
 * збережена. Тепер шматки (раз на 3 с) лягають сюди, а провайдер при
 * відкритті адмінки підхоплює те, що лишилось, як звичайний зупинений запис.
 *
 * Один запис на браузер. Хто ним володіє, вирішує Web Lock: вкладка, що пише
 * або тримає незбережений запис, тримає замок, і сусідня вкладка чужий запис
 * собі не забирає й не стирає. Перезавантаження замок відпускає — та сама
 * вкладка підхоплює запис одразу.
 *
 * Усе тут — лише страховка: браузер без IndexedDB (приватний режим, повне
 * сховище) пише як раніше, без копії, і жодна помилка звідси назовні не йде.
 */

const DB_NAME = "budvik-meeting-recording";
const SESSIONS = "sessions";
/** Ключ шматка — [id запису, номер]: getAll віддає їх по порядку. */
const CHUNKS = "chunks";
const LOCK = "budvik-meeting-recording";

export type BackupMeta = {
  id: string;
  startedAt: number;
  mimeType: string;
  /** Записано мс без пауз — на момент останнього шматка. */
  elapsedMs: number;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB недоступний"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(SESSIONS)) d.createObjectStore(SESSIONS, { keyPath: "id" });
      if (!d.objectStoreNames.contains(CHUNKS)) d.createObjectStore(CHUNKS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function quietly<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[meetings] страховка запису (${what}):`, e);
    return null;
  }
}

/**
 * Покоління страховки. Шматок читає свої байти асинхронно, і без цього
 * лічильника останній шматок викинутого запису дописувався б уже після
 * стирання — і наступного разу «воскресав» як незбережений.
 */
let generation = 0;

/** Новий запис: стерти попередній і завести новий. */
export function backupStart(meta: Pick<BackupMeta, "id" | "startedAt" | "mimeType">): Promise<unknown> {
  generation++;
  return quietly("початок", async () => {
    const d = await db();
    const tx = d.transaction([SESSIONS, CHUNKS], "readwrite");
    tx.objectStore(SESSIONS).clear();
    tx.objectStore(CHUNKS).clear();
    tx.objectStore(SESSIONS).put({ ...meta, elapsedMs: 0, updatedAt: Date.now() } satisfies BackupMeta);
    await committed(tx);
  });
}

export function backupChunk(meta: BackupMeta, seq: number, chunk: Blob): Promise<unknown> {
  const gen = generation;
  return quietly("шматок", async () => {
    // ArrayBuffer, а не Blob: Blob в IndexedDB старих Safari губився.
    const data = await chunk.arrayBuffer();
    if (gen !== generation) return;
    const d = await db();
    if (gen !== generation) return;
    const tx = d.transaction([SESSIONS, CHUNKS], "readwrite");
    tx.objectStore(CHUNKS).put(data, [meta.id, seq]);
    tx.objectStore(SESSIONS).put(meta);
    await committed(tx);
  });
}

/** Запис збережено на сервері або свідомо викинуто. */
export function backupClear(): Promise<unknown> {
  generation++;
  return quietly("стирання", async () => {
    const d = await db();
    const tx = d.transaction([SESSIONS, CHUNKS], "readwrite");
    tx.objectStore(SESSIONS).clear();
    tx.objectStore(CHUNKS).clear();
    await committed(tx);
  });
}

/** Те, що лишилось від попереднього запису, або null. */
export async function backupLoad(): Promise<{ meta: BackupMeta; blob: Blob } | null> {
  return quietly("читання", async () => {
    const d = await db();
    const tx = d.transaction([SESSIONS, CHUNKS], "readonly");
    const metas = tx.objectStore(SESSIONS).getAll();
    const keys = tx.objectStore(CHUNKS).getAllKeys();
    const values = tx.objectStore(CHUNKS).getAll();
    await committed(tx);

    const meta = (metas.result as BackupMeta[]).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!meta) return null;
    const parts: ArrayBuffer[] = [];
    keys.result.forEach((k, i) => {
      if (Array.isArray(k) && k[0] === meta.id) parts.push(values.result[i] as ArrayBuffer);
    });
    if (parts.length === 0) return null;
    return { meta, blob: new Blob(parts, { type: meta.mimeType }) };
  }).then((r) => r ?? null);
}

let releaseLock: (() => void) | null = null;

/**
 * Взяти запис на себе, якщо його не тримає інша вкладка. Замок лишається
 * до releaseRecording() або до закриття сторінки. Браузер без Web Locks —
 * вважаємо, що вкладка одна.
 */
export function claimRecording(): Promise<boolean> {
  if (releaseLock) return Promise.resolve(true);
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    locks
      .request(LOCK, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        return new Promise<void>((release) => {
          releaseLock = release;
          resolve(true);
        });
      })
      .catch(() => resolve(true));
  });
}

export function releaseRecording(): void {
  releaseLock?.();
  releaseLock = null;
}
