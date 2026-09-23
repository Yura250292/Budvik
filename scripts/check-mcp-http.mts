/**
 * Наскрізна перевірка MCP-сервісу по HTTP — рівно той танець, який робить
 * claude.ai (і ChatGPT) при підключенні конектора:
 *
 *   401 з resource_metadata → метадані ресурсу й сервера → реєстрація
 *   клієнта → сторінка входу → вхід → код → токени → MCP-запити з
 *   Bearer → оновлення токена → повтор старого refresh відкидається.
 *
 *   npx tsx --env-file=.env scripts/check-mcp-http.mts http://localhost:3002
 *   MCP_CHECK_EMAIL=… MCP_CHECK_PASSWORD=… npx tsx scripts/check-mcp-http.mts https://mcp.budvik27.com
 *
 * На локальній базі сам заводить тимчасового адміна й прибирає за собою.
 * На віддаленому сервері бере вхід з MCP_CHECK_EMAIL / MCP_CHECK_PASSWORD
 * і лишає по собі одного зареєстрованого клієнта (як після справжнього
 * підключення) — його видно й можна відключити в профілі.
 */

import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = (process.argv[2] ?? "http://localhost:3002").replace(/\/+$/, "");
const MCP_URL = `${BASE}/mcp`;
const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got).slice(0, 180)}`);
  if (!ok) fails.push(name);
}
function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) {
    console.log(`\nСТОП: ${what} — далі перевіряти нема чого.`);
    process.exit(1);
  }
  return v;
}

const b64url = (b: Buffer) => b.toString("base64url");
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

/* ── Хто входить ───────────────────────────────────────────────────── */

const isLocalDb = /@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "");
let email = process.env.MCP_CHECK_EMAIL ?? "";
let password = process.env.MCP_CHECK_PASSWORD ?? "";
let cleanup: (() => Promise<void>) | null = null;
const registered: string[] = [];

if (!email && isLocalDb && /localhost|127\.0\.0\.1/.test(BASE)) {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomBytes(4).toString("hex");
  email = `mcp-http-${tag}@budvik.local`;
  password = `пароль-${tag}`;
  const user = await prisma.user.create({
    data: { email, name: "Перевірка HTTP MCP", role: "ADMIN", password: await bcrypt.hash(password, 10) },
  });
  cleanup = async () => {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.mcpClient.deleteMany({ where: { id: { in: registered } } }).catch(() => {});
    await prisma.$disconnect();
  };
}
if (!email || !password) {
  console.log("Задайте MCP_CHECK_EMAIL і MCP_CHECK_PASSWORD (адмін сайту).");
  process.exit(1);
}

try {
  /* ── Здоров'я ────────────────────────────────────────────────────── */
  const h = await fetch(`${BASE}/healthz`);
  check("healthz 200", h.ok, h.status);

  /* ── 1. Без токена → 401 з адресою метаданих ────────────────────── */
  const r401 = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const www = r401.headers.get("www-authenticate") ?? "";
  check("POST /mcp без токена → 401", r401.status === 401, r401.status);
  check("WWW-Authenticate з resource_metadata", www.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`), www);
  check("GET /mcp → 405", (await fetch(MCP_URL)).status === 405, "405");

  /* ── 2. Метадані ресурсу ─────────────────────────────────────────── */
  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  check("resource точно = адреса MCP", prm.resource === MCP_URL, prm.resource);
  check("authorization_servers → наш issuer", prm.authorization_servers?.[0] === `${BASE}/`, prm.authorization_servers);

  /* ── 3. Метадані сервера авторизації ─────────────────────────────── */
  const asm = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  check("PKCE S256", asm.code_challenge_methods_supported?.includes("S256"), asm.code_challenge_methods_supported);
  check("публічні клієнти (none)", asm.token_endpoint_auth_methods_supported?.includes("none"), asm.token_endpoint_auth_methods_supported);
  check("є registration_endpoint", asm.registration_endpoint === `${BASE}/register`, asm.registration_endpoint);
  check("offline_access у scopes", asm.scopes_supported?.includes("offline_access"), asm.scopes_supported);
  check("iss у відповіді авторизації оголошено", asm.authorization_response_iss_parameter_supported === true, asm.authorization_response_iss_parameter_supported);

  /* ── 4. Реєстрація ───────────────────────────────────────────────── */
  const evil = await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Злий", redirect_uris: ["https://evil.com/cb"], token_endpoint_auth_method: "none" }),
  });
  check("реєстрація з чужим редиректом → 400", evil.status === 400, `${evil.status} ${await evil.text()}`);

  const conf = await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "ChatGPT (перевірка)", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] }),
  });
  const confJ = await conf.json();
  if (confJ.client_id) registered.push(confJ.client_id);
  check("confidential-клієнт отримав секрет", conf.status === 201 && !!confJ.client_secret, conf.status);
  check("секрет не протухає (expires_at = 0)", confJ.client_secret_expires_at === 0, confJ.client_secret_expires_at);

  const reg = await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude (перевірка)",
      redirect_uris: [CLAUDE_CB],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  const regJ = await reg.json();
  const clientId = must<string>(regJ.client_id, `реєстрація не вдалась: ${reg.status} ${JSON.stringify(regJ)}`);
  registered.push(clientId);
  check("публічний клієнт зареєстровано", reg.status === 201, reg.status);

  /* ── 5. Сторінка входу ───────────────────────────────────────────── */
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const authUrl = new URL(`${BASE}/authorize`);
  authUrl.search = form({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CB,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "стан-123",
    scope: "budvik.read offline_access",
    resource: MCP_URL,
  });
  const page = await fetch(authUrl, { redirect: "manual" });
  const html = await page.text();
  check("сторінка входу 200", page.status === 200, page.status);
  check("на сторінці хост редиректу", html.includes("claude.ai"), "claude.ai");
  check("сторінку не вбудувати у фрейм", page.headers.get("x-frame-options") === "DENY", page.headers.get("x-frame-options"));
  const req = must(html.match(/name="req" value="([^"]+)"/)?.[1], "у формі немає поля req");

  /* ── 6. Вхід ─────────────────────────────────────────────────────── */
  const wrong = await fetch(`${BASE}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ req, email, password: "не той пароль" }),
  });
  check("невірний пароль → 401 і форма з помилкою", wrong.status === 401 && (await wrong.text()).includes("Невірний"), wrong.status);

  const tampered = await fetch(`${BASE}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ req: req.slice(0, -4) + "AAAA", email, password }),
  });
  check("підмінене поле req → 400", tampered.status === 400, tampered.status);

  const login = await fetch(`${BASE}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ req, email, password }),
  });
  const loc = new URL(must(login.headers.get("location"), `вхід не дав редиректу: ${login.status} ${await login.text()}`));
  check("вхід → 302 на claude.ai", login.status === 302 && loc.origin + loc.pathname === CLAUDE_CB, `${login.status} ${loc.origin}${loc.pathname}`);
  check("state повернувся", loc.searchParams.get("state") === "стан-123", loc.searchParams.get("state"));
  check("iss = issuer", loc.searchParams.get("iss") === `${BASE}/`, loc.searchParams.get("iss"));
  const code = must(loc.searchParams.get("code"), "у редиректі немає code");

  /* ── 7. Код → токени (form-urlencoded, як шле Claude) ───────────── */
  const badPkce = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "authorization_code", code, code_verifier: "не-той-verifier-не-той-verifier-не-той-43", client_id: clientId, redirect_uri: CLAUDE_CB }),
  });
  check("чужий code_verifier → 400", badPkce.status === 400, `${badPkce.status} ${await badPkce.text()}`);

  const tok = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: CLAUDE_CB, resource: MCP_URL }),
  });
  const tokJ = await tok.json();
  check("токени видано", tok.status === 200 && !!tokJ.access_token && !!tokJ.refresh_token, `${tok.status} ${JSON.stringify(tokJ).slice(0, 120)}`);
  const access = must<string>(tokJ.access_token, "немає access_token");

  /* ── 8. MCP з токеном ────────────────────────────────────────────── */
  const mcp = new Client({ name: "check-mcp-http", version: "1.0.0" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${access}` } } }));
  const { tools } = await mcp.listTools();
  check("tools/list — 18 інструментів", tools.length === 18, tools.length);
  const q = (await mcp.callTool({ name: "query_db", arguments: { sql: "SELECT COUNT(*) AS n FROM staff" } })) as { isError?: boolean; content: { text?: string }[] };
  check("query_db через HTTP", !q.isError && q.content[0]?.text?.includes("columns") === true, q.content[0]?.text);
  await mcp.close();

  /* ── 9. Оновлення токена й повтор старого refresh ────────────────── */
  const ref = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "refresh_token", refresh_token: tokJ.refresh_token, client_id: clientId }),
  });
  const refJ = await ref.json();
  check("refresh → нова пара", ref.status === 200 && refJ.refresh_token && refJ.refresh_token !== tokJ.refresh_token, ref.status);
  const again = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "refresh_token", refresh_token: tokJ.refresh_token, client_id: clientId }),
  });
  const againJ = await again.json();
  check("старий refresh → invalid_grant", again.status === 400 && againJ.error === "invalid_grant", `${again.status} ${againJ.error}`);
  const dead = await fetch(MCP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${refJ.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check("після повтору refresh новий access теж мертвий", dead.status === 401, dead.status);

  /* ── 10. Підбір пароля зі зміною адреси (лише на тимчасовому адміні) ── */
  // Стеля «адреса + email» сама по собі не рятує: хто міняє IP, отримує нові
  // 5 спроб щоразу. Має спрацювати й стеля на сам email. Локально Express
  // бере req.ip з X-Forwarded-For (trust proxy 1) — так і імітуємо ботнет.
  if (cleanup) {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await fetch(`${BASE}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": `203.0.113.${10 + i}` },
        body: form({ req, email, password: `не-той-${i}` }),
      });
      statuses.push(r.status);
    }
    check("з різних адрес: після 10 спроб на email — 429", statuses.slice(10).every((s) => s === 429), statuses.join(","));
    const right = await fetch(`${BASE}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": "203.0.113.99" },
      body: form({ req, email, password }),
    });
    check("і правильний пароль з нової адреси не пускає, поки діє стеля", right.status === 429, right.status);
  }
} finally {
  if (cleanup) await cleanup();
}

console.log(fails.length ? `\nПРОВАЛЕНО ${fails.length}: ${fails.join("; ")}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
