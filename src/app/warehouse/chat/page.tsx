/**
 * Список розмов чату персоналу.
 *
 * Тонка обгортка: сам екран клієнтський, а Suspense потрібен, бо
 * CabinetHeader читає useSearchParams — без нього Next 16 валить білд
 * усього маршруту.
 */

import { Suspense } from "react";
import ChatEntry from "@/components/chat/ChatEntry";

export const metadata = { title: "Чат" };
export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatEntry section="warehouse" />
    </Suspense>
  );
}
