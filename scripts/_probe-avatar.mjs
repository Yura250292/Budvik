/**
 * Проба завантаження аватарки по локальному dev-серверу.
 * Сесія підробляється для НЕІСНУЮЧОГО користувача — база не змінюється.
 * Запускати з кореня: node --env-file=.env scripts/_probe-avatar.mjs
 */
import { readFileSync } from "node:fs";
import { encode } from "next-auth/jwt";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";
const jpg = readFileSync(process.argv[2]);

const tok = await encode({
  token: { sub: "probe-avatar", id: "probe-avatar", email: "probe@budvik.local", name: "Проба", role: "SALES" },
  secret: process.env.NEXTAUTH_SECRET,
});
const cookie = `next-auth.session-token=${tok}`;

async function post(label, body, contentType) {
  const headers = { cookie };
  if (contentType) headers["content-type"] = contentType;
  const res = await fetch(`${BASE}/api/account/avatar`, { method: "POST", headers, body });
  const text = await res.text();
  let msg;
  try {
    const j = JSON.parse(text);
    msg = j.error ?? j.avatarUrl ?? text;
  } catch {
    msg = text.slice(0, 90).replace(/\s+/g, " ");
  }
  console.log(`${String(res.status).padEnd(4)} ${label.padEnd(34)} ${msg}`);
}

// Той самий зламаний запит, що прилетів у прод 10.09: multipart без boundary.
const B = "budvikprobe";
const broken = Buffer.concat([
  Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
  jpg,
  Buffer.from(`\r\n--${B}--\r\n`),
]);

const form = new FormData();
form.set("file", new File([jpg], "a.jpg", { type: "image/jpeg" }));

await post("сире тіло, jpg", jpg, "image/jpeg");
await post("сире тіло, порожній тип", jpg, "application/octet-stream");
await post("multipart БЕЗ boundary (та сама аварія)", broken, `multipart/form-data`);
await post("multipart з boundary (стара збірка)", broken, `multipart/form-data; boundary=${B}`);
await post("не зображення", Buffer.from("%PDF-1.7 не картинка ...........", "latin1"), "application/pdf");
await post("порожнє тіло", Buffer.alloc(0), "image/jpeg");
await post("завелике (3 МБ)", Buffer.concat([jpg, Buffer.alloc(3 * 1024 * 1024)]), "image/jpeg");
