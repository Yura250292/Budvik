/**
 * OAuth-сервер MCP-конектора: білий список редиректів, підпис форми входу,
 * вхід адміна, коди, токени, ротація refresh і відкликання родин.
 *
 * Це та частина, через яку чужий сайт міг би отримати доступ до даних фірми,
 * тож перевіряються саме атаки: чужий редирект, повтор коду, повтор refresh,
 * токен людини, яку вже понизили в ролі, чужий resource.
 *
 *   npx tsx --env-file=.env scripts/check-mcp-oauth.mts
 *
 * Пише в базу (тестовий адмін, клієнт, коди, токени) і все прибирає в finally,
 * тому запускається ЛИШЕ на локальній базі — на будь-якій іншій відмовляється.
 */

process.env.MCP_STATE_SECRET = "секрет-для-проби";

import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { prisma } from "../src/lib/prisma";
import { isAllowedRedirect } from "../src/lib/mcp/oauth/redirects";
import { signParams, verifyParams, type AuthorizeParams } from "../src/lib/mcp/oauth/signed";
import { hashToken, newToken } from "../src/lib/mcp/oauth/tokens";
import { BudvikOAuthProvider, checkAdminLogin, issueCode } from "../src/lib/mcp/oauth/provider";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

/**
 * Очікуємо, що обіцянка впаде саме з цим OAuth-кодом помилки.
 *
 * За кодом, а не instanceof: .mts бере ESM-збірку SDK, а src/*.ts під tsx —
 * CJS, і класи помилок у них різні (у бандлі сервісу копія одна).
 */
async function rejects(name: string, p: Promise<unknown>, errorCode: string) {
  try {
    await p;
    check(name, false, "не впало");
  } catch (e) {
    const code = (e as { errorCode?: string }).errorCode;
    check(name, code === errorCode, `${code}: ${(e as Error).message}`);
    // invalid_token іде в заголовок WWW-Authenticate: кирилиця там валить Node
    // (ERR_INVALID_CHAR) — і замість 401 клієнт бачить 500 без повторного входу.
    if (errorCode === "invalid_token") {
      check(`${name}: повідомлення придатне для заголовка`, /^[\x20-\x7e]*$/.test((e as Error).message), (e as Error).message);
    }
  }
}

const NOW = new Date("2026-09-23T10:00:00Z");
const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";

/* ── Білий список редиректів ─────────────────────────────────────────── */

check("claude.ai callback", isAllowedRedirect(CLAUDE_CB), true);
check("claude.com callback", isAllowedRedirect("https://claude.com/api/mcp/auth_callback"), true);
check("chatgpt.com — стабільний callback", isAllowedRedirect("https://chatgpt.com/connector_platform_oauth_redirect"), true);
check("chatgpt.com — callback на підключення", isAllowedRedirect("https://chatgpt.com/connector/oauth/abc123"), true);
check("chat.openai.com", isAllowedRedirect("https://chat.openai.com/aip/g-123/oauth/callback"), true);
check("Claude Code: localhost з будь-яким портом", isAllowedRedirect("http://localhost:5173/callback"), true);
check("Claude Code: 127.0.0.1", isAllowedRedirect("http://127.0.0.1:41234/callback"), true);
check("чужий сайт", !isAllowedRedirect("https://evil.com/cb"), false);
check("claude.ai без https", !isAllowedRedirect("http://claude.ai/api/mcp/auth_callback"), false);
check("claude.ai.evil.com", !isAllowedRedirect("https://claude.ai.evil.com/api/mcp/auth_callback"), false);
check("claude.ai, але інший шлях", !isAllowedRedirect("https://claude.ai/some/other"), false);
check("evil-chatgpt.com", !isAllowedRedirect("https://evil-chatgpt.com/cb"), false);
check("локальний хост по https-підробці", !isAllowedRedirect("https://localhost.evil.com/callback"), false);
check("сміття", !isAllowedRedirect("казна-що"), false);

/* ── Підписані параметри форми входу ─────────────────────────────────── */

