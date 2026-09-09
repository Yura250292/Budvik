"use client";

/** Тонкий вхід: сторінка дає секцію й ключ розмови, решта — в екрані. */

import ChatScreen, { type Section } from "./ChatScreen";

export default function ChatEntry({ section, conversation = null }: { section: Section; conversation?: string | null }) {
  return <ChatScreen section={section} conversation={conversation} />;
}
