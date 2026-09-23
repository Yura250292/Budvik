/**
 * Сторінка входу й згоди, яку бачить адмін, коли підключає Budvik у
 * claude.ai чи ChatGPT.
 *
 * Специфікація MCP вимагає показати, КУДИ піде доступ: назва клієнта
 * вигадується тим, хто реєструється, тож поруч — хост редиректу, його
 * підробити не можна (білий список, redirects.ts).
 *
 * Жодних зовнішніх ресурсів: сторінка живе на сервері MCP, а не на сайті.
 */

import type { Response } from "express";
import { signParams, type AuthorizeParams } from "@/lib/mcp/oauth/signed";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

export function renderLogin(
  res: Response,
  p: AuthorizeParams,
  clientName: string | null,
  error?: string,
  status = 200
): void {
  const host = hostOf(p.redirectUri);
  const who = clientName ? `${esc(clientName)} (${esc(host)})` : esc(host);
  const html = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Budvik — доступ для AI-застосунку</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f5f2; --card:#fff; --text:#1c1b19; --muted:#6b6862; --line:#e3e0da; --accent:#f5c518; --err:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161513; --card:#201f1c; --text:#f1efe9; --muted:#a19d95; --line:#34322d; --err:#f2b8b5; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width:100%; max-width:400px; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:28px 24px; }
  h1 { font-size:20px; margin:0 0 6px; }
  p { margin:0 0 16px; color:var(--muted); font-size:14px; }
  .who { color:var(--text); font-weight:600; word-break:break-word; }
  label { display:block; font-size:13px; color:var(--muted); margin:14px 0 6px; }
  input { width:100%; padding:11px 12px; font:inherit; color:inherit; background:transparent; border:1px solid var(--line); border-radius:10px; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  button { margin-top:20px; width:100%; padding:12px; font:inherit; font-weight:600; border:0; border-radius:10px; background:var(--accent); color:#1c1b19; cursor:pointer; }
  .err { color:var(--err); font-size:14px; margin:12px 0 0; }
  .note { margin-top:18px; font-size:12px; }
</style>
</head>
<body>
<main>
  <h1>Доступ до даних Budvik</h1>
  <p><span class="who">${who}</span> просить доступ <b>лише на читання</b> даних фірми: продажі, борги, склад, логістика.</p>
  <form method="post" action="/login" autocomplete="on">
    <input type="hidden" name="req" value="${esc(signParams(p))}">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required autofocus>
    <label for="password">Пароль сайту</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
    <button type="submit">Увійти й дозволити</button>
  </form>
  <p class="note">Вхід лише для адміністратора. Відключити доступ можна в профілі на сайті.</p>
</main>
</body>
</html>`;
  res
    .status(status)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Сторінку з паролем не вбудовують у чужі фрейми (clickjacking).
      "X-Frame-Options": "DENY",
      // Без form-action: Chrome застосовує його й до редиректу після POST,
      // а ми після входу якраз ведемо на claude.ai / chatgpt.com.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    })
    .send(html);
}
