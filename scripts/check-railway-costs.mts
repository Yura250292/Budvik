/**
 * Рахунок Railway по сервісах — звідки беруться гроші.
 *
 * READ ONLY: лише запити до GraphQL Railway, жодних змін.
 *
 * Панель показує рахунок одним числом на проєкт, а платимо ми за конкретні
 * сервіси, і без розбивки будь-яка оптимізація — гадання. Тут та сама
 * розбивка, що в рахунку (звірено 08.09.2026 до долара), плюс тарифи, щоб
 * *-хвилини одразу читалися грошима.
 *
 * Головне, що видно тільки тут: памʼять — найбільша стаття, а CPU майже
 * нуль. Тобто платимо за те, що контейнери живі, а не за роботу; і воювати
 * треба зі сплячими сервісами та зайвими зʼєднаннями, а не з швидкістю коду.
 *
 * Запуск:
 *   npx tsx scripts/check-railway-costs.mts            # поточний період
 *   npx tsx scripts/check-railway-costs.mts 2026-09-01 # від дати
 *
 * Токен береться з ~/.railway/config.json (той самий, що в railway CLI).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECT_ID = "f2f8cb78-4633-455e-9b63-da911f121394"; // Budvik
const API = "https://backboard.railway.app/graphql/v2";

/**
 * Тарифи Railway. Значення метрик приходять у *-хвилинах, тому місячна ціна
 * ділиться на 43200 хвилин; трафік — просто за гігабайт.
 */
const MONTH_MINUTES = 43_200;
const PRICE = {
  CPU_USAGE: { perMonth: 20, unit: "vCPU-хв" },
  MEMORY_USAGE_GB: { perMonth: 10, unit: "ГБ-хв" },
  DISK_USAGE_GB: { perMonth: 0.15, unit: "ГБ-хв" },
  BACKUP_USAGE_GB: { perMonth: 0.15, unit: "ГБ-хв" },
} as const;
const EGRESS_PER_GB = 0.05;

type Row = { measurement: string; value: number; tags: { serviceId: string } };

function token(): string {
  const cfg = JSON.parse(readFileSync(join(homedir(), ".railway", "config.json"), "utf8"));
  const t = cfg?.user?.token;
  if (!t) throw new Error("Немає токена в ~/.railway/config.json — зайдіть через railway login");
  return t;
}

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

function cost(measurement: string, value: number): number {
  if (measurement === "NETWORK_TX_GB") return value * EGRESS_PER_GB;
  const p = PRICE[measurement as keyof typeof PRICE];
  return p ? (value / MONTH_MINUTES) * p.perMonth : 0;
}

const from = process.argv[2] ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
const start = `${from}T00:00:00Z`;
const end = new Date().toISOString();

const names = await gql<{ project: { services: { edges: Array<{ node: { id: string; name: string } }> } } }>(
  `query { project(id: "${PROJECT_ID}") { services { edges { node { id name } } } } }`
);
const nameById = new Map(names.project.services.edges.map((e) => [e.node.id, e.node.name]));

const data = await gql<{ usage: Row[] }>(`query {
  usage(projectId: "${PROJECT_ID}",
        measurements: [CPU_USAGE, MEMORY_USAGE_GB, NETWORK_TX_GB, DISK_USAGE_GB, BACKUP_USAGE_GB],
        groupBy: [SERVICE_ID], startDate: "${start}", endDate: "${end}") {
    measurement value tags { serviceId }
  }
}`);

const byService = new Map<string, Map<string, number>>();
for (const row of data.usage) {
  const name = nameById.get(row.tags.serviceId) ?? row.tags.serviceId;
  if (!byService.has(name)) byService.set(name, new Map());
  const m = byService.get(name)!;
  m.set(row.measurement, (m.get(row.measurement) ?? 0) + row.value);
}

const days = (Date.parse(end) - Date.parse(start)) / 86400_000;
console.log(`Проєкт Budvik, ${from} → сьогодні (${days.toFixed(1)} дн.)\n`);

const totals: Array<[string, number, string]> = [];
for (const [name, m] of byService) {
  const sum = [...m].reduce((acc, [k, v]) => acc + cost(k, v), 0);
  const parts = [...m]
    .filter(([, v]) => v > 0)
    .sort((a, b) => cost(b[0], b[1]) - cost(a[0], a[1]))
    .map(([k, v]) => `${k.replace("_USAGE", "").replace("_GB", "")} $${cost(k, v).toFixed(2)}`);
  totals.push([name, sum, parts.join("  ")]);
}
totals.sort((a, b) => b[1] - a[1]);

let grand = 0;
for (const [name, sum, parts] of totals) {
  grand += sum;
  console.log(`${name.padEnd(20)} $${sum.toFixed(2).padStart(6)}   ${parts}`);
}
console.log(`${"РАЗОМ".padEnd(20)} $${grand.toFixed(2).padStart(6)}`);
console.log(`${"на місяць".padEnd(20)} $${((grand / days) * 30).toFixed(2).padStart(6)} за поточним темпом`);
