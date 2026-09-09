"use client";

/**
 * Екран чату: список розмов або одна розмова.
 *
 * Розкладка та сама, що в помічника, і з тієї ж причини: фіксований шар,
 * бо поле вводу не має їхати зі стрічкою, а нижня межа — це панель
 * вкладок. В адмінці екран живе ВСЕРЕДИНІ шелла (embedded), інакше він
 * перекрив би сайдбар і крихти; там же на ноутбуці зʼявляється друга
 * колонка — список розмов постійно перед очима.
 */

import Link from "next/link";
import useSWR from "swr";
import { SquarePen } from "lucide-react";
import { CabinetHeader } from "@/components/cabinet/Header";
import { TAB_BAR_SPACE } from "@/components/cabinet/TabBar";
import { ConversationList, CONVERSATIONS_URL } from "./ConversationList";
import { NewMessageScreen } from "./NewMessageScreen";
import { Thread } from "./Thread";
import { COPY } from "./copy";
import { fetcher, type ConversationsResponse } from "./api";

export type Section = "sales" | "driver" | "warehouse" | "admin";

export default function ChatScreen({ section, conversation }: { section: Section; conversation: string | null }) {
  const base = `/${section}/chat`;
  const embedded = section === "admin";
  const { data } = useSWR<ConversationsResponse>(CONVERSATIONS_URL, fetcher, { revalidateOnFocus: false });

  const isNew = conversation === "new";
  const current = conversation && !isNew ? data?.conversations.find((c) => c.key === conversation) : undefined;
  const title = isNew ? COPY.newMessage : (current?.label ?? (conversation ? COPY.title : COPY.title));

  const body = isNew ? (
    <NewMessageScreen base={base} embedded={embedded} />
  ) : conversation ? (
    <Thread conversation={conversation} section={section} meId={data?.me.id ?? null} embedded={embedded} />
  ) : (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ConversationList section={section} base={base} />
    </div>
  );

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 overflow-hidden bg-cab-bg">
        {/* На ноутбуці список постійно збоку: в адмінці екран широкий, і
            ховати його за кроком «назад» тут нема потреби. */}
        <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-r border-cab-line bg-white md:block">
          <ConversationList section={section} base={base} />
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {(conversation || isNew) && (
            <div className="flex items-center gap-2 border-b border-cab-line bg-white px-4 py-1.5">
              <Link href={base} className="text-[13px] font-medium text-cab-t2 md:hidden">
                ← Розмови
              </Link>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-bk">{title}</span>
            </div>
          )}
          {/* На телефоні всередині адмінки список — це і є вміст. */}
          <div className={`flex min-h-0 flex-1 flex-col ${conversation || isNew ? "" : "md:hidden"}`}>{body}</div>
          {!conversation && !isNew && (
            <div className="hidden min-h-0 flex-1 items-center justify-center md:flex">
              <p className="text-sm text-cab-t3">Оберіть розмову ліворуч</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 top-0 flex flex-col bg-cab-bg" style={{ bottom: TAB_BAR_SPACE }}>
      <CabinetHeader
        title={title}
        subtitle={conversation && !isNew ? COPY.title : undefined}
        backTo={conversation || isNew ? base : `/${section}`}
        sticky={false}
        hideChat
        right={
          !conversation && !isNew ? (
            <Link href={`${base}/new`} aria-label={COPY.newAria} className="flex h-11 w-9 items-center justify-center text-white">
              <SquarePen size={19} />
            </Link>
          ) : undefined
        }
      />
      {body}
    </div>
  );
}
