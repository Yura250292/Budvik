"use client";

import { useEffect } from "react";
import { useTabs } from "./TabsProvider";
import { canAccess, type AdminRole } from "@/lib/admin-nav";

/**
 * Перехоплює кліки по посиланнях усередині /admin, щоб Ctrl/Cmd-клік і
 * середня кнопка відкривали вкладку застосунку, а не вкладку браузера.
 * Звичайний клік не чіпаємо — ним керує Next.js, а провайдер створює
 * вкладку, побачивши новий шлях.
 */
export default function LinkInterceptor({ role }: { role: AdminRole }) {
  const { openTab, tabs, setActiveTab, enabled } = useTabs();

  useEffect(() => {
    if (!enabled) return;

    const handle = (e: MouseEvent) => {
      if (e.defaultPrevented) return;

      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/admin")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const path = href.split("#")[0];
      const isNewTabClick = e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey));
      if (!isNewTabClick) return;

      e.preventDefault();
      e.stopPropagation();

      if (!canAccess(path, role)) return;

      const existing = tabs.find((t) => t.path === path);
      if (existing) {
        // Уже відкрито — просто підсвічуємо, без дубля.
        if (e.button === 1) setActiveTab(existing.id);
        return;
      }
      openTab(path, { background: true });
    };

    /*
     * Перехоплюємо саме mousedown.
     *
     * Браузер обробляє Ctrl/Cmd-клік по посиланню сам і НЕ надсилає
     * сторінці ні click, ні auxclick — до слухачів долітають лише
     * pointerdown/mousedown/mouseup. Тому click тут не спрацював би
     * взагалі; mousedown ловить і Ctrl-клік, і середню кнопку.
     */
    document.addEventListener("mousedown", handle, true);
    // Середня кнопка додатково гаситься на auxclick: без цього деякі
    // браузери встигають відкрити власну вкладку після mousedown.
    document.addEventListener("auxclick", handle, true);
    return () => {
      document.removeEventListener("mousedown", handle, true);
      document.removeEventListener("auxclick", handle, true);
    };
  }, [enabled, openTab, tabs, setActiveTab, role]);

  return null;
}
