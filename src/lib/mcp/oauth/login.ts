/**
 * POST /login — адмін ввів email і пароль на сторінці згоди (login-page.ts).
 *
 * Параметри авторизації приходять підписаними (signed.ts) — їх перевірив SDK
 * на GET /authorize, і підмінити їх між двома запитами не можна. Далі:
 * стеля спроб → пароль і роль → одноразовий код → редирект назад у
 * claude.ai / ChatGPT з code, state та iss (RFC 9207: клієнт звіряє, що код
 * прийшов саме від нашого сервера).
 */

import type { Request, RequestHandler, Response } from "express";
import { rateLimit } from "@/lib/shop/rate-limit";
import { renderLogin } from "@/lib/mcp/oauth/login-page";
import { BudvikOAuthProvider, checkAdminLogin, issueCode } from "@/lib/mcp/oauth/provider";
import { isAllowedRedirect } from "@/lib/mcp/oauth/redirects";
import { verifyParams } from "@/lib/mcp/oauth/signed";

/** 5 спроб на 15 хвилин для пари «адреса + email»: підбір пароля, а не опечатка. */
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_S = 900;

const field = (req: Request, name: string): string => {
  const v = (req.body as Record<string, unknown> | undefined)?.[name];
  return typeof v === "string" ? v : "";
};

export function makeLoginHandler(provider: BudvikOAuthProvider): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      const p = verifyParams(field(req, "req"));
      if (!p) {
        res
          .status(400)
          .type("text/plain; charset=utf-8")
          .send("Форма входу застаріла. Почніть підключення в Claude чи ChatGPT заново.");
        return;
      }
      const client = await provider.clientsStore.getClient(p.clientId);
      if (!client || !isAllowedRedirect(p.redirectUri)) {
        res.status(400).type("text/plain; charset=utf-8").send("Невідомий застосунок.");
        return;
      }
      const name = client.client_name ?? null;
      const email = field(req, "email");
      const password = field(req, "password");

      const limit = await rateLimit(`mcp-login:${req.ip ?? "unknown"}:${email.trim().toLowerCase()}`, LOGIN_LIMIT, LOGIN_WINDOW_S);
      if (!limit.allowed) {
        renderLogin(res, p, name, "Забагато спроб. Спробуйте за 15 хвилин.", 429);
        return;
      }

      const who = await checkAdminLogin(email, password);
      if (!who) {
        renderLogin(res, p, name, "Невірний email або пароль, або немає доступу.", 401);
        return;
      }

      const code = await issueCode(p, who.userId);
      const back = new URL(p.redirectUri);
      back.searchParams.set("code", code);
      if (p.state) back.searchParams.set("state", p.state);
      back.searchParams.set("iss", provider.issuer.href);
      console.log(`[mcp] вхід: ${who.name} → ${name ?? back.host}`);
      res.set("Cache-Control", "no-store").redirect(302, back.href);
    } catch (e) {
      console.error("[mcp] /login упав:", e);
      res.status(500).type("text/plain; charset=utf-8").send("Помилка сервера. Спробуйте ще раз.");
    }
  };
}
