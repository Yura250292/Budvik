/**
 * Куди OAuth-сервер MCP погоджується повертати код авторизації.
 *
 * Реєстрація клієнтів відкрита (DCR — інакше claude.ai і ChatGPT не
 * підключаться), тож без цього списку будь-хто зареєстрував би «клієнта» з
 * редиректом на свій сайт, підсунув адміну посилання на вхід і забрав би код.
 * Тому редирект — лише на хости самих Claude і ChatGPT, плюс loopback для
 * Claude Code на машині людини.
 */

/** Claude: шлях фіксований (claude.com — запасний домен, про який попереджає Anthropic). */
const CLAUDE_HOSTS = new Set(["claude.ai", "claude.com"]);
const CLAUDE_PATH = "/api/mcp/auth_callback";

/** ChatGPT: шлях буває різний — він генерує свій callback на кожне підключення. */
const OPENAI_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

/** Claude Code слухає на випадковому порту (RFC 8252). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function isAllowedRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.username || u.password || u.hash) return false;

  if (u.protocol === "https:") {
    if (CLAUDE_HOSTS.has(u.hostname)) return u.pathname === CLAUDE_PATH && !u.port;
    if (OPENAI_HOSTS.has(u.hostname)) return !u.port;
    return false;
  }
  if (u.protocol === "http:") return LOOPBACK_HOSTS.has(u.hostname);
  return false;
}
