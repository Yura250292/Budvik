/**
 * Логування з добовою ротацією у файли. Служба Windows не має консолі, тож
 * журнал на диску — єдиний спосіб зрозуміти, що сталося вночі.
 *
 * Транспорти pino (pino-roll тощо) тут навмисно НЕ використовуються: вони
 * запускають воркер з окремого файлу в node_modules, якого немає в зібраному
 * бандлі. Замість цього пишемо синхронно у власний потік — для десятків
 * записів на цикл цього більш ніж достатньо.
 */

import fs from "node:fs";
import path from "node:path";
import pino, { type Logger } from "pino";

export type { Logger };

/** Скільки добових файлів журналу зберігати. */
const KEEP_DAYS = 14;

/** Потік, що сам перемикається на новий файл щодоби й прибирає старі. */
class DailyRotatingStream {
  private stream: fs.WriteStream | null = null;
  private currentDay = "";

  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  write(chunk: string): void {
    const day = new Date().toISOString().slice(0, 10);

    if (day !== this.currentDay) {
      this.stream?.end();
      this.currentDay = day;
      this.stream = fs.createWriteStream(path.join(this.dir, `agent-${day}.log`), { flags: "a" });
      this.prune();
    }

    this.stream?.write(chunk);
  }

  private prune(): void {
    try {
      const files = fs
        .readdirSync(this.dir)
        .filter((f) => /^agent-\d{4}-\d{2}-\d{2}\.log$/.test(f))
        .sort();

      for (const stale of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) {
        fs.unlinkSync(path.join(this.dir, stale));
      }
    } catch {
      // Прибирання журналів не має валити агент.
    }
  }
}

export function createLogger(logDir: string, level: string): Logger {
  const fileStream = new DailyRotatingStream(logDir);

  // Дублюємо в stdout: nssm перехоплює його, і це зручно при налагодженні.
  const destination = {
    write(chunk: string): void {
      fileStream.write(chunk);
      process.stdout.write(chunk);
    },
  };

  return pino(
    {
      level,
      // Секрети не мають потрапляти в журнал навіть випадково.
      redact: {
        paths: ["password", "agentSecret", "*.password", "*.agentSecret", "headers.authorization"],
        censor: "***",
      },
    },
    destination
  );
}
