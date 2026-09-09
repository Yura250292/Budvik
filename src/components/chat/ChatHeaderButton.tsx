"use client";

/**
 * Кнопка чату з лічильником непрочитаного.
 *
 * Два вигляди, бо шапки різні: у кабінеті вона на чорному тлі поруч з
 * іскоркою помічника, в адмінці — сіра, як дзвіночок. Бейдж однаковий: на
 * телефоні шапка кабінету вже несе дзвінок, вихід і аватар, тож кнопка
 * без плашки й трохи вужча — інакше вона з'їдає заголовок.
 */

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { useChatUnread } from "./useChatUnread";

export function ChatHeaderButton({ href, variant }: { href: string; variant: "dark" | "admin" }) {
  const unread = useChatUnread();
  const label = unread > 0 ? `Чат, непрочитаних: ${unread}` : "Чат";

  return (
    <Link
      href={href}
      aria-label={label}
      className={
        variant === "dark"
          ? "relative flex h-10 w-9 items-center justify-center"
          : "relative flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] text-g500 transition-colors hover:bg-g50 hover:text-bk active:bg-g100"
      }
    >
      <MessageCircle size={variant === "dark" ? 20 : 19} color={variant === "dark" ? "#FFFFFF" : undefined} />
      {unread > 0 && (
        <span
          className={`absolute flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none text-white ${
            variant === "dark" ? "right-0 top-1" : "right-1 top-1"
          }`}
          style={{ background: "#EF4444" }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
