"use client";

/**
 * Картка-секція картки клієнта: шапка з підсумком і рядки через лінію.
 *
 * Винесено зі сторінки клієнта, бо тих секцій уже пʼять і додалася шоста
 * (памʼять). Поки кожна була локальною, у них розходились відступи й
 * товщина ліній — і саме це помітно на телефоні раніше за будь-яку
 * помилку в цифрах.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export function Section({
  title,
  right,
  icon,
  tone = "plain",
  children,
}: {
  title: string;
  right?: ReactNode;
  icon?: ReactNode;
  tone?: "plain" | "bad";
  children: ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border bg-white ${
        tone === "bad" ? "border-bad-line" : "border-cab-line"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-cab-line px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate text-sm font-semibold text-bk">{title}</span>
        </span>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Рядок секції: усі, крім першого, відокремлені лінією. */
export function SectionRow({ children, href }: { children: ReactNode; href?: string }) {
  const cls =
    "block px-4 py-2.5 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[#F1F1EF]";
  return href ? (
    <Link href={href} className={`${cls} active:opacity-70`}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}
