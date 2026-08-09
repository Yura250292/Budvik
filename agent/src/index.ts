/**
 * Точка входу агента синхронізації 1С → Budvik.
 *
 * Режими запуску:
 *   node agent.mjs                    — служба: цикл за розкладом + нічна звірка
 *   node agent.mjs --once             — один інкрементальний цикл і вихід
 *   node agent.mjs --once --full      — одна повна звірка і вихід
 *   node agent.mjs --once --preview   — сухий прогін: нічого не змінює на сайті
 *   node agent.mjs --config path.json — інший файл конфігурації
 */

import path from "node:path";
import cron from "node-cron";
import type { SyncRunKind } from "@contract";
import { loadConfig } from "./config.js";
import { createLogger, type Logger } from "./log.js";
import { StateStore } from "./state/store.js";
import { Outbox } from "./outbox.js";
import { IngestClient } from "./push.js";
import { SyncCycle } from "./sync-cycle.js";

interface Args {
  configPath: string;
  once: boolean;
  full: boolean;
  preview: boolean;
}

function parseArgs(argv: string[]): Args {
  const configIndex = argv.indexOf("--config");

  return {
    configPath:
      configIndex >= 0 && argv[configIndex + 1]
        ? argv[configIndex + 1]!
        : // Зібраний бандл лежить у dist/, конфіг — на рівень вище.
          path.resolve(__dirname, "..", "config.json"),
    once: argv.includes("--once"),
    full: argv.includes("--full"),
    preview: argv.includes("--preview"),
  };
}

/** Не даємо двом циклам накластися: нічна звірка може тривати довше за інтервал. */
let cycleInFlight = false;

async function runGuarded(cycle: SyncCycle, kind: SyncRunKind, log: Logger): Promise<void> {
  if (cycleInFlight) {
    log.warn({ kind }, "Попередній цикл ще виконується — пропускаємо запуск");
    return;
  }

  cycleInFlight = true;
  try {
    await cycle.run(kind);
  } catch (e) {
    log.error({ kind, error: e instanceof Error ? e.message : String(e) }, "Цикл впав з помилкою");
  } finally {
    cycleInFlight = false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.configPath);
  const log = createLogger(config.logDir, config.logLevel);

  // Прапорець --preview має пріоритет над конфігом: зручно для разової перевірки.
  const previewMode = args.preview || config.preview;

  log.info(
    {
      agentId: config.agentId,
      ingestUrl: config.ingestUrl,
      odataUrl: config.odata.baseUrl,
      preview: previewMode,
      scope: config.scope,
    },
    "Агент синхронізації 1С запускається"
  );

  const state = new StateStore(config.statePath);
  const outbox = new Outbox(config.outboxDir);
  const ingest = new IngestClient(config.ingestUrl, config.agentId, config.agentSecret, log);
  const cycle = new SyncCycle(config, state, outbox, ingest, log);

  try {
    await cycle.verifyConnections();
  } catch (e) {
    log.fatal(
      { error: e instanceof Error ? e.message : String(e) },
      "Перевірка зв'язку не пройдена — агент зупиняється"
    );
    state.close();
    process.exitCode = 1;
    return;
  }

  const pending = outbox.size();
  if (pending > 0) log.warn({ pending }, "У черзі є недоставлені батчі з минулого запуску");

  // --- Разовий запуск ---
  if (args.once) {
    const kind: SyncRunKind = previewMode ? "preview" : args.full ? "full" : "incremental";
    const result = await cycle.run(kind);
    log.info(result, "Разовий цикл завершено");
    state.close();
    process.exitCode = result.failed ? 1 : 0;
    return;
  }

  // --- Режим служби ---
  const intervalMs = config.schedule.intervalMinutes * 60 * 1000;
  const incrementalKind: SyncRunKind = previewMode ? "preview" : "incremental";

  log.info(
    { intervalMinutes: config.schedule.intervalMinutes, fullSyncCron: config.schedule.fullSyncCron },
    "Планувальник запущено"
  );

  await runGuarded(cycle, incrementalKind, log);
  const timer = setInterval(() => void runGuarded(cycle, incrementalKind, log), intervalMs);

  const nightly = cron.schedule(config.schedule.fullSyncCron, () => {
    void runGuarded(cycle, previewMode ? "preview" : "full", log);
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, "Зупинка агента");
    clearInterval(timer);
    nightly.stop();
    state.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e: unknown) => {
  // Логер міг ще не існувати (падіння на читанні конфігу) — пишемо в stderr.
  console.error("Фатальна помилка агента:", e instanceof Error ? e.message : e);
  process.exit(1);
});
