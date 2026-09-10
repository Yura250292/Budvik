"use client";

/**
 * Екран чату: ліворуч перелік розмов, праворуч сама розмова.
 *
 * Дві колонки з ширини 768 px — і в кабінеті, і в адмінці. Кабінет
 * відкривають не лише з телефона: в офісі це ноутбук, і там крок «назад до
 * списку» на кожну зміну співрозмовника — зайва дорога. На телефоні
 * колонки лишаються двома кроками: 390 px на дві не ділиться.
 *
 * Розкладка фіксованим шаром, як у помічника: поле вводу не має їхати зі
 * стрічкою, а нижня межа — це панель вкладок. В адмінці екран живе
 * ВСЕРЕДИНІ шелла, інакше він перекрив би сайдбар і крихти.
 */

import Link from "next/link";
import useSWR from "swr";
import { ChevronLeft, SquarePen } from "lucide-react";
import { CabinetHeader } from "@/components/cabinet/Header";
import { TAB_BAR_SPACE } from "@/components/cabinet/TabBar";
import { ConversationList, CONVERSATIONS_URL } from "./ConversationList";
import { NewMessageScreen } from "./NewMessageScreen";
import { Thread } from "./Thread";
import { useIsWide } from "./useIsWide";
import { COPY } from "./copy";
import { fetcher, type ConversationsResponse, type ThreadResponse } from "./api";

export type Section = "sales" | "driver" | "warehouse" | "admin";

export default function ChatScreen({ section, conversation }: { section: Section; conversation: string | null }) {
  const base = `/${section}/chat`;
  const embedded = section === "admin";
  const wide = useIsWide();
  const { data } = useSWR<ConversationsResponse>(CONVERSATIONS_URL, fetcher, { revalidateOnFocus: false });

  const isNew = conversation === "new";
  const open = Boolean(conversation);
  const current = conversation && !isNew ? data?.conversations.find((c) => c.key === conversation) : undefined;
  /**
   * Назву беремо і з самої розмови, не лише зі списку.
   *
   * У списку є лише СВОЇ розмови, а адміністратор із журналу відкриває чужі
   * особисті — там пошук у списку нічого не знаходить, і шапка писала просто
   * «Чат». Ключ той самий, що в стрічки, тож SWR віддає це з кешу.
   */
  const { data: thread } = useSWR<ThreadResponse>(
    conversation && !isNew ? `/api/chat/messages/${conversation}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );
  const label = isNew ? COPY.newMessage : (thread?.conversation.label ?? current?.label ?? COPY.title);

  const list = <ConversationList section={section} base={base} activeKey={conversation} />;

  const pane = isNew ? (
    <NewMessageScreen base={base} embedded={embedded} />
  ) : conversation ? (
    <Thread conversation={conversation} section={section} meId={data?.me.id ?? null} embedded={embedded} />
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <p className="text-sm text-cab-t3">{COPY.pickConversation}</p>
    </div>
  );

  /**
   * Кожна колонка малюється РІВНО ОДИН раз, а ховається класами: другий
   * екземпляр стрічки означав би дві підписки SWR і дві відмітки
   * прочитання на ту саму розмову.
   */
  const columns = (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside
        className={`${open ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col overflow-y-auto border-cab-line bg-white md:w-[320px] md:border-r lg:w-[360px]`}
      >
        {list}
      </aside>
      <div className={`${open ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col`}>
        {/*
          Шапка розмови. У кабінеті вона лише на широкому екрані: на телефоні
          назву вже показує шапка кабінету, і другий рядок із тим самим
          текстом з'їдав би висоту стрічки. В адмінці своєї шапки в екрана
          немає взагалі, тож там ця смуга потрібна завжди — інакше з вузького
          вікна нема чим повернутися до списку.
        */}
        {open && (
          <div
            className={`${embedded ? "flex" : "hidden md:flex"} items-center gap-2 border-b border-cab-line bg-white px-4 py-2`}
          >
            <Link href={base} className="flex items-center gap-0.5 text-[13px] font-medium text-cab-t2 md:hidden">
              <ChevronLeft size={16} />
              {COPY.backToList}
            </Link>
            <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-bk">{label}</span>
            {!isNew && thread?.conversation.type === "role" && (
              <span className="shrink-0 text-[11px] text-cab-t3">{COPY.groupChat}</span>
            )}
          </div>
        )}
        {pane}
      </div>
    </div>
  );

  if (embedded) {
    return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-cab-bg">{columns}</div>;
  }

  return (
    <div className="fixed inset-x-0 top-0 flex flex-col bg-cab-bg" style={{ bottom: TAB_BAR_SPACE }}>
      <CabinetHeader
        // На широкому екрані список нікуди не дівається, тож заголовок
        // лишається розділом, а не назвою розмови; «назад» веде в кабінет.
        title={wide ? COPY.title : open ? label : COPY.title}
        subtitle={!wide && open ? COPY.title : undefined}
        backTo={!wide && open ? base : `/${section}`}
        sticky={false}
        hideChat
        right={
          !open || wide ? (
            <Link href={`${base}/new`} aria-label={COPY.newAria} className="flex h-11 w-9 items-center justify-center text-white">
              <SquarePen size={19} />
            </Link>
          ) : undefined
        }
      />
      {columns}
    </div>
  );
}
