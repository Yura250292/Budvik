"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  relatedId: string | null;
  createdAt: string;
};

/** Опитуємо сервер раз на хвилину: сповіщення не гарячі, а вкладок адмінки може бути багато. */
const POLL_MS = 60_000;

function hrefFor(n: Notification) {
  if (!n.relatedId) return "/admin";
  // Обидва наявні типи (WHOLESALE_ORDER_REQUEST, SALES_DOC_CONFIRMED) кладуть у relatedId
  // id документа продажу.
  return `/admin/erp/sales/${n.relatedId}`;
}

/**
 * Дзвіночок у шапці адмінки. Читає ті самі /api/notifications, що й кабінет
 * менеджера, але оформлений під дропдаун профілю: та сама рамка, тінь і
 * поведінка (клік поза межами, Escape, закриття на переході).
 */
export default function NotificationsBell() {
  const pathname = usePathname() ?? "/admin";
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const unread = items.filter((n) => !n.isRead).length;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      // мовчки: дзвіночок не має ламати шапку через мережевий збій
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await fetch("/api/notifications/read-all", { method: "PATCH" });
    } catch {
      load();
    }
  };

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    try {
      await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    } catch {
      load();
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Сповіщення, непрочитаних: ${unread}` : "Сповіщення"}
        className="relative flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] text-g500 transition-colors hover:bg-g50 hover:text-bk active:bg-g100"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {unread > 0 && (
          <span
            className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none text-white"
            style={{ background: "#EF4444" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 flex max-h-[70vh] w-[min(340px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
        >
          <div className="flex flex-shrink-0 items-center justify-between border-b border-g200 px-3.5 py-3">
            <span className="text-[14px] font-semibold text-bk">Сповіщення</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[12px] font-medium text-g500 transition-colors hover:text-bk"
              >
                Прочитати всі
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3.5 py-8 text-center text-[13px] text-g400">Немає сповіщень</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={hrefFor(n)}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    if (!n.isRead) markRead(n.id);
                  }}
                  className="block border-b border-g100 px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-g50 active:bg-g100"
                  style={n.isRead ? undefined : { background: "#FFF9E6" }}
                >
                  <p className="text-[13px] font-semibold text-bk">{n.title}</p>
                  <p className="mt-0.5 text-[12px] text-g500">{n.body}</p>
                  <p className="mt-1 text-[11px] text-g400">
                    {new Date(n.createdAt).toLocaleString("uk-UA", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
