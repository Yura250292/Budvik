"use client";

/**
 * Одна розмова: стрічка знизу вгору й поле вводу.
 *
 * Опитування раз на 5 секунд замість потоку: людей у фірмі десяток, і своє
 * зʼєднання на кожного коштувало б дорожче за сам чат. SSE тут був би
 * чесніший, але на Vercel це жива функція на кожного відкритого — при
 * десяти екранах цілий день.
 *
 * Прочитане відмічаємо міткою НАЙНОВІШОГО показаного повідомлення, а не
 * «зараз»: те, що прилетіло між завантаженням і відміткою, інакше зникло б
 * із непрочитаного, так і не побачене.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Callout } from "@/components/cabinet/ui";
import { ChatComposer } from "./ChatComposer";
import { MessageRow } from "./MessageRow";
import { CONVERSATIONS_URL } from "./ConversationList";
import { UNREAD_URL } from "./useChatUnread";
import { COPY } from "./copy";
import {
  fetcher,
  markConversationRead,
  sendMessage,
  type ChatMessage,
  type ThreadResponse,
  type UploadedPhoto,
} from "./api";

/** Швидко, але не щосекунди: у кабінеті це фонове опитування на 3G. */
const POLL_MS = 5_000;
/** В адмінці вкладки лишаються змонтованими — там частота нижча. */
const POLL_ADMIN_MS = 10_000;

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Сьогодні";
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Вчора";
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
};

export function Thread({
  conversation,
  section,
  meId,
  embedded,
}: {
  conversation: string;
  section: "sales" | "driver" | "warehouse" | "admin";
  meId: string | null;
  embedded: boolean;
}) {
  const { mutate } = useSWRConfig();
  const url = `/api/chat/messages/${conversation}`;
  const { data, error, isLoading, mutate: reload } = useSWR<ThreadResponse>(url, fetcher, {
    refreshInterval: embedded ? POLL_ADMIN_MS : POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef<string | null>(null);

  const server = useMemo(() => data?.messages ?? [], [data]);
  const serverIds = useMemo(() => new Set(server.map((m) => m.id)), [server]);
  const messages = useMemo(
    () => [...older.filter((m) => !serverIds.has(m.id)), ...server, ...pending.filter((m) => m.failed)],
    [older, server, serverIds, pending]
  );

  /** Оптимістичні зникають, щойно те саме приїхало з сервера. */
  useEffect(() => {
    if (pending.length === 0) return;
    setPending((prev) => prev.filter((p) => p.failed || !serverIds.has(p.id)));
  }, [serverIds, pending.length]);

  /** Стрічка тримається низу, поки людина сама не відгорнула її вгору. */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 250;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  /** Відмітка прочитаного — лише коли екран справді видно. */
  useEffect(() => {
    const newest = server.at(-1);
    if (!newest || markedRef.current === newest.id) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const timer = setTimeout(async () => {
      markedRef.current = newest.id;
      await markConversationRead(conversation, newest.createdAt);
      void mutate(UNREAD_URL);
      void mutate(CONVERSATIONS_URL);
    }, 1000);
    return () => clearTimeout(timer);
  }, [server, conversation, mutate]);

  const loadOlder = useCallback(async () => {
    const first = messages[0];
    if (!first) return;
    const res = (await fetcher(`${url}?before=${encodeURIComponent(first.createdAt)}`)) as ThreadResponse;
    setOlder((prev) => [...res.messages, ...prev]);
  }, [messages, url]);

  const submit = async (photos: UploadedPhoto[]) => {
    const text = draft.trim();
    if (!text && photos.length === 0) return;
    const conv = data?.conversation;
    if (!conv) return;

    const local: ChatMessage = {
      id: `local-${Date.now()}`,
      kind: "TEXT",
      text,
      quote: null,
      toAll: conv.type === "all",
      toRoles: conv.type === "role" ? [conversation.slice(5)] : [],
      toUserId: conv.userId ?? null,
      sourceSection: null,
      createdAt: new Date().toISOString(),
      author: { id: meId ?? "", name: "Ви", role: "", avatarUrl: null, color: null },
      photos: photos.map((p, i) => ({ id: `local-${i}`, url: p.url, width: p.width, height: p.height })),
      keys: [conversation],
      pending: true,
    };

    setDraft("");
    setSending(true);
    setSendError(null);
    setPending((prev) => [...prev, local]);
    try {
      await sendMessage({
        text,
        photos,
        toAll: conv.type === "all",
        toRoles: conv.type === "role" ? ([conversation.slice(5)] as never) : [],
        toUserId: conv.type === "dm" ? (conv.userId ?? null) : null,
      });
      setPending((prev) => prev.filter((p) => p.id !== local.id));
      await reload();
      void mutate(CONVERSATIONS_URL);
    } catch (e) {
      setPending((prev) => prev.map((p) => (p.id === local.id ? { ...p, pending: false, failed: true } : p)));
      setSendError(e instanceof Error ? e.message : "Не вдалося надіслати");
    } finally {
      setSending(false);
    }
  };

  const showAudience = data?.conversation.type === "journal";
  let lastDay = "";

  return (
    <>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto flex w-full ${embedded ? "max-w-3xl" : "max-w-lg"} flex-col gap-2 px-4 py-3`}>
          {isLoading && messages.length === 0 && <p className="py-6 text-center text-sm text-cab-t3">{COPY.loading}</p>}
          {!!error && <Callout title="Не вдалося завантажити розмову" tone="bad">{String(error.message ?? error)}</Callout>}

          {data?.hasMore && (
            <button
              type="button"
              onClick={() => void loadOlder()}
              className="mx-auto rounded-full border border-cab-line bg-white px-3.5 py-2 text-[13px] font-medium text-cab-t2"
            >
              {COPY.earlier}
            </button>
          )}

          {!isLoading && messages.length === 0 && (
            <div className="rounded-2xl border border-cab-line bg-white p-4">
              <p className="text-[15px] font-bold text-bk">{COPY.emptyThread}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-cab-t2">
                {data?.conversation.canWrite ? COPY.emptyThreadBody : COPY.readOnly}
              </p>
            </div>
          )}

          {messages.map((m) => {
            const day = dayLabel(m.createdAt);
            const separator = day !== lastDay ? day : null;
            lastDay = day;
            return (
              <div key={m.id} className="flex flex-col gap-2">
                {separator && (
                  <p className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-cab-t3">{separator}</p>
                )}
                <MessageRow message={m} mine={m.author.id === meId} section={section} showAudience={showAudience ?? false} />
              </div>
            );
          })}

          {!!sendError && <p className="text-center text-[12px] text-bad-fg">{sendError}</p>}
        </div>
      </div>

      <div className={`mx-auto w-full ${embedded ? "max-w-3xl" : "max-w-lg"}`}>
        {data?.conversation.canWrite === false ? (
          <div className="border-t border-cab-line bg-white px-4 py-3">
            <p className="text-center text-[12px] text-cab-t3">
              {data.conversation.type === "journal" ? COPY.journalNote : COPY.readOnly}
            </p>
          </div>
        ) : (
          <ChatComposer value={draft} onChange={setDraft} onSend={(photos) => void submit(photos)} busy={sending} />
        )}
      </div>
    </>
  );
}
