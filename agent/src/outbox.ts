/**
 * Черга вихідних батчів на диску.
 *
 * Батч спершу лягає у файл і лише потім надсилається. Якщо інтернет зник,
 * файли накопичуються й доїжджають наступного циклу — дані не губляться,
 * а сама 1С не перечитується повторно.
 *
 * Ім'я файлу задає порядок доставки: {timestamp}-{seq}-{batchId}.json.
 */

import fs from "node:fs";
import path from "node:path";
import type { BatchRequest } from "@contract";

/** Батчі, старші за цей вік, вважаються безнадійними й видаляються. */
const MAX_AGE_DAYS = 7;

export interface OutboxEntry {
  file: string;
  batch: BatchRequest;
}

export class Outbox {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Кладе батч у чергу. Повертає шлях до файлу. */
  enqueue(batch: BatchRequest, timestampMs: number): string {
    const seq = String(batch.seq).padStart(5, "0");
    const file = path.join(this.dir, `${timestampMs}-${seq}-${batch.batchId}.json`);
    // Пишемо у тимчасовий файл і перейменовуємо: перейменування атомарне,
    // тож напівзаписаний батч ніколи не потрапить у чергу.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(batch), "utf8");
    fs.renameSync(tmp, file);
    return file;
  }

  /** Усі батчі в черзі, у порядку створення. */
  list(): OutboxEntry[] {
    const files = fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    const entries: OutboxEntry[] = [];

    for (const name of files) {
      const file = path.join(this.dir, name);
      try {
        entries.push({ file, batch: JSON.parse(fs.readFileSync(file, "utf8")) as BatchRequest });
      } catch {
        // Пошкоджений файл (наприклад, диск заповнився під час запису)
        // не має блокувати всю чергу.
        fs.renameSync(file, `${file}.corrupt`);
      }
    }

    return entries;
  }

  remove(file: string): void {
    try {
      fs.unlinkSync(file);
    } catch {
      // Файл уже видалений — не проблема.
    }
  }

  size(): number {
    return fs.readdirSync(this.dir).filter((f) => f.endsWith(".json")).length;
  }

  /** Прибирає застряглі батчі. Повертає кількість видалених. */
  pruneStale(): number {
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const name of fs.readdirSync(this.dir)) {
      const file = path.join(this.dir, name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) {
          fs.unlinkSync(file);
          removed++;
        }
      } catch {
        // ігноруємо
      }
    }

    return removed;
  }
}
