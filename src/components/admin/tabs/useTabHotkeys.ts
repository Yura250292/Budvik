"use client";

import { useEffect } from "react";
import { useTabs } from "./TabsProvider";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Гарячі клавіші вкладок.
 *
 * Ctrl+W і Ctrl+T браузер не віддає застосунку (закриває власну вкладку),
 * тому закриття та створення повішені на Alt+W / Alt+T.
 */
export default function useTabHotkeys() {
  const { tabs, activeTabId, enabled, setActiveTab, closeTab, openTab } = useTabs();

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;

      // Ctrl/Cmd + 1..9 — перехід до N-ї вкладки.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const tab = tabs[idx];
        if (tab) {
          e.preventDefault();
          setActiveTab(tab.id);
        }
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "w") {
          if (activeTabId && tabs.length > 1) {
            e.preventDefault();
            closeTab(activeTabId);
          }
          return;
        }
        if (key === "t") {
          e.preventDefault();
          openTab("/admin");
          return;
        }
      }

      // Ctrl/Cmd + Tab — наступна вкладка.
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab" && tabs.length > 1) {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const next = tabs[(idx + (e.shiftKey ? -1 + tabs.length : 1)) % tabs.length];
        if (next) setActiveTab(next.id);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tabs, activeTabId, enabled, setActiveTab, closeTab, openTab]);
}
