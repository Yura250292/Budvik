"use client";

/**
 * Список розмов: групи, потім особисті, журнал останнім.
 *
 * Опитуємо раз на хвилину: список — це «де щось нове», а не сама розмова.
 * Відкритий діалог оновлюється частіше й сам.
 */

import Link from "next/link";
import useSWR from "swr";
import { MessageSquarePlus, ScrollText, Store, Truck, Users, Warehouse } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { COPY } from "./copy";
import { fetcher, type ConversationsResponse, type ConversationSummary } from "./api";

export const CONVERSATIONS_URL = "/api/chat/conversations";

function icon(c: ConversationSummary) {
  if (c.type === "all") return <Users size={20} />;
  if (c.type === "journal") return <ScrollText size={20} />;
  if (c.key === "role-SALES") return <Store size={20} />;
  if (c.key === "role-DRIVER") return <Truck size={20} />;
  if (c.key === "role-WAREHOUSE") return <Warehouse size={20} />;
  return <Users size={20} />;
}

function preview(c: ConversationSummary): string {
  if (!c.last) return "—";
  const text = c.last.text || (c.last.hasPhotos ? "📷 Фото" : c.last.kind === "ASSISTANT" ? `✨ ${COPY.forwarded}` : "");
  return c.type === "dm" ? text : `${c.last.authorName}: ${text}`;
}

function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return "вчора";
  return date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
}

export function ConversationList({ section, base }: { section: string; base: string }) {
  const { data, isLoading } = useSWR<ConversationsResponse>(CONVERSATIONS_URL, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  void section;

  const people = new Map((data?.people ?? []).map((p) => [p.id, p]));
  const conversations = data?.conversations ?? [];

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3 px-4 py-4">
      <Link
        href={`${base}/new`}
        className="flex h-[52px] items-center justify-center gap-2 rounded-xl bg-bk px-4 text-[15px] font-bold text-white active:opacity-80"
      >
        <MessageSquarePlus size={18} />
        {COPY.newMessage}
      </Link>

      {isLoading && conversations.length === 0 && <p className="py-6 text-center text-sm text-cab-t3">{COPY.loading}</p>}

      <div className="flex flex-col gap-2">
        {conversations.map((c) => {
          const person = c.userId ? people.get(c.userId) : undefined;
          return (
            <Link
              key={c.key}
              href={`${base}/${c.key}`}
              className="flex items-center gap-3 rounded-2xl border border-cab-line bg-white px-3.5 py-3 active:opacity-70"
            >
              {person ? (
                <Avatar name={person.name} id={person.id} src={person.avatarUrl} color={person.color} size={40} />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cab-bg text-cab-t2">
                  {icon(c)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-bk">{c.label}</span>
                <span className="mt-0.5 block truncate text-xs text-cab-t3">{preview(c)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {!!c.last && <span className="text-[11px] text-cab-t3">{when(c.last.createdAt)}</span>}
                {c.unread > 0 && (
                  <span
                    className="flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none text-white"
                    style={{ background: "#EF4444" }}
                  >
                    {c.unread > 99 ? "99+" : c.unread}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>

      {!isLoading && conversations.every((c) => !c.last) && (
        <div className="rounded-2xl border border-cab-line bg-white p-4">
          <p className="text-[15px] font-bold text-bk">{COPY.emptyList}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-cab-t2">{COPY.emptyListBody}</p>
        </div>
      )}
    </div>
  );
}
