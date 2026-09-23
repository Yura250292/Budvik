/**
 * «Підключені AI-застосунки» в профілі адміна: список живих підключень і
 * відкликання — лише своїх.
 *
 *   npx tsx --env-file=.env scripts/check-mcp-grants.mts
 *
 * Пише в базу (тестові адміни, клієнт, токени) і прибирає — лише локальна база.
 */

process.env.MCP_STATE_SECRET = "секрет-для-проби";

import { randomBytes } from "crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { prisma } from "../src/lib/prisma";
import { BudvikOAuthProvider, issueCode } from "../src/lib/mcp/oauth/provider";
import { listGrants, revokeGrant } from "../src/lib/mcp/grants";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got).slice(0, 160)}`);
  if (!ok) fails.push(name);
}

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.log("База не локальна — відмовляюсь.");
  process.exit(1);
}

const CB = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = new URL("http://localhost:3002/mcp");
const provider = new BudvikOAuthProvider({ issuer: new URL("http://localhost:3002"), resource: RESOURCE });
const tag = randomBytes(4).toString("hex");
const me = await prisma.user.create({ data: { email: `grants-me-${tag}@budvik.local`, name: "Я", role: "ADMIN" } });
const other = await prisma.user.create({ data: { email: `grants-other-${tag}@budvik.local`, name: "Інший", role: "ADMIN" } });
const clientId = `grants-${tag}`;

try {
  const client = await provider.clientsStore.registerClient!({
    client_id: clientId,
    client_name: "Claude",
    redirect_uris: [CB],
    token_endpoint_auth_method: "none",
  } as OAuthClientInformationFull);
  const connect = async (userId: string) => {
    const code = await issueCode({ clientId, redirectUri: CB, codeChallenge: "c", scopes: ["budvik.read"], resource: RESOURCE.href }, userId);
    return provider.exchangeAuthorizationCode(client, code, undefined, CB, RESOURCE);
  };

  check("спершу підключень немає", (await listGrants(me.id)).length === 0, 0);

  const t = await connect(me.id);
  await connect(other.id);
  // Оновлення не має плодити «друге підключення»: родина та сама.
  const t2 = await provider.exchangeRefreshToken(client, t.refresh_token!, undefined, RESOURCE);
  await provider.verifyAccessToken(t2.access_token);

  const mine = await listGrants(me.id);
  check("одне моє підключення (після оновлення — теж одне)", mine.length === 1, mine.length);
  check("назва застосунку", mine[0]?.clientName === "Claude", mine[0]?.clientName);
  check("коли підключено", mine[0]?.connectedAt instanceof Date, mine[0]?.connectedAt);
  check("чужих не видно", (await listGrants(other.id)).length === 1, "по одному");

  check("чуже не відкликається", (await revokeGrant(other.id, mine[0].familyId)) === false, "false");
  await provider.verifyAccessToken(t2.access_token);
  check("після чужої спроби токен живий", true, "живий");

  check("своє відкликається", (await revokeGrant(me.id, mine[0].familyId)) === true, "true");
  let dead = false;
  try {
    await provider.verifyAccessToken(t2.access_token);
  } catch {
    dead = true;
  }
  check("після відкликання access мертвий", dead, dead);
  check("список порожній", (await listGrants(me.id)).length === 0, 0);
  check("у іншого адміна підключення лишилось", (await listGrants(other.id)).length === 1, 1);
} finally {
  await prisma.user.deleteMany({ where: { id: { in: [me.id, other.id] } } }).catch(() => {});
  await prisma.mcpClient.deleteMany({ where: { id: clientId } }).catch(() => {});
  await prisma.$disconnect();
}

console.log(fails.length ? `\nПРОВАЛЕНО ${fails.length}: ${fails.join("; ")}` : "\nУсе гаразд.");
process.exit(fails.length ? 1 : 0);
