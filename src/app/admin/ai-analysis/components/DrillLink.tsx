"use client";

/**
 * Посилання «перевірити в даних».
 *
 * Один вигляд на весь розділ, щоб перехід у живі цифри читався однаково —
 * і в блоці торгового, і в таблиці брендів, і в списку неліквіду.
 *
 * Звичайний <a>, без обробників: Ctrl/Cmd-клік і середня кнопка відкривають
 * вкладку застосунку через LinkInterceptor у шелі адмінки. Тому ж тут не
 * ставиться target="_blank" — він якраз вимкнув би перехоплювач і повернув
 * звичайну вкладку браузера замість вкладки адмінки.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export function DrillLink({
  href,
  children,
  title,
  className = "",
}: {
  href: string;
  children: ReactNode;
  /** Підказка на наведення: що саме відкриється */
  title?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      title={title ?? "Відкрити дані. Ctrl/Cmd-клік — у новій вкладці"}
      className={`inline-flex items-center gap-1 underline-offset-2 hover:underline ${className}`}
    >
      {children}
      <svg
        aria-hidden="true"
        className="h-3 w-3 shrink-0 opacity-50"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13 7l5 5m0 0l-5 5m5-5H6"
        />
      </svg>
    </Link>
  );
}

/** Той самий перехід, але оформлений кнопкою — для шапок карток. */
export function DrillButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      title="Відкрити дані. Ctrl/Cmd-клік — у новій вкладці"
      className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs font-medium text-g600 transition-colors hover:border-g300 hover:text-bk"
    >
      {children}
    </Link>
  );
}
