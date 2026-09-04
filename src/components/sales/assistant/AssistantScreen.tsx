"use client";

/**
 * Екран помічника: одна видима розмова, історія — листом знизу.
 *
 * Чому не список розмов окремою сторінкою: на телефоні це зайвий крок
 * назад щоразу, коли людина просто хоче спитати. Ідентифікатор розмови
 * живе в адресі (?t=), тож перехід у картку клієнта й «назад» повертає в
 * той самий діалог.
 *
 * Розкладка фіксованим шаром, як на карті: шапка й поле вводу не мають
 * їхати разом зі стрічкою, а нижня межа — це панель вкладок, під яку не
 * можна залазити.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { History, SquarePen, X } from "lucide-react";
import useSWR from "swr";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { TAB_BAR_SPACE } from "@/components/cabinet/TabBar";
import { useProfile } from "@/lib/useProfile";
import { useAssistantThread } from "./useAssistantThread";
import { Composer, ErrorRow, MessageBubble, QuickPrompts, ThinkingRow } from "./parts";
import AssistantMarkdown from "./AssistantMarkdown";
import ThreadsSheet from "./ThreadsSheet";
import { deleteThread as deleteThreadApi, type ThreadSummary } from "./api";
import { CLIENT_PROMPTS, COPY, DRIVER_PROMPTS, QUICK_PROMPTS } from "./copy";

type ThreadsResponse = { threads: ThreadSummary[]; reps: Array<{ id: string; name: string }>; isOffice: boolean };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Ключ чернетки — окремий на кожну розмову, щоб вони не змішувались. */
const draftKey = (threadId: string | null) => `budvik.assistant.draft.${threadId ?? "new"}`;

