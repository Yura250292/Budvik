/**
 * OAuth 2.1 authorization server MCP-конектора поверх Prisma.
 *
 * Реалізує інтерфейс OAuthServerProvider з @modelcontextprotocol/sdk: SDK
 * сам розбирає HTTP (/authorize, /token, /register, /revoke, метадані),
 * перевіряє PKCE і клієнта, а тут — лише рішення «кому і що видати».
 *
 * Правила, заради яких цей файл і існує:
 * - пускаємо лише роль ADMIN, і перевіряємо її на КОЖНОМУ запиті, а не
 *   лише при видачі: пониженого адміна живий токен не рятує;
 * - одне підключення = одна родина токенів (familyId); будь-яка ознака
 *   крадіжки (повтор коду, повтор refresh, refresh від чужого клієнта)
 *   гасить усю родину — вкрадене перестає працювати разом зі справжнім,
 *   а людина просто входить знову;
 * - refresh ротується на кожному обміні (вимога OAuth 2.1 для публічних
 *   клієнтів, а claude.ai і ChatGPT реєструються саме так).
 *
 * Навмисно без імпортів з next/*: файл бандлиться в окремий Node-сервіс.
 */

import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import type { Response } from "express";
import type { Prisma } from "@prisma/client";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { prisma } from "@/lib/prisma";
import { isAllowedRedirect } from "@/lib/mcp/oauth/redirects";
import { renderLogin } from "@/lib/mcp/oauth/login-page";
import type { AuthorizeParams } from "@/lib/mcp/oauth/signed";
import { ACCESS_TTL_S, CODE_TTL_S, REFRESH_TTL_S, hashToken, newToken } from "@/lib/mcp/oauth/tokens";

export type ProviderOptions = {
  /** Адреса самого OAuth-сервера, напр. https://mcp.budvik27.com. */
  issuer: URL;
  /** Адреса MCP-ендпоінта (resource у RFC 8707), напр. https://mcp.budvik27.com/mcp. */
  resource: URL;
};

/** Що кладемо в AuthInfo.extra — з цього MCP-сервер будує контекст інструментів. */
export type McpAuthExtra = { userId: string; userName: string; familyId: string };

/**
 * Хеш-заглушка для «такого email немає»: bcrypt однаково відпрацьовує, і
 * за часом відповіді не видно, чи існує акаунт.
 */
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), 10);

/** Лише ADMIN: помічник керівника бачить усю фірму, і назовні — так само. */
export const MCP_ROLES = ["ADMIN"] as const;

/**
 * Email + пароль сайту → адмін або null.
 *
 * Email шукаємо без урахування регістру: у базі трапляються адреси з
 * великими літерами (див. нормалізацію входу на сайті), а людина вводить
 * як пам'ятає. Причину відмови назовні не розрізняємо.
 */
export async function checkAdminLogin(
  email: string,
  password: string
): Promise<{ userId: string; name: string } | null> {
  const e = email.trim().toLowerCase();
  if (!e || !password) return null;
  const user = await prisma.user.findFirst({
    where: { email: { equals: e, mode: "insensitive" } },
    select: { id: true, name: true, email: true, password: true, role: true },
  });
  const ok = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  if (!user?.password || !ok) return null;
  if (!(MCP_ROLES as readonly string[]).includes(user.role)) return null;
  return { userId: user.id, name: user.name ?? user.email };
}

/** Код авторизації після успішного входу. Відкритий код існує лише в редиректі. */
export async function issueCode(p: AuthorizeParams, userId: string): Promise<string> {
  const code = newToken("bmcp_code");
  await prisma.mcpAuthCode.create({
    data: {
      codeHash: hashToken(code),
      clientId: p.clientId,
      userId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      scopes: p.scopes,
      resource: p.resource ?? null,
      expiresAt: new Date(Date.now() + CODE_TTL_S * 1000),
      familyId: randomUUID(),
    },
  });
  return code;
}

