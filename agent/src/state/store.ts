/**
 * Локальний стан агента (SQLite).
 *
 * Головне призначення — hash-diff: 1С не дає надійного «що змінилося з
 * моменту X», тому агент щоразу читає зрізи повністю, але надсилає лише ті
 * записи, чий хеш відрізняється від збереженого. Типовий цикл — десятки
 * записів замість тисяч.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

export class StateStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    // WAL: служба може бути вбита в будь-який момент, журнал переживе це.
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entity_hash (
        entity_type TEXT NOT NULL,
        ref_key     TEXT NOT NULL,
        hash        TEXT NOT NULL,
        sent_at     TEXT NOT NULL,
        PRIMARY KEY (entity_type, ref_key)
      );

      CREATE TABLE IF NOT EXISTS watermark (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /**
   * Канонічний хеш запису: ключі сортуються, undefined відкидається — щоб
   * порядок полів у відповіді 1С не давав хибних «змін».
   */
  static hash(record: unknown): string {
    return crypto.createHash("sha1").update(canonicalJson(record)).digest("hex");
  }

  /** Відбирає записи, що змінилися з минулого разу. */
  filterChanged<T extends { externalId: string }>(
    entityType: string,
    records: T[]
  ): T[] {
    const select = this.db.prepare<[string, string], { hash: string }>(
      "SELECT hash FROM entity_hash WHERE entity_type = ? AND ref_key = ?"
    );

    return records.filter((rec) => {
      const current = StateStore.hash(rec);
      const stored = select.get(entityType, rec.externalId);
      return stored?.hash !== current;
    });
  }

  /**
   * Фіксує успішно доставлені записи.
   *
   * Викликається ЛИШЕ після підтвердження від сервера: якщо зафіксувати
   * раніше, обрив зв'язку призведе до того, що зміна не доїде ніколи —
   * наступний цикл вважатиме її вже надісланою.
   */
  markSent<T extends { externalId: string }>(entityType: string, records: T[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO entity_hash (entity_type, ref_key, hash, sent_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(entity_type, ref_key) DO UPDATE SET hash = excluded.hash, sent_at = excluded.sent_at`
    );

    const now = new Date().toISOString();
    const tx = this.db.transaction((rows: T[]) => {
      for (const rec of rows) {
        upsert.run(entityType, rec.externalId, StateStore.hash(rec), now);
      }
    });

    tx(records);
  }

  /** Скидає хеші типу — наступний цикл надішле все заново (повна звірка). */
  resetHashes(entityType?: string): void {
    if (entityType) {
      this.db.prepare("DELETE FROM entity_hash WHERE entity_type = ?").run(entityType);
    } else {
      this.db.prepare("DELETE FROM entity_hash").run();
    }
  }

  getWatermark(key: string): string | null {
    const row = this.db
      .prepare<[string], { value: string }>("SELECT value FROM watermark WHERE key = ?")
      .get(key);
    return row?.value ?? null;
  }

  setWatermark(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO watermark (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}

/** Стабільна серіалізація: сортовані ключі, без undefined. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);

  return `{${entries.join(",")}}`;
}
