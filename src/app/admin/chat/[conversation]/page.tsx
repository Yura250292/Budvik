/** Одна розмова. Ключ у шляху, а не в параметрі: його ж несе пуш. */

import { Suspense } from "react";
import ChatEntry from "@/components/chat/ChatEntry";

export const metadata = { title: "Чат" };
export const dynamic = "force-dynamic";

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ conversation: string }>;
}) {
  const { conversation } = await params;
  return (
    <Suspense fallback={null}>
      <ChatEntry section="admin" conversation={conversation} />
    </Suspense>
  );
}