export default function AssistantScreen({
  section,
  threadId,
  clientId,
  clientName,
  repId,
}: {
  /** У якому кабінеті відкрито: від цього залежить «назад» і власна адреса. */
  section: "sales" | "driver";
  threadId: string | null;
  clientId: string | null;
  clientName: string | null;
  repId: string | null;
}) {
  const router = useRouter();
  const profile = useProfile();
  const base = section === "driver" ? "/driver/assistant" : "/sales/assistant";
  const home = section === "driver" ? "/driver" : "/sales";
  const [draft, setDraft] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: meta, mutate: reloadThreads } = useSWR<ThreadsResponse>(
    "/api/sales/assistant/threads",
    fetcher,
    { revalidateOnFocus: false }
  );

  const { messages, stream, error, send, retry, stop, clearError } = useAssistantThread(threadId);

  /** Адресу міняє екран: хук лише повідомляє, який діалог створено. */
  useEffect(() => {
    const onCreated = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const params = new URLSearchParams();
      params.set("t", id);
      if (clientId) params.set("client", clientId);
      if (clientName) params.set("name", clientName);
      if (repId) params.set("rep", repId);
      router.replace(`${base}?${params}`, { scroll: false });
      void reloadThreads();
    };
    window.addEventListener("assistant:thread", onCreated);
    return () => window.removeEventListener("assistant:thread", onCreated);
  }, [router, base, clientId, clientName, repId, reloadThreads]);

  /**
   * Чернетку читаємо ПІСЛЯ монтування.
   *
   * localStorage на сервері немає, а читання в початковому стані дало б
   * розбіжність розмітки при гідратації. Правило про setState в ефекті тут
   * і описує саме цей дозволений випадок — підписку на зовнішнє сховище, —
   * але відрізнити його від каскадного перерендеру лінтер не вміє.
   */
  useEffect(() => {
    let value = "";
    try {
      value = localStorage.getItem(draftKey(threadId)) ?? "";
    } catch {
      value = "";
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(value);
  }, [threadId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (draft) localStorage.setItem(draftKey(threadId), draft);
        else localStorage.removeItem(draftKey(threadId));
      } catch {
        // Приватне вікно або заблоковане сховище — чернетка просто не збережеться.
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, threadId]);

  /** Стрічка тримається низу, поки людина сама не відгорнула її вгору. */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom || stream) el.scrollTop = el.scrollHeight;
  }, [messages, stream]);

  const submit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      clearError();
      setDraft("");
      try {
        localStorage.removeItem(draftKey(threadId));
      } catch {
        // не критично
      }
      void send(text, { repId, counterpartyId: clientId });
    },
    [send, repId, clientId, threadId, clearError]
  );

  const prompts = useMemo(
    () =>
      clientName
        ? CLIENT_PROMPTS(clientName)
        : section === "driver"
          ? DRIVER_PROMPTS
          : QUICK_PROMPTS,
    [clientName, section]
  );

  const isOffice = meta?.isOffice ?? false;
  const activeRep = meta?.reps.find((r) => r.id === repId);
  const subtitle = clientName
    ? COPY.clientChip(clientName)
    : activeRep
      ? `Як ${activeRep.name}`
      : (profile?.name ?? (section === "driver" ? COPY.subtitleDriver : COPY.subtitleSelf));

  const goto = (params: URLSearchParams) =>
    router.replace(`${base}${params.toString() ? `?${params}` : ""}`, { scroll: false });

  return (
    <div className="fixed inset-x-0 top-0 flex flex-col bg-cab-bg" style={{ bottom: TAB_BAR_SPACE }}>
      <SalesHeader
        title={COPY.title}
        subtitle={subtitle}
        backTo={home}
        sticky={false}
        hideAssistant
        right={
          <>
            <button
              type="button"
              aria-label={COPY.historyAria}
              onClick={() => setSheetOpen(true)}
              className="flex h-11 w-9 items-center justify-center text-cab-t2"
            >
              <History size={19} />
            </button>
            <button
              type="button"
              aria-label={COPY.newAria}
              onClick={() => goto(new URLSearchParams())}
              className="flex h-11 w-9 items-center justify-center text-cab-t2"
            >
              <SquarePen size={19} />
            </button>
          </>
        }
      />

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-3 px-4 py-3">
          {isOffice && meta && meta.reps.length > 0 && !threadId && (
            <RepPicker
              reps={meta.reps}
              value={repId}
              onChange={(id) => {
                const params = new URLSearchParams();
                if (id) params.set("rep", id);
                goto(params);
              }}
            />
          )}

          {messages.length === 0 && !stream && (
            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-cab-line bg-white p-4">
                <p className="text-[15px] font-bold text-bk">
                  {section === "driver" ? COPY.emptyTitleDriver : COPY.emptyTitle}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-cab-t2">
                  {section === "driver" ? COPY.emptyBodyDriver : COPY.emptyBody}
                </p>
              </div>
              <QuickPrompts prompts={prompts} onPick={submit} variant="list" />
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {stream && stream.text.length === 0 && (
            <ThinkingRow tools={stream.tools} startedAt={stream.startedAt} />
          )}
          {stream && stream.text.length > 0 && (
            <div className="rounded-2xl border border-cab-line bg-white p-3.5">
              <AssistantMarkdown content={stream.text} />
            </div>
          )}

          {error && (
            <ErrorRow
              message={error}
              onRetry={
                error === COPY.stopped || error.includes("Ліміт запитів")
                  ? undefined
                  : () => retry({ repId, counterpartyId: clientId })
              }
            />
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-lg">
        {clientId && clientName && (
          <div className="flex justify-start px-4 pb-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info-bg px-3 py-1.5 text-[12px] font-medium text-info-fg">
              {COPY.clientChip(clientName)}
              <button
                type="button"
                aria-label={COPY.clearClient}
                onClick={() => {
                  const params = new URLSearchParams();
                  if (threadId) params.set("t", threadId);
                  if (repId) params.set("rep", repId);
                  goto(params);
                }}
              >
                <X size={13} />
              </button>
            </span>
          </div>
        )}

        {messages.length > 0 && !stream && (
          <div className="px-4 pb-1">
            <QuickPrompts prompts={prompts} onPick={submit} />
          </div>
        )}
      </div>

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => submit(draft)}
        onStop={stop}
        busy={Boolean(stream)}
      />

      <ThreadsSheet
        open={sheetOpen}
        threads={meta?.threads ?? []}
        currentId={threadId}
        onPick={(id) => {
          setSheetOpen(false);
          const params = new URLSearchParams();
          params.set("t", id);
          goto(params);
        }}
        onNew={() => {
          setSheetOpen(false);
          goto(new URLSearchParams());
        }}
        onDelete={async (id) => {
          await deleteThreadApi(id).catch(() => {});
          void reloadThreads();
          if (id === threadId) goto(new URLSearchParams());
        }}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}

/**
 * Вибір торгового для керівника.
 *
 * Показується лише поки розмова не почалась: міняти, чиї дані читає
 * діалог, посеред нього не можна — половина реплік уже про іншу людину.
 */
function RepPicker({
  reps,
  value,
  onChange,
}: {
  reps: Array<{ id: string; name: string }>;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 rounded-2xl border border-cab-line bg-white p-3.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-cab-t2">
        Дивлюся як торговий
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-11 rounded-xl border border-cab-line bg-white px-3 text-base text-bk outline-none"
      >
        <option value="">Я сам</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
