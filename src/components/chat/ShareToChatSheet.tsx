"use client";

/**
 * «Переслати в чат» — нижнім листом поверх розмови з помічником.
 *
 * Лист, а не перехід на екран чату: людина щойно щось знайшла й хоче
 * показати це колезі, не втрачаючи місця в розмові. Сам текст відповіді
 * сюди не їде — сервер бере його з бази за id, інакше «відповідь
 * помічника» можна було б вигадати.
 */

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { TAB_BAR_SPACE } from "@/components/cabinet/TabBar";
import { AudiencePicker, EMPTY_AUDIENCE, audienceChosen } from "./AudiencePicker";
import { CONVERSATIONS_URL } from "./ConversationList";
import { COPY } from "./copy";
import { fetcher, sendMessage, type Audience, type ConversationsResponse } from "./api";
import type { Section } from "./ChatScreen";

export default function ShareToChatSheet({
  open,
  section,
  messageId,
  onClose,
}: {
  open: boolean;
  section: Section;
  /** id відповіді помічника. null — листа немає. */
  messageId: string | null;
  onClose: () => void;
}) {
  const { mutate } = useSWRConfig();
  const { data } = useSWR<ConversationsResponse>(open ? CONVERSATIONS_URL : null, fetcher, {
    revalidateOnFocus: false,
  });
  const [audience, setAudience] = useState<Audience>(EMPTY_AUDIENCE);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!open || !messageId) return null;

  const close = () => {
    setAudience(EMPTY_AUDIENCE);
    setComment("");
    setError(null);
    setSentTo(null);
    onClose();
  };

  const submit = async () => {
    if (!audienceChosen(audience)) {
      setError(COPY.pickAudience);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await sendMessage({
        ...audience,
        text: comment.trim(),
        sourceAssistantMessageId: messageId,
        sourceSection: section,
      });
      void mutate(CONVERSATIONS_URL);
      void mutate("/api/chat/unread");
      setSentTo(res.conversation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося надіслати");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Панель вкладок має z-50 — лист мусить бути вище. */}
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={close} />
      {/*
        Відступ знизу — на панель вкладок, а не лише на виріз екрана.
        Список людей довший за екран, і кнопка «Надіслати» в кінці прокрутки
        опинялась рівно під плаваючою панеллю: видима, але не натискна.
      */}
      <div
        className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[80vh] flex-col rounded-t-2xl bg-white"
        style={{ paddingBottom: TAB_BAR_SPACE }}
      >
        <div className="flex items-center justify-between border-b border-cab-line px-4 py-3">
          <span className="text-[15px] font-bold text-bk">{COPY.forwardTitle}</span>
          <button type="button" onClick={close} aria-label="Закрити" className="flex h-11 w-11 items-center justify-center text-cab-t2">
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {sentTo ? (
            <div className="flex flex-col gap-3 py-4 text-center">
              <p className="text-[15px] font-bold text-bk">✅ {COPY.sent}</p>
              <Link
                href={`/${section}/chat/${sentTo}`}
                className="flex h-11 items-center justify-center rounded-xl bg-bk px-4 text-[14px] font-semibold text-white"
              >
                Відкрити розмову
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {!!error && <p className="text-[13px] text-bad-fg">{error}</p>}
              {data ? (
                <AudiencePicker
                  value={audience}
                  onChange={setAudience}
                  people={data.people}
                  me={data.me}
                  canPickGroups={data.canPickGroups}
                />
              ) : (
                <p className="py-4 text-center text-sm text-cab-t3">{COPY.loading}</p>
              )}

            </div>
          )}
        </div>

        {/* Поле й кнопка НЕ їдуть із прокруткою: у команді півтора десятка
            людей, і докручувати до дії через увесь список — та сама пастка,
            через яку кнопку не було видно взагалі. */}
        {!sentTo && (
          <div className="flex shrink-0 flex-col gap-2 border-t border-cab-line px-4 py-3">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder={COPY.forwardComment}
              className="w-full resize-none rounded-xl border border-cab-line bg-white px-3 py-2.5 text-base text-bk outline-none placeholder:text-cab-t3 focus:border-bk"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !data || !audienceChosen(audience)}
              className="flex h-[52px] items-center justify-center rounded-xl bg-primary px-4 text-[15px] font-bold text-bk disabled:opacity-55"
            >
              {busy ? "Надсилаю…" : COPY.send}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