const params: AuthorizeParams = {
  clientId: "cl_1",
  redirectUri: CLAUDE_CB,
  codeChallenge: "challenge",
  state: "st",
  scopes: ["budvik.read"],
  resource: "http://localhost:3002/mcp",
};
const signed = signParams(params, NOW);
check("розбирається назад", verifyParams(signed, NOW)?.clientId === "cl_1", verifyParams(signed, NOW)?.clientId);
check("redirect на місці", verifyParams(signed, NOW)?.redirectUri === CLAUDE_CB, verifyParams(signed, NOW)?.redirectUri);
check("підроблений підпис", verifyParams(signed.slice(0, -3) + "aaa", NOW) === null, "null");
check("сміття", verifyParams("казна-що", NOW) === null, "null");
check("через 11 хвилин протух", verifyParams(signed, new Date(NOW.getTime() + 11 * 60_000)) === null, "null");
check("через 9 хвилин живий", verifyParams(signed, new Date(NOW.getTime() + 9 * 60_000)) !== null, "живий");
const forged = Buffer.from(JSON.stringify({ ...params, redirectUri: "https://evil.com/cb", exp: NOW.getTime() + 60_000 })).toString("base64url");
check("підмінене тіло зі старим підписом", verifyParams(`${forged}.${signed.split(".")[1]}`, NOW) === null, "null");

/* ── Токени ──────────────────────────────────────────────────────────── */

const t1 = newToken("bmcp_at");
check("префікс токена", t1.startsWith("bmcp_at_"), t1.slice(0, 10));
check("токени різні", t1 !== newToken("bmcp_at"), "різні");
check("хеш — sha256 hex", hashToken(t1) === createHash("sha256").update(t1).digest("hex"), hashToken(t1).slice(0, 8));

