/**
 * Завантаження й перевірка конфігурації агента.
 *
 * Секрети не мають лежати у файлі поруч з кодом на сервері клієнта, тому
 * будь-яке значення виду "env:ІМЯ" підставляється зі змінної середовища.
 */

import fs from "node:fs";
import path from "node:path";

export interface OdataConfig {
  baseUrl: string;
  username: string;
  password: string;
  pageSize: number;
  timeoutMs: number;
}

export interface EntityNames {
  products: string;
  counterparties: string;
  warehouses: string;
  priceSlice: string;
  stockBalance: string;
  salesDocuments: string;
  purchaseDocuments: string;
  debtBalance: string;
}

export interface AgentConfig {
  agentId: string;
  agentSecret: string;
  ingestUrl: string;
  odata: OdataConfig;
  entities: EntityNames;
  priceTypes: { retail: string; wholesale: string };
  scope: {
    categories: boolean;
    products: boolean;
    prices: boolean;
    warehouses: boolean;
    stock: boolean;
    counterparties: boolean;
    documents: boolean;
    debts: boolean;
  };
  schedule: { intervalMinutes: number; fullSyncCron: string };
  documents: { windowDays: number };
  preview: boolean;
  batchSize: number;
  outboxDir: string;
  statePath: string;
  logDir: string;
  logLevel: string;
}

/** Підставляє значення зі змінної середовища для рядків "env:ІМЯ". */
function resolveSecret(value: string, fieldName: string): string {
  if (!value.startsWith("env:")) return value;

  const envName = value.slice(4);
  const resolved = process.env[envName];
  if (!resolved) {
    throw new Error(
      `Конфігурація ${fieldName}: змінна середовища ${envName} не задана. ` +
        `Задайте її для служби або впишіть значення прямо в config.json.`
    );
  }
  return resolved;
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Конфігурація: відсутнє обов'язкове поле "${name}"`);
  }
  return value;
}

export function loadConfig(configPath: string): AgentConfig {
  const absolute = path.resolve(configPath);

  if (!fs.existsSync(absolute)) {
    throw new Error(
      `Файл конфігурації не знайдено: ${absolute}\n` +
        `Скопіюйте config.example.json у config.json і заповніть.`
    );
  }

  const raw = JSON.parse(fs.readFileSync(absolute, "utf8")) as Record<string, unknown>;
  const dir = path.dirname(absolute);

  /** Відносні шляхи в конфігу — відносно самого конфіга, а не CWD служби. */
  const resolvePath = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(dir, p));

  const odata = required(raw.odata as OdataConfig | undefined, "odata");
  const entities = required(raw.entities as EntityNames | undefined, "entities");

  const config: AgentConfig = {
    agentId: required(raw.agentId as string, "agentId"),
    agentSecret: resolveSecret(required(raw.agentSecret as string, "agentSecret"), "agentSecret"),
    ingestUrl: required(raw.ingestUrl as string, "ingestUrl").replace(/\/$/, ""),
    odata: {
      baseUrl: required(odata.baseUrl, "odata.baseUrl").replace(/\/$/, ""),
      username: required(odata.username, "odata.username"),
      password: resolveSecret(required(odata.password, "odata.password"), "odata.password"),
      pageSize: odata.pageSize ?? 1000,
      timeoutMs: odata.timeoutMs ?? 120_000,
    },
    entities,
    priceTypes: (raw.priceTypes as AgentConfig["priceTypes"]) ?? { retail: "", wholesale: "" },
    scope: {
      categories: true,
      products: true,
      prices: true,
      warehouses: true,
      stock: true,
      counterparties: false,
      documents: false,
      debts: false,
      ...(raw.scope as Partial<AgentConfig["scope"]>),
    },
    schedule: {
      intervalMinutes: (raw.schedule as AgentConfig["schedule"])?.intervalMinutes ?? 20,
      fullSyncCron: (raw.schedule as AgentConfig["schedule"])?.fullSyncCron ?? "30 3 * * *",
    },
    documents: { windowDays: (raw.documents as AgentConfig["documents"])?.windowDays ?? 3 },
    preview: raw.preview === true,
    batchSize: (raw.batchSize as number) ?? 500,
    outboxDir: resolvePath((raw.outboxDir as string) ?? "./outbox"),
    statePath: resolvePath((raw.statePath as string) ?? "./state.db"),
    logDir: resolvePath((raw.logDir as string) ?? "./logs"),
    logLevel: (raw.logLevel as string) ?? "info",
  };

  if (config.schedule.intervalMinutes < 1) {
    throw new Error("Конфігурація: schedule.intervalMinutes має бути щонайменше 1");
  }
  if (config.batchSize < 1 || config.batchSize > 500) {
    throw new Error("Конфігурація: batchSize має бути в межах 1..500 (обмеження ingest)");
  }

  return config;
}
