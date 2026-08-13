"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const AiChatWidget = dynamic(() => import("@/components/ai/AiChatWidget"), { ssr: false });

/**
 * Асистента немає в кабінеті торгового: там він відповідав на питання про
 * товар для покупця, а не про роботу торгового, і при цьому висів над
 * кожним екраном і витрачав токени на випадкові дотики.
 *
 * Перевірка саме тут, а не всередині AiChatWidget: next/dynamic тоді
 * взагалі не тягне бандл віджета на цих сторінках.
 *
 * Той самий патерн гейта по /sales уже застосовано в Header, Footer і
 * BottomNav — секція має власну навігацію.
 */
export default function AiChatWidgetLoader() {
  const pathname = usePathname();
  if (pathname?.startsWith("/sales")) return null;
  // У водія те саме, лише гостріше: кружечок висить над кнопкою відмітки
  // візиту, а тикають у нього пальцем на ходу.
  if (pathname?.startsWith("/driver")) return null;
  // В адмінці асистент теж зайвий: він знає про товари для покупця, а не
  // про закупівлі й звіти, і при цьому перекриває панель заявки внизу.
  if (pathname?.startsWith("/admin")) return null;

  return <AiChatWidget />;
}