/** Порівняння адрес без хвостового слеша й регістру хоста. */
function sameUrl(a: URL | string, b: URL | string): boolean {
  try {
    const x = new URL(String(a));
    const y = new URL(String(b));
    return x.origin === y.origin && x.pathname.replace(/\/+$/, "") === y.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

export class BudvikOAuthProvider implements OAuthServerProvider {
  readonly issuer: URL;
  readonly resource: URL;
  private readonly store: OAuthRegisteredClientsStore;

  constructor(opts: ProviderOptions) {
    this.issuer = opts.issuer;
    this.resource = opts.resource;
    this.store = {
      getClient: async (clientId: string) => {
        const row = await prisma.mcpClient.findUnique({ where: { id: clientId }, select: { metadata: true } });
        return row ? (row.metadata as unknown as OAuthClientInformationFull) : undefined;
      },
      registerClient: async (client) => {
        const full = client as OAuthClientInformationFull;
        const uris = full.redirect_uris ?? [];
        if (!uris.length || !uris.every((u) => isAllowedRedirect(String(u)))) {
          throw new InvalidClientMetadataError(
            "redirect_uri дозволені лише для claude.ai, claude.com, chatgpt.com, chat.openai.com і localhost"
          );
        }
        if (!full.client_id) throw new InvalidClientMetadataError("client_id не згенеровано");
        await prisma.mcpClient.create({
          data: {
            id: full.client_id,
            secret: full.client_secret ?? null,
            name: full.client_name ?? null,
            redirectUris: uris.map(String),
            metadata: full as unknown as Prisma.InputJsonValue,
          },
        });
        return full;
      },
    };
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.store;
  }

  /** Наш resource — MCP-ендпоінт; дехто з клієнтів шле просто origin сервера. */
  private isOurResource(r: URL | string): boolean {
    return sameUrl(r, this.resource) || sameUrl(r, this.issuer);
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (params.resource && !this.isOurResource(params.resource)) {
      throw new InvalidTargetError("Цей сервер видає доступ лише до власного MCP-ендпоінта");
    }
    const p: AuthorizeParams = {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes ?? [],
      resource: params.resource?.href,
    };
    renderLogin(res, p, client.client_name ?? null);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const row = await prisma.mcpAuthCode.findUnique({
      where: { codeHash: hashToken(code) },
      select: { clientId: true, codeChallenge: true },
    });
    if (!row || row.clientId !== client.client_id) throw new InvalidGrantError("Невідомий код авторизації");
    return row.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const row = await prisma.mcpAuthCode.findUnique({ where: { codeHash: hashToken(code) } });
    if (!row || row.clientId !== client.client_id) throw new InvalidGrantError("Невідомий код авторизації");

    // Позначаємо використаним ДО решти перевірок і атомарно: два паралельні
    // обміни одного коду не отримають дві пари токенів.
    const claimed = await prisma.mcpAuthCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(row.familyId);
      throw new InvalidGrantError("Код уже використано — доступ за ним відкликано");
    }
    if (row.expiresAt < new Date()) throw new InvalidGrantError("Код прострочено");
    if (redirectUri !== undefined && redirectUri !== row.redirectUri) {
      throw new InvalidGrantError("redirect_uri не збігається з тим, що був у запиті авторизації");
    }
    if (resource && row.resource && !sameUrl(resource, row.resource)) {
      throw new InvalidGrantError("resource не збігається з тим, що був у запиті авторизації");
    }
    await this.requireAdmin(row.userId, InvalidGrantError);
    return this.issuePair(row.familyId, client.client_id, row.userId, row.scopes, row.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const row = await prisma.mcpToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    if (!row || row.kind !== "REFRESH") throw new InvalidGrantError("Невідомий refresh-токен");
    if (row.clientId !== client.client_id) {
      // Чужий клієнт із нашим refresh — токен витік.
      await this.revokeFamily(row.familyId);
      throw new InvalidGrantError("Невідомий refresh-токен");
    }
    if (row.revokedAt) throw new InvalidGrantError("Доступ відкликано — увійдіть знову");

    // Строго, без «вікна на повтор»: повторно пред'явлений refresh — це або
    // крадіжка, або подвійне оновлення з клієнта; в обох випадках надійніше
    // попросити людину увійти знову, ніж лишити вкраденому шанс.
    const claimed = await prisma.mcpToken.updateMany({
      where: { id: row.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(row.familyId);
      throw new InvalidGrantError("Refresh-токен уже використано — доступ відкликано, увійдіть знову");
    }
    if (row.expiresAt < new Date()) throw new InvalidGrantError("Refresh-токен прострочено — увійдіть знову");
    if (resource && row.resource && !sameUrl(resource, row.resource)) {
      throw new InvalidGrantError("resource не збігається з виданим");
    }
    let granted = row.scopes;
    if (scopes?.length) {
      if (!scopes.every((s) => row.scopes.includes(s))) throw new InvalidScopeError("Не можна розширити область доступу оновленням");
      granted = scopes;
    }
    await this.requireAdmin(row.userId, InvalidGrantError);
    return this.issuePair(row.familyId, client.client_id, row.userId, granted, row.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await prisma.mcpToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { role: true, name: true, email: true } } },
    });
    const now = new Date();
    // Повідомлення invalid_token — лише ASCII: SDK кладе їх у заголовок
    // WWW-Authenticate, а кирилиця там валить Node (ERR_INVALID_CHAR) — і
    // замість 401, на який Claude/ChatGPT запускають повторний вхід, виходить 500.
    if (!row || row.kind !== "ACCESS" || row.revokedAt || row.expiresAt < now) {
      throw new InvalidTokenError("Invalid or expired token");
    }
    if (row.resource && !this.isOurResource(row.resource)) throw new InvalidTokenError("Token was issued for another resource");
    if (!(MCP_ROLES as readonly string[]).includes(row.user.role)) throw new InvalidTokenError("Access denied");

    // Для ока адміна («коли востаннє ходив Claude»), не частіше разу на хвилину.
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
      void prisma.mcpToken.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => {});
    }

    const extra: McpAuthExtra = {
      userId: row.userId,
      userName: row.user.name ?? row.user.email,
      familyId: row.familyId,
    };
    return {
      token,
      clientId: row.clientId,
      scopes: row.scopes,
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
      resource: row.resource ? new URL(row.resource) : undefined,
      extra,
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const row = await prisma.mcpToken.findUnique({
      where: { tokenHash: hashToken(request.token) },
      select: { clientId: true, familyId: true },
    });
    // RFC 7009: на невідомий чи чужий токен — мовчки 200.
    if (!row || row.clientId !== client.client_id) return;
    await this.revokeFamily(row.familyId);
  }

  /** Гасить підключення цілком: токени й ще не обміняні коди родини. */
  async revokeFamily(familyId: string): Promise<void> {
    const now = new Date();
    await prisma.$transaction([
      prisma.mcpToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } }),
      prisma.mcpAuthCode.updateMany({ where: { familyId, usedAt: null }, data: { usedAt: now } }),
    ]);
  }

  private async requireAdmin(userId: string, Err: new (message: string) => Error): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || !(MCP_ROLES as readonly string[]).includes(user.role)) throw new Err("Немає доступу");
  }

  private async issuePair(
    familyId: string,
    clientId: string,
    userId: string,
    scopes: string[],
    resource: string | null
  ): Promise<OAuthTokens> {
    const access = newToken("bmcp_at");
    const refresh = newToken("bmcp_rt");
    const now = Date.now();
    await prisma.mcpToken.createMany({
      data: [
        {
          kind: "ACCESS",
          tokenHash: hashToken(access),
          familyId,
          clientId,
          userId,
          scopes,
          resource,
          expiresAt: new Date(now + ACCESS_TTL_S * 1000),
        },
        {
          kind: "REFRESH",
          tokenHash: hashToken(refresh),
          familyId,
          clientId,
          userId,
          scopes,
          resource,
          expiresAt: new Date(now + REFRESH_TTL_S * 1000),
        },
      ],
    });
    void prisma.mcpClient.update({ where: { id: clientId }, data: { lastUsedAt: new Date(now) } }).catch(() => {});
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      scope: scopes.join(" ") || undefined,
    };
  }
}
