/**
 * Фаєрвол Vercel: подивитися правила й додати виняток для товарних фідів.
 *
 * Навіщо окремий скрипт, а не curl руками: у Vercel CLI команд для фаєрвола
 * немає взагалі, а сирий запит із токеном — надто широкий інструмент для
 * задачі «додати одне правило». Тут рівно дві дії, і жодна з них не вміє
 * вимкнути захист від ботів, зняти наявні правила чи розблокувати щось
 * інше, крім /feeds/.
 *
 *   npx tsx scripts/vercel-firewall.mts list
 *   npx tsx scripts/vercel-firewall.mts add-feeds-bypass
 *
 * Навіщо виняток: Bot Protection у режимі challenge віддає «Vercel Security
 * Checkpoint» усім, хто не схожий на браузер. Hotline, Merchant Center і
 * решта агрегаторів ходять роботом, тож фід вони не заберуть. Вимикати
 * захист цілком не можна — у вересні 2026 по сайту вже йшла ботова хвиля.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Шлях, за яким Vercel CLI тримає токен на macOS. */
const AUTH = join(homedir(), "Library/Application Support/com.vercel.cli/auth.json");

/** Правило, яке цей скрипт уміє додати. Єдине й незмінне. */
const FEEDS_RULE = {
  name: "Товарні фіди — bypass",
  description:
    "Hotline, Merchant Center і решта агрегаторів ходять роботом, а не браузером: Bot Protection у режимі challenge віддавав їм 429. Виняток лише для /feeds/ — це публічні XML, решта сайту лишається під захистом.",
  active: true,
  conditionGroup: [{ conditions: [{ type: "path", op: "pre", value: "/feeds/" }] }],
  action: { mitigate: { action: "bypass" } },
};

function auth(): { token: string; teamId: string; projectId: string } {
  const token = JSON.parse(readFileSync(AUTH, "utf-8")).token as string;
  const project = JSON.parse(readFileSync(".vercel/project.json", "utf-8"));
  if (!token) throw new Error("Немає токена Vercel CLI — спершу npx vercel login");
  return { token, teamId: project.orgId, projectId: project.projectId };
}

async function config() {
  const { token, teamId, projectId } = auth();
  const res = await fetch(
    `https://api.vercel.com/v1/security/firewall/config/active?projectId=${projectId}&teamId=${teamId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Vercel API ${res.status}: ${await res.text()}`);
  return res.json();
}

function show(cfg: any) {
  const bot = cfg.managedRules?.bot_protection;
  console.log(`Захист від ботів: ${bot ? `${bot.active ? "увімкнено" : "вимкнено"} (${bot.action})` : "немає"}`);
  console.log(`Правил: ${cfg.rules.length}, версія конфігурації: ${cfg.version}\n`);
  for (const r of cfg.rules) {
    const paths = r.conditionGroup
      .flatMap((g: any) => g.conditions.map((c: any) => `${c.type} ${c.op} ${c.value ?? c.key ?? ""}`))
      .join(" | ");
    console.log(`• ${r.name}\n    дія: ${r.action.mitigate.action}, активне: ${r.active}\n    умови: ${paths}`);
  }
}

const command = process.argv[2];

if (command === "list") {
  show(await config());
} else if (command === "add-feeds-bypass") {
  const before: any = await config();

  const already = before.rules.find((r: any) => r.name === FEEDS_RULE.name);
  if (already) {
    console.log("Таке правило вже є — нічого не міняю.");
    show(before);
    process.exit(0);
  }

  const { token, teamId, projectId } = auth();
  const res = await fetch(
    `https://api.vercel.com/v1/security/firewall/config?projectId=${projectId}&teamId=${teamId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rules.insert", id: null, value: FEEDS_RULE }),
    }
  );
  if (!res.ok) throw new Error(`Vercel API ${res.status}: ${await res.text()}`);

  console.log("Правило додано.\n");
  show(await config());
} else {
  console.log("Використання: npx tsx scripts/vercel-firewall.mts list | add-feeds-bypass");
  process.exit(1);
}
