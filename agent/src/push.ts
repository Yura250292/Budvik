/**
 * Транспорт до ingest-API: підпис HMAC і повтори.
 *
 * Підпис обчислюється тим самим алгоритмом, що й перевіряється на сервері
 * (src/lib/sync-ingest/auth.ts), тому тіло запиту серіалізується РІВНО ОДИН
 * раз і далі використовується як рядок: повторний JSON.stringify міг би
 * дати інші пробіли й зламати підпис.
 */

import crypto from "node:crypto";
import type {
  BatchRequest,
  BatchResponse,
  CompleteRunRequest,
  CompleteRunResponse,
  HealthResponse,
  StartRunRequest,
  StartRunResponse,
} from "@contract";
import type { Logger } from "./log.js";

export class TransportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** true — повторювати марно (помилка конфігурації чи даних). */
    readonly permanent: boolean
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export class IngestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly agentId: string,
    private readonly secret: string,
    private readonly log: Logger
  ) {}

  private sign(timestamp: string, rawBody: string): string {
    return crypto.createHmac("sha256", this.secret).update(`${timestamp}.${rawBody}`).digest("hex");
  }

  private async request<T>(
    method: "GET" | "POST",
    pathname: string,
    payload?: unknown,
    attempt = 1
  ): Promise<T> {
    const rawBody = payload === undefined ? "" : JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    try {
      const res = await fetch(`${this.baseUrl}${pathname}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-sync-agent": this.agentId,
          "x-sync-timestamp": timestamp,
          "x-sync-signature": this.sign(timestamp, rawBody),
        },
        body: method === "GET" ? undefined : rawBody,
        signal: controller.signal,
      });

      if (res.ok) return (await res.json()) as T;

      const text = await res.text().catch(() => "");

      // 4xx (окрім 429) — проблема запиту, а не мережі: повтор не допоможе.
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      throw new TransportError(
        `ingest ${res.status}: ${text.slice(0, 300)}`,
        res.status,
        permanent
      );
    } catch (e) {
      if (e instanceof TransportError && e.permanent) throw e;

      if (attempt >= 4) throw e;

      const delayMs = Math.min(30_000, 2000 * 2 ** (attempt - 1));
      this.log.warn(
        { pathname, attempt, error: e instanceof Error ? e.message : String(e) },
        "Відправка не вдалася, повтор"
      );
      await new Promise((r) => setTimeout(r, delayMs));
      return this.request<T>(method, pathname, payload, attempt + 1);
    } finally {
      clearTimeout(timer);
    }
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/api/sync-ingest/health");
  }

  startRun(payload: StartRunRequest): Promise<StartRunResponse> {
    return this.request<StartRunResponse>("POST", "/api/sync-ingest/runs", payload);
  }

  sendBatch(batch: BatchRequest): Promise<BatchResponse> {
    return this.request<BatchResponse>("POST", "/api/sync-ingest/batch", batch);
  }

  completeRun(runId: string, payload: CompleteRunRequest): Promise<CompleteRunResponse> {
    return this.request<CompleteRunResponse>(
      "POST",
      `/api/sync-ingest/runs/${encodeURIComponent(runId)}/complete`,
      payload
    );
  }
}
