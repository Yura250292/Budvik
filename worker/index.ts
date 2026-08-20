/**
 * Воркер обміну з 1С — приймає дані від агента замість Vercel.
 *
 * Навіщо: агент штовхає дані кожні 5 хвилин (~5 500 викликів на добу), і на
 * Vercel кожен із них — платний виклик функції плюс трафік від бази через
 * публічний інтернет. Тут же воркер стоїть у тому самому приватному контурі
 * Railway, що й Postgres: запис у базу не коштує ні викликів, ні егресу.
 *
 * Уся логіка спільна з маршрутами Next (`@/lib/sync-ingest/handlers`) — це не
 * копія, а той самий код. Різниця одна: скидання кешу вітрини можливе лише
 * всередині Next, тому воркер просить про це сайт (див. `bustCacheRemotely`).
 *
 * Відкат на Vercel: повернути старий `ingest.url` у конфізі агента на сервері
 * 1С. Маршрути `/api/sync-ingest/*` на сайті лишаються робочими.
 */

import http from "node:http";
import { prisma } from "@/lib/prisma";
import { signPayload, SYNC_HEADERS } from "@/lib/sync-ingest/auth";
import { getSyncState, setSyncState } from "@/lib/sync-ingest/context";
import {
  handleBatch,
  handleCompleteRun,
  handleHealth,
  handleStartRun,
  type IngestDeps,
} from "@/lib/sync-ingest/handlers";
import { alertAgentSilent } from "@/lib/sync-ingest/alerts";
import { SYNC_STATE_KEYS } from "@/lib/sync-ingest/types";

const PORT = Number(process.env.PORT) || 3001;

/** Скільки годин мовчання агента вважати аварією. Норма — прогін раз на 5 хвилин. */
const SILENT_HOURS = 2;
/** Як часто перевіряти, чи живий агент. */
const SILENCE_CHECK_INTERVAL_MS = 15 * 60_000;
/** Не повторювати сповіщення про мовчання частіше, ніж раз на стільки. */
const SILENT_ALERT_COOLDOWN_MS = 6 * 60 * 60_000;

// ========== Скидання кешу вітрини через сайт ==========

/**
 * Просить сайт скинути кеш вітрини.
 *
 * Підпис той самий, що й в агента: секрет спільний, окремий заводити не було б
 * за що. Тротл — у `handleCompleteRun` (стан у Postgres), тому сюди приходить
 * не частіше разу на 15 хвилин.
 *
 * `SITE_REVALIDATE_URL` мусить вести на `/api/sync-ingest/revalidate`: лише цей
 * префікс звільнено від бот-челенджу у фаєрволі Vercel, решта шляхів віддає
 * машині сторінку «Vercel Security Checkpoint» із кодом 429.
 */
async function bustCacheRemotely(): Promise<void> {
  const url = process.env.SITE_REVALIDATE_URL;
  const agentId = process.env.SYNC_AGENT_ID;
  const secret = process.env.SYNC_AGENT_SECRET;

  if (!url || !agentId || !secret) {
    throw new Error("SITE_REVALIDATE_URL / SYNC_AGENT_ID / SYNC_AGENT_SECRET не налаштовані");
  }

  const rawBody = JSON.stringify({ scope: "storefront" });
  const timestamp = String(Math.floor(Date.now() / 1000));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SYNC_HEADERS.agent]: agentId,
      [SYNC_HEADERS.timestamp]: timestamp,
      [SYNC_HEADERS.signature]: signPayload(secret, timestamp, rawBody),
    },
    body: rawBody,
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`Сайт відповів ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

const deps: IngestDeps = { bustCache: bustCacheRemotely };

// ========== Міст між node:http і Web Request ==========

/**
 * Збирає стандартний `Request` із запиту node:http.
 *
 * Тіло читається в буфер цілком і передається як є: підпис HMAC рахується від
 * сирих байтів, тому жодних перетворень тут бути не може.
 */
async function toWebRequest(req: http.IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }

  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(`http://localhost${req.url ?? "/"}`, {
    method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

