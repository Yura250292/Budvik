"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";

/**
 * Хаб «Звіти». Складські звіти лишаються за своїм URL
 * (/admin/warehouse-reports) — закладки й посилання в інструкціях
 * не ламаються, хаб лише збирає входи в одне місце.
 */
const REPORTS = [
  {
    href: "/admin/warehouse-reports",
    title: "Звіти з складу",
    desc: "Зміни, накладні та продуктивність складовщиків",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
        />
      </svg>
    ),
  },
  {
    href: "/admin/sales-reports",
    title: "Звіти торгових",
    desc: "Поїздки, пробіг, відвідані точки та темп обходу",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"
        />
      </svg>
    ),
  },
  {
    href: "/admin/erp/reports",
    title: "Бухгалтерські звіти",
    desc: "Виручка, собівартість, маржа, дебіторка та комісії",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
];

export default function ReportsHubPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (role !== "ADMIN" && role !== "MANAGER") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="w-14 h-14 bg-[#FFEAEA] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-[#C62828]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-bk">Доступ заборонено</h1>
        <p className="text-g400 mt-2 text-sm">У вас немає доступу до звітів</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-white border-b border-g200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link
            href="/admin"
            className="w-9 h-9 rounded-[var(--radius-btn)] bg-primary flex items-center justify-center flex-shrink-0 hover:bg-[var(--primary-hover)] transition-colors"
            aria-label="Назад до панелі управління"
          >
            <svg className="w-4 h-4 text-bk" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-bk leading-tight">Звіти</h1>
            <p className="text-xs text-g400">Склад і торгові представники</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {REPORTS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3.5 bg-white rounded-[var(--radius-card)] border border-g200 px-4 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:border-g300 active:scale-[0.98] transition-[box-shadow,border-color,transform] duration-150 group"
            >
              <div className="w-11 h-11 rounded-[var(--radius-btn)] bg-bk flex items-center justify-center flex-shrink-0 text-primary [&>svg]:w-5 [&>svg]:h-5">
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[15px] font-semibold text-bk leading-tight">{item.title}</h2>
                <p className="text-[12px] text-g400 mt-0.5">{item.desc}</p>
              </div>
              <svg
                className="w-4 h-4 flex-shrink-0 text-g300 group-hover:text-g400 transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
