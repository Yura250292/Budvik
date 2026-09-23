/**
 * MCP-сервіс відмовляється стартувати в небезпечній конфігурації — і не
 * покладається на те, що хтось виставив NODE_ENV.
 *
 * - публічна адреса (не localhost) без MCP_READONLY_DATABASE_URL → падіння:
 *   інакше query_db тихо пішов би від superuser;
 * - NODE_ENV=production без MCP_ISSUER_URL → падіння: інакше метадані OAuth
 *   оголосили б http://localhost і жоден клієнт не підключився б;
 * - локальна адреса без ролі — стартує (розробка).
 *
 *   npx tsx --env-file=.env scripts/check-mcp-startup.mts
 *
 * Бази не пише: сервіс лише піднімається й гаситься.
 */

import { spawn } from "child_process";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got).slice(0, 200)}`);
  if (!ok) fails.push(name);
}

type Run = { code: number | null; out: string; healthy: boolean };

/** Підняти сервіс із заданим оточенням: або він упаде, або відповість на /healthz. */
function run(env: Record<string, string | undefined>, port: number): Promise<Run> {
  return new Promise((resolve) => {
    const base: Record<string, string | undefined> = { ...process.env };
    delete base.MCP_READONLY_DATABASE_URL;
    delete base.MCP_ISSUER_URL;
    delete base.NODE_ENV;
    const child = spawn("npx", ["tsx", "mcp/index.ts"], {
      env: { ...base, MCP_STATE_SECRET: "startup-check", PORT: String(port), ...env } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    let done = false;
    const finish = (r: Run) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve(r);
    };
    child.on("exit", (code) => finish({ code, out, healthy: false }));
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`http://localhost:${port}/healthz`);
        if (r.ok) finish({ code: null, out, healthy: true });
      } catch {
        /* ще не піднявся */
      }
    }, 300);
    const timer = setTimeout(() => finish({ code: null, out, healthy: false }), 25_000);
  });
}

const pub = await run({ MCP_ISSUER_URL: "https://mcp.example.com" }, 3011);
check("публічна адреса без читальної ролі — не стартує", !pub.healthy && pub.code !== 0 && pub.code !== null, `code=${pub.code}`);
check("…і каже чому", /відмовляюсь стартувати.*MCP_READONLY_DATABASE_URL/.test(pub.out), pub.out.split("\n").find((l) => l.includes("відмовляюсь")) ?? pub.out.slice(-200));

const prodNoIssuer = await run({ NODE_ENV: "production", MCP_READONLY_DATABASE_URL: process.env.DATABASE_URL }, 3012);
check("production без MCP_ISSUER_URL — не стартує", !prodNoIssuer.healthy && prodNoIssuer.code !== 0 && prodNoIssuer.code !== null, `code=${prodNoIssuer.code}`);
check("…і каже чому", /відмовляюсь стартувати.*MCP_ISSUER_URL/.test(prodNoIssuer.out), prodNoIssuer.out.split("\n").find((l) => l.includes("відмовляюсь")) ?? prodNoIssuer.out.slice(-200));

const local = await run({ MCP_ISSUER_URL: "http://localhost:3013" }, 3013);
check("локальна адреса без ролі — стартує (розробка)", local.healthy, local.healthy ? "healthz 200" : local.out.slice(-200));

console.log(fails.length ? `\nПРОВАЛЕНО ${fails.length}: ${fails.join("; ")}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