async function sendWebResponse(res: http.ServerResponse, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(body);
}

// ========== Маршрутизація ==========

const COMPLETE_PATH = /^\/api\/sync-ingest\/runs\/([^/]+)\/complete$/;

async function route(req: Request, pathname: string): Promise<Response> {
  const method = req.method;

  if (method === "POST" && pathname === "/api/sync-ingest/runs") {
    return handleStartRun(req);
  }
  if (method === "POST" && pathname === "/api/sync-ingest/batch") {
    return handleBatch(req);
  }
  if (method === "GET" && pathname === "/api/sync-ingest/health") {
    return handleHealth(req);
  }

  const complete = COMPLETE_PATH.exec(pathname);
  if (method === "POST" && complete) {
    return handleCompleteRun(req, decodeURIComponent(complete[1]), deps);
  }

  // Перевірка живості для Railway — без бази й без підпису, інакше падіння
  // Postgres перезапускало б справний контейнер по колу.
  if (method === "GET" && (pathname === "/" || pathname === "/healthz")) {
    return Response.json({ ok: true, service: "budvik-sync-worker" });
  }

  return Response.json({ error: "Невідомий маршрут" }, { status: 404 });
}

const server = http.createServer((req, res) => {
  void (async () => {
    const started = Date.now();
    const pathname = (req.url ?? "/").split("?")[0];

    try {
      const request = await toWebRequest(req);
      const response = await route(request, pathname);
      await sendWebResponse(res, response);

      if (pathname !== "/" && pathname !== "/healthz") {
        console.log(`${req.method} ${pathname} → ${response.status} за ${Date.now() - started}мс`);
      }
    } catch (e) {
      console.error(`worker: ${req.method} ${pathname} впав`, e);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "Внутрішня помилка воркера" }));
    }
  })();
});

// ========== Сторож мовчазного агента ==========

/**
 * Помічає, що агент перестав приходити.
 *
 * На Vercel такої перевірки не існувало в принципі: функція живе лише під час
 * запиту, а тут перевіряти треба саме ВІДСУТНІСТЬ запитів. У постійному
 * процесі це звичайний таймер — і `alertAgentSilent`, написаний рік тому й
 * ніколи не викликаний, нарешті має звідки спрацювати.
 */
async function checkAgentSilence(): Promise<void> {
  try {
    const lastSeen = await getSyncState(SYNC_STATE_KEYS.agentLastSeen);
    if (!lastSeen) return;

    const lastSeenMs = Date.parse(lastSeen);
    if (!Number.isFinite(lastSeenMs)) return;

    const silentMs = Date.now() - lastSeenMs;
    if (silentMs < SILENT_HOURS * 60 * 60_000) return;

    const lastAlert = await getSyncState(SYNC_STATE_KEYS.lastSilentAlert);
    const lastAlertMs = lastAlert ? Date.parse(lastAlert) : 0;
    if (Number.isFinite(lastAlertMs) && Date.now() - lastAlertMs < SILENT_ALERT_COOLDOWN_MS) return;

    await alertAgentSilent(new Date(lastSeenMs), Math.floor(silentMs / 3_600_000));
    await setSyncState(SYNC_STATE_KEYS.lastSilentAlert, new Date().toISOString());
  } catch (e) {
    console.error("worker: перевірка мовчання агента впала", e);
  }
}

const silenceTimer = setInterval(() => void checkAgentSilence(), SILENCE_CHECK_INTERVAL_MS);

// ========== Старт і зупинка ==========

server.listen(PORT, () => {
  console.log(`Воркер обміну з 1С слухає порт ${PORT}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} — зупиняюсь`);
    clearInterval(silenceTimer);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    // Railway дає 30 секунд; довгий батч не має тримати контейнер вічно.
    setTimeout(() => process.exit(0), 25_000).unref();
  });
}
