"use client";

/**
 * Стан однієї розмови: надіслати, прийняти потік, зупинити, повторити.
 *
 * Три речі, які тут не очевидні.
 *
 * ПОДІЯ drop. Модель часто починає раунд словами «зараз подивлюся борги» і
 * лише потім замовляє інструмент. Показати це корисно — видно, що вона не
 * зависла, — але лишати не можна: далі прийде справжня відповідь. Сервер
 * надсилає drop, і накопичений текст скидається.
 *
 * СТОРОЖ. Стиснення на Vercel (next.config: compress) може накопичити
 * потік і віддати одним шматком у кінці. Якщо подій немає хвилину —
 * перериваємо й перепитуємо історію: відповідь у базі вже є, навіть якщо
 * до нас вона не доїхала.
 *
 * ЗЛИТТЯ ПО КАДРАХ. Кожна дельта — кілька символів; перемальовувати дерево
 * маркдауна 60 разів на секунду телефон не встигає. Накопичуємо в ref і
 * віддаємо в стан раз на кадр.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, createThread, type ToolTrace, type UiMessage } from "./api";
import { readSse } from "./sse";
import { COPY, NETWORK_ERROR, STALL_ERROR, errorCopy } from "./copy";

/** Скільки чекати подій, перш ніж вважати потік зависшим. */
const STALL_MS = 60_000;
/** Скільки й з якою частотою перепитувати історію після зависання. */
const POLL_EVERY_MS = 3_000;
const POLL_FOR_MS = 90_000;

export type StreamState = {
  text: string;
  tools: Array<ToolTrace & { done: boolean }>;
  startedAt: number;
} | null;

export function useAssistantThread(threadId: string | null) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState<StreamState>(null);
  const [error, setError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const bufferRef = useRef("");
  const frameRef = useRef<number | null>(null);
  const lastEventRef = useRef(0);
  const lastSentRef = useRef<string | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    const text = bufferRef.current;
    setStream((s) => (s ? { ...s, text } : s));
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  /** Історія розмови з сервера — джерело правди після кожного ходу. */
  const reload = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/sales/assistant/threads/${id}`);
        if (!res.ok) {
          if (res.status === 404) setMessages([]);
          return;
        }
        const body = (await res.json()) as { messages: UiMessage[] };
        setMessages(body.messages);
      } catch {
        // Мовчки: показане на екрані лишається, а наступна спроба буде.
      }
    },
    []
  );

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    void reload(threadId).finally(() => setLoading(false));
  }, [threadId, reload]);

  /** Зупинити потік: при виході з екрана й на кнопку «Зупинити». */
  const abort = useCallback((reason: "user" | "unmount" | "stall") => {
    controllerRef.current?.abort(reason);
    controllerRef.current = null;
  }, []);

  useEffect(() => () => abort("unmount"), [abort]);

  const send = useCallback(
    async (text: string, opts: { repId?: string | null; counterpartyId?: string | null } = {}) => {
      const trimmed = text.trim();
      if (!trimmed || stream) return;

      setError(null);
      lastSentRef.current = trimmed;

      let id = threadId;
      if (!id) {
        try {
          id = await createThread(opts.repId);
        } catch (e) {
          setError(e instanceof ApiError ? errorCopy(e.status, e.message) : NETWORK_ERROR);
          return;
        }
        // Адресу міняє екран — тут лише повідомляємо, який діалог створено.
        window.dispatchEvent(new CustomEvent("assistant:thread", { detail: id }));
      }

      const optimistic: UiMessage = {
        id: `local-${Date.now()}`,
        role: "USER",
        content: trimmed,
        createdAt: new Date().toISOString(),
        tools: [],
        pending: true,
      };
      setMessages((prev) => [...prev, optimistic]);

      bufferRef.current = "";
      lastEventRef.current = Date.now();
      setStream({ text: "", tools: [], startedAt: Date.now() });

      const controller = new AbortController();
      controllerRef.current = controller;

      const watchdog = setInterval(() => {
        if (Date.now() - lastEventRef.current > STALL_MS) {
          clearInterval(watchdog);
          abort("stall");
        }
      }, 5_000);

      try {
        const res = await fetch(`/api/sales/assistant/threads/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: trimmed,
            ...(opts.counterpartyId ? { counterpartyId: opts.counterpartyId } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new ApiError(res.status, body?.error ?? "");
        }

        let failure: string | null = null;

        await readSse(
          res,
          (e) => {
            lastEventRef.current = Date.now();
            if (e.event === "tool_start") {
              const d = e.data as ToolTrace & { id: string };
              setStream((s) =>
                s ? { ...s, tools: [...s.tools, { ...d, ms: null, done: false }] } : s
              );
            } else if (e.event === "tool_done") {
              const d = e.data as { name: string; ms: number };
              setStream((s) =>
                s
                  ? {
                      ...s,
                      tools: s.tools.map((t) =>
                        t.name === d.name && !t.done ? { ...t, done: true, ms: d.ms } : t
                      ),
                    }
                  : s
              );
            } else if (e.event === "drop") {
              bufferRef.current = "";
              schedule();
            } else if (e.event === "delta") {
              bufferRef.current += (e.data as { text: string }).text;
              schedule();
            } else if (e.event === "error") {
              failure = (e.data as { message: string }).message;
            }
          },
          controller.signal
        );

        clearInterval(watchdog);
        if (failure) setError(failure);
        await reload(id);
      } catch (e) {
        clearInterval(watchdog);

        if (controller.signal.aborted) {
          const reason = String(controller.signal.reason ?? "");
          if (reason === "stall") {
            await pollForAnswer(id, reload, () => setError(STALL_ERROR));
          } else if (reason === "user") {
            setError(COPY.stopped);
            await reload(id);
          }
        } else if (e instanceof ApiError) {
          setError(errorCopy(e.status, e.message));
          setMessages((prev) =>
            prev.map((m) => (m.id === optimistic.id ? { ...m, pending: false, failed: true } : m))
          );
        } else {
          setError(NETWORK_ERROR);
          setMessages((prev) =>
            prev.map((m) => (m.id === optimistic.id ? { ...m, pending: false, failed: true } : m))
          );
        }
      } finally {
        controllerRef.current = null;
        if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        bufferRef.current = "";
        setStream(null);
      }
    },
    [threadId, stream, abort, reload, schedule]
  );

  const retry = useCallback(
    (opts: Parameters<typeof send>[1] = {}) => {
      const text = lastSentRef.current;
      if (!text) return;
      setMessages((prev) => prev.filter((m) => !m.failed));
      void send(text, opts);
    },
    [send]
  );

  return {
    messages,
    loading,
    stream,
    error,
    send,
    retry,
    stop: () => abort("user"),
    clearError: () => setError(null),
    reload,
  };
}

/**
 * Потік обірвався, але хід на сервері міг дописатися — перепитуємо історію.
 *
 * Саме тому кнопка «Зупинити» чесно каже, що відповідь може зʼявитися: хід
 * не скасовується разом зі з'єднанням, і платити за нього вже довелося.
 */
async function pollForAnswer(
  threadId: string,
  reload: (id: string) => Promise<void>,
  onGiveUp: () => void
) {
  const until = Date.now() + POLL_FOR_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    try {
      const res = await fetch(`/api/sales/assistant/threads/${threadId}`);
      if (!res.ok) continue;
      const body = (await res.json()) as { messages: UiMessage[] };
      const last = body.messages[body.messages.length - 1];
      if (last?.role === "ASSISTANT") {
        await reload(threadId);
        return;
      }
    } catch {
      // Немає звʼязку — спробуємо наступного разу.
    }
  }
  onGiveUp();
}