/* ── Із базою ────────────────────────────────────────────────────────── */

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) {
  console.log("\nБаза не локальна — перевірки з записом пропущено й вважаються проваленими.");
  fails.push("не локальна база");
} else {
  const RESOURCE = new URL("http://localhost:3002/mcp");
  const provider = new BudvikOAuthProvider({ issuer: new URL("http://localhost:3002"), resource: RESOURCE });
  const tag = randomBytes(4).toString("hex");
  const email = `mcp-check-${tag}@budvik.local`;
  const password = "пароль-для-проби-" + tag;
  const user = await prisma.user.create({
    data: { email, name: "Перевірка MCP", role: "ADMIN", password: await bcrypt.hash(password, 10) },
  });
  const clientId = `mcp-check-${tag}`;

  try {
    /* Вхід */
    check("вхід адміна", (await checkAdminLogin(email, password))?.userId === user.id, "ok");
    check("email з пробілами й великими літерами", (await checkAdminLogin(`  ${email.toUpperCase()} `, password))?.userId === user.id, "ok");
    check("невірний пароль", (await checkAdminLogin(email, "не той")) === null, "null");
    check("невідомий email", (await checkAdminLogin(`nobody-${tag}@budvik.local`, password)) === null, "null");

    /* Реєстрація клієнтів */
    const store = provider.clientsStore;
    await rejects(
      "реєстрація з чужим редиректом",
      Promise.resolve(store.registerClient!({ client_id: `${clientId}-evil`, redirect_uris: ["https://evil.com/cb"] } as OAuthClientInformationFull)),
      "invalid_client_metadata"
    );
    await rejects(
      "реєстрація, де хоч один редирект чужий",
      Promise.resolve(store.registerClient!({ client_id: `${clientId}-mix`, redirect_uris: [CLAUDE_CB, "https://evil.com/cb"] } as OAuthClientInformationFull)),
      "invalid_client_metadata"
    );
    const client = await store.registerClient!({
      client_id: clientId,
      client_name: "Claude",
      redirect_uris: [CLAUDE_CB],
      token_endpoint_auth_method: "none",
    } as OAuthClientInformationFull);
    const back = await store.getClient(clientId);
    check("клієнт зберігся і читається", back?.client_id === clientId && back?.redirect_uris[0] === CLAUDE_CB, back?.client_name);
    check("невідомий клієнт", (await store.getClient("нема-такого")) === undefined, "undefined");

    /* Чужий resource ще на кроці authorize */
    await rejects(
      "authorize з чужим resource",
      provider.authorize(client, { codeChallenge: "c", redirectUri: CLAUDE_CB, resource: new URL("https://evil.com/mcp") }, {} as never),
      "invalid_target"
    );

    /* Код → токени */
    const p: AuthorizeParams = { clientId, redirectUri: CLAUDE_CB, codeChallenge: "ch-1", scopes: ["budvik.read"], resource: RESOURCE.href };
    const code = await issueCode(p, user.id);
    check("виклик PKCE повертає challenge", (await provider.challengeForAuthorizationCode(client, code)) === "ch-1", "ch-1");
    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, CLAUDE_CB, RESOURCE);
    check("видано access і refresh", !!tokens.access_token && !!tokens.refresh_token, tokens.token_type);
    check("expires_in = година", tokens.expires_in === 3600, tokens.expires_in);
    const info = await provider.verifyAccessToken(tokens.access_token);
    check("access перевіряється, userId на місці", info.extra?.userId === user.id, info.clientId);
    check("expiresAt у секундах і в майбутньому", typeof info.expiresAt === "number" && info.expiresAt > Date.now() / 1000, info.expiresAt);
    await rejects("refresh як access не проходить", provider.verifyAccessToken(tokens.refresh_token!), "invalid_token");
    await rejects("сміття як access", provider.verifyAccessToken("bmcp_at_казна-що"), "invalid_token");

    /* Повтор коду → родина відкликана */
    await rejects("повтор коду", provider.exchangeAuthorizationCode(client, code, undefined, CLAUDE_CB, RESOURCE), "invalid_grant");
    await rejects("після повтору коду access мертвий", provider.verifyAccessToken(tokens.access_token), "invalid_token");

    /* Код з іншим redirect_uri */
    const code2 = await issueCode(p, user.id);
    await rejects(
      "обмін коду з іншим redirect_uri",
      provider.exchangeAuthorizationCode(client, code2, undefined, "https://claude.com/api/mcp/auth_callback", RESOURCE),
      "invalid_grant"
    );

    /* Ротація refresh і повтор старого */
    const code3 = await issueCode(p, user.id);
    const a = await provider.exchangeAuthorizationCode(client, code3, undefined, CLAUDE_CB, RESOURCE);
    const b = await provider.exchangeRefreshToken(client, a.refresh_token!, undefined, RESOURCE);
    check("ротація: нова пара", b.refresh_token !== a.refresh_token && b.access_token !== a.access_token, "нова");
    check("новий access живий", (await provider.verifyAccessToken(b.access_token)).extra?.userId === user.id, "живий");
    await rejects("повтор старого refresh", provider.exchangeRefreshToken(client, a.refresh_token!, undefined, RESOURCE), "invalid_grant");
    await rejects("після повтору refresh нова пара теж мертва", provider.verifyAccessToken(b.access_token), "invalid_token");
    await rejects("і новий refresh мертвий", provider.exchangeRefreshToken(client, b.refresh_token!, undefined, RESOURCE), "invalid_grant");

    /* Refresh чужого клієнта */
    const other = await store.registerClient!({ client_id: `${clientId}-2`, redirect_uris: [CLAUDE_CB], token_endpoint_auth_method: "none" } as OAuthClientInformationFull);
    const code4 = await issueCode(p, user.id);
    const c = await provider.exchangeAuthorizationCode(client, code4, undefined, CLAUDE_CB, RESOURCE);
    await rejects("refresh від імені іншого клієнта", provider.exchangeRefreshToken(other, c.refresh_token!, undefined, RESOURCE), "invalid_grant");

    /* Відкликання */
    await provider.revokeToken!(client, { token: c.refresh_token! });
    await rejects("revoke гасить родину: access мертвий", provider.verifyAccessToken(c.access_token), "invalid_token");

    /* Людину понизили в ролі — живий токен більше не пускає */
    const code5 = await issueCode(p, user.id);
    const d = await provider.exchangeAuthorizationCode(client, code5, undefined, CLAUDE_CB, RESOURCE);
    await prisma.user.update({ where: { id: user.id }, data: { role: "SALES" } });
    await rejects("токен понижено до SALES не проходить", provider.verifyAccessToken(d.access_token), "invalid_token");
    check("і вхід SALES не пускає", (await checkAdminLogin(email, password)) === null, "null");
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.mcpClient.deleteMany({ where: { id: { startsWith: clientId } } }).catch(() => {});
  }
}

await prisma.$disconnect();
console.log(fails.length ? `\nПРОВАЛЕНО ${fails.length}: ${fails.join("; ")}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
