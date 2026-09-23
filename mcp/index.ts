/**
 * MCP-сервіс Budvik — окремий Node-процес на Railway (сервіс budvik-mcp).
 *
 * Що тут живе:
 * - OAuth 2.1 сервер для claude.ai і ChatGPT (/authorize, /login, /token,
 *   /register, /revoke і метадані в /.well-known) — src/lib/mcp/oauth;
 * - сам MCP-ендпоінт POST /mcp (Streamable HTTP без сесій) з Bearer-токеном —
 *   src/lib/mcp/server.ts;
 * - /healthz для Railway.
 *
 * Чому окремий сервіс, а не роут сайту чи воркер: Vercel з увімкненим
 * челенджем віддає 429 будь-якому не-браузерному клієнту (а OAuth-дискавері
 * Anthropic і OpenAI саме такі), а воркер приймає обмін з 1С — його
 * перезапуск через деплой конектора зупинив би прийом. Див. docs/mcp-connector.md.
 *
 *   npm run mcp                         — локально (tsx, .env)
 *   npm run mcp:build && node dist/mcp.cjs  — як на Railway
 */

import express from "express";
import cors from "cors";
import { createOAuthMetadata, getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { prisma } from "@/lib/prisma";
import { BudvikOAuthProvider, type McpAuthExtra } from "@/lib/mcp/oauth/provider";
import { makeLoginHandler } from "@/lib/mcp/oauth/login";
import { readonlyDb } from "@/lib/mcp/readonly-db";
import { createMcpServer } from "@/lib/mcp/server";
import { purgeOldCalls } from "@/lib/mcp/audit";

const PORT = Number(process.env.PORT) || 3002;

/*
 * Небезпечна конфігурація — відмова на старті, і без надії на NODE_ENV (його
 * виставляє збирач, а не ми): публічна адреса без читальної ролі означала б
 * query_db від superuser, а прод без MCP_ISSUER_URL — метадані OAuth з
 * http://localhost, до яких жоден клієнт не підключиться.
 */
function refuse(why: string): never {
  console.error(`[mcp] відмовляюсь стартувати: ${why}`);
  process.exit(1);
}
if (!process.env.MCP_STATE_SECRET) refuse("MCP_STATE_SECRET не задано");
if (!process.env.MCP_ISSUER_URL && process.env.NODE_ENV === "production") {
  refuse("MCP_ISSUER_URL не задано (у проді — https://mcp.budvik27.com)");
}
const issuerRaw = process.env.MCP_ISSUER_URL ?? `http://localhost:${PORT}`;

/** Без хвостового слеша в змінній, але issuer.href — зі слешем, як його віддає SDK. */
const issuer = new URL(issuerRaw.replace(/\/+$/, "") + "/");
const resource = new URL("/mcp", issuer);
const SCOPES = ["budvik.read", "offline_access"];

const isLocal = ["localhost", "127.0.0.1"].includes(issuer.hostname);
if (!isLocal && !process.env.MCP_READONLY_DATABASE_URL) {
  refuse("MCP_READONLY_DATABASE_URL не задано — на публічній адресі довільний SQL лише під роллю budvik_mcp_ro");
}
// Упасти на старті, а не на першому query_db, якщо в проді немає читальної ролі.
readonlyDb();

const provider = new BudvikOAuthProvider({ issuer, resource });
const app = express();
// Railway за проксі: req.ip — справжній клієнт (стеля спроб входу по адресі).
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.get(["/", "/healthz"], (_req, res) => {
  res.json({ ok: true, service: "budvik-mcp" });
});

/*
 * Метадані сервера авторизації — свої, поверх згенерованих SDK: SDK 1.30 не
 * оголошує authorization_response_iss_parameter_supported, а ChatGPT на ньому
 * будує стабільний callback (RFC 9207). Маршрут стоїть ДО mcpAuthRouter,
 * тож перемагає однойменний із SDK.
 */
const asMetadata = {
  ...createOAuthMetadata({ provider, issuerUrl: issuer, scopesSupported: SCOPES }),
  authorization_response_iss_parameter_supported: true,
};
app.options("/.well-known/oauth-authorization-server", cors());
app.get("/.well-known/oauth-authorization-server", cors(), (_req, res) => {
  res.json(asMetadata);
});

app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: issuer,
    resourceServerUrl: resource,
    scopesSupported: SCOPES,
    resourceName: "Budvik",
    // Секрет confidential-клієнта не протухає: за замовчуванням SDK дає 30 днів,
    // і після них ChatGPT мовчки втратив би доступ без жодного пояснення.
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
  })
);

app.post("/login", express.urlencoded({ extended: false, limit: "16kb" }), makeLoginHandler(provider));

const bearer = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
});

/*
 * Без сесій: на кожен запит — новий сервер і транспорт. Інструменти не
 * тримають стану між викликами, а без сесій сервіс переживає рестарт і
 * деплой непомітно для Claude/ChatGPT.
 */
app.post("/mcp", bearer, express.json({ limit: "1mb" }), async (req, res) => {
  const auth = req.auth!;
  const extra = auth.extra as McpAuthExtra;
  const server = createMcpServer({ userId: extra.userId, userName: extra.userName, clientId: auth.clientId });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("[mcp] /mcp упав:", e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Внутрішня помилка сервера" }, id: null });
    }
  }
});
// GET (SSE-потік) і DELETE (кінець сесії) без сесій не потрібні.
app.all("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
});

const httpServer = app.listen(PORT, () => {
  console.log(`[mcp] слухаю :${PORT} · issuer ${issuer.href} · resource ${resource.href}`);
});

// Журнал викликів — 90 днів; раз на добу, перший прохід через хвилину після старту.
const purge = () =>
  purgeOldCalls()
    .then((n) => n && console.log(`[mcp] журнал: прибрано ${n} старих викликів`))
    .catch((e) => console.error("[mcp] чистка журналу:", e));
setTimeout(purge, 60_000).unref();
setInterval(purge, 24 * 3600_000).unref();

function shutdown(signal: string) {
  console.log(`[mcp] ${signal} — зупиняюсь`);
  httpServer.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
