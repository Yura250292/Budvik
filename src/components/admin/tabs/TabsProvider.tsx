"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { canAccess, iconForPath, titleForPath, type AdminRole } from "@/lib/admin-nav";
import { TAB_CAP, TAB_TTL_MS, makeTabId, storageKey, type Tab, type TabsState } from "./types";

type TabsContextValue = TabsState & {
  /** Чи ввімкнено режим вкладок. Вимкнений лише до визначення ширини. */
  enabled: boolean;
  /**
   * Чи тримати неактивні вкладки змонтованими. Тільки desktop: на телефоні
   * пів десятка живих сторінок зі списками й картами з'їдають пам'ять і
   * вкладку вбиває сама система. Смужка вкладок там працює як швидке
   * перемикання — стан сторінки не зберігається.
   */
  keepAlive: boolean;
  openTab: (path: string, opts?: { background?: boolean }) => void;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  closeRight: (id: string) => void;
  setActiveTab: (id: string) => void;
  reloadTab: (id: string) => void;
  togglePin: (id: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

export function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used within TabsProvider");
  return ctx;
}

function newTab(path: string, now: number): Tab {
  return {
    id: makeTabId(path),
    path,
    title: titleForPath(path),
    iconKey: iconForPath(path),
    createdAt: now,
    lastActiveAt: now,
  };
}

export default function TabsProvider({
  userId,
  role,
  children,
}: {
  userId: string | undefined;
  role: AdminRole;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();

  // Смужка вкладок працює й на телефоні (її можна згорнути в тонкий
  // рядок), а от кеш живих сторінок лишається десктопним — див. keepAlive.
  const [enabled, setEnabled] = useState(false);
  const [keepAlive, setKeepAlive] = useState(false);
  useEffect(() => {
    setEnabled(true);
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setKeepAlive(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Перший рендер має збігтися з SSR: одна вкладка для поточного шляху.
  const [state, setState] = useState<TabsState>(() => {
    const tab = newTab(pathname, 0);
    return { tabs: [tab], activeTabId: tab.id };
  });
  const hydratedRef = useRef(false);

  // Відновлення збережених вкладок — тільки після монтування.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = localStorage.getItem(storageKey(userId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as TabsState;
      const now = Date.now();
      const restored = (parsed.tabs ?? []).filter(
        (t) => t?.path?.startsWith("/admin") && now - (t.lastActiveAt ?? 0) < TAB_TTL_MS && canAccess(t.path, role)
      );
      if (!restored.length) return;

      setState((prev) => {
        const current = prev.tabs.find((t) => t.path === pathname);
        const existing = restored.find((t) => t.path === pathname);
        if (existing) {
          // Поточний шлях уже серед відновлених — робимо його активним.
          return { tabs: restored, activeTabId: existing.id };
        }
        const tabs = current ? [...restored, current] : restored;
        return { tabs: tabs.slice(-TAB_CAP), activeTabId: current?.id ?? tabs[tabs.length - 1].id };
      });
    } catch {
      /* зіпсований запис — стартуємо з чистого стану */
    }
  }, [userId, role, pathname]);

  // Збереження стану вкладок.
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(state));
    } catch {
      /* приватний режим / переповнене сховище */
    }
  }, [state, userId]);

  /**
   * Слідкуємо за URL: будь-яка навігація (клік у сайдбарі, назад/вперед,
   * прямий перехід) або активує наявну вкладку, або створює нову.
   */
  useEffect(() => {
    // Як і в openTab: id генерується поза апдейтером, бо React може
    // виконати апдейтер повторно й дати вкладці інший id.
    const now = Date.now();
    const created = newTab(pathname, now);

    setState((prev) => {
      const active = prev.tabs.find((t) => t.id === prev.activeTabId);
      if (active?.path === pathname) return prev;

      const match = prev.tabs.find((t) => t.path === pathname);
      if (match) {
        return {
          tabs: prev.tabs.map((t) => (t.id === match.id ? { ...t, lastActiveAt: now } : t)),
          activeTabId: match.id,
        };
      }

      let tabs = [...prev.tabs, created];
      if (tabs.length > TAB_CAP) {
        // Витісняємо найдавніше використану незакріплену вкладку.
        const victim = tabs
          .filter((t) => !t.pinned && t.id !== created.id)
          .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
        if (victim) tabs = tabs.filter((t) => t.id !== victim.id);
      }
      return { tabs, activeTabId: created.id };
    });
  }, [pathname]);

  const setActiveTab = useCallback(
    (id: string) => {
      setState((prev) => {
        const tab = prev.tabs.find((t) => t.id === id);
        if (!tab) return prev;
        if (tab.path !== pathname) router.push(tab.path);
        return {
          tabs: prev.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: Date.now() } : t)),
          activeTabId: id,
        };
      });
    },
    [pathname, router]
  );

  const openTab = useCallback(
    (path: string, opts?: { background?: boolean }) => {
      if (!canAccess(path, role)) return;
      // Вкладку створюємо ДО setState: newTab() використовує Math.random(),
      // а апдейтер React може виконати двічі — тоді id щоразу різні й
      // фонова вкладка «губиться».
      const now = Date.now();
      const created = newTab(path, opts?.background ? now - 1 : now);

      setState((prev) => {
        const existing = prev.tabs.find((t) => t.path === path);
        if (existing) {
          if (opts?.background) return prev;
          router.push(path);
          return { ...prev, activeTabId: existing.id };
        }
        let tabs = [...prev.tabs, created];
        if (tabs.length > TAB_CAP) {
          const victim = tabs
            .filter((t) => !t.pinned && t.id !== created.id && t.id !== prev.activeTabId)
            .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
          if (victim) tabs = tabs.filter((t) => t.id !== victim.id);
        }
        if (opts?.background) return { tabs, activeTabId: prev.activeTabId };
        router.push(path);
        return { tabs, activeTabId: created.id };
      });
    },
    [role, router]
  );

  const closeTab = useCallback(
    (id: string) => {
      setState((prev) => {
        if (prev.tabs.length <= 1) return prev;
        const idx = prev.tabs.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        const tabs = prev.tabs.filter((t) => t.id !== id);
        if (prev.activeTabId !== id) return { tabs, activeTabId: prev.activeTabId };
        // Активуємо сусідню вкладку (праворуч, інакше ліворуч).
        const next = tabs[Math.min(idx, tabs.length - 1)];
        router.push(next.path);
        return { tabs, activeTabId: next.id };
      });
    },
    [router]
  );

  const closeOthers = useCallback(
    (id: string) => {
      setState((prev) => {
        const keep = prev.tabs.filter((t) => t.id === id || t.pinned);
        if (!keep.length) return prev;
        const target = prev.tabs.find((t) => t.id === id);
        if (target && prev.activeTabId !== id) router.push(target.path);
        return { tabs: keep, activeTabId: id };
      });
    },
    [router]
  );

  const closeRight = useCallback((id: string) => {
    setState((prev) => {
      const idx = prev.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const tabs = prev.tabs.filter((t, i) => i <= idx || t.pinned);
      const activeStillOpen = tabs.some((t) => t.id === prev.activeTabId);
      return { tabs, activeTabId: activeStillOpen ? prev.activeTabId : id };
    });
  }, []);

  const reloadTab = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => (t.id === id ? { ...t, reloadKey: (t.reloadKey ?? 0) + 1 } : t)),
      }));
      if (state.activeTabId === id) router.refresh();
    },
    [router, state.activeTabId]
  );

  const togglePin = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)),
    }));
  }, []);

  const value = useMemo<TabsContextValue>(
    () => ({
      ...state,
      enabled,
      keepAlive,
      openTab,
      closeTab,
      closeOthers,
      closeRight,
      setActiveTab,
      reloadTab,
      togglePin,
    }),
    [state, enabled, keepAlive, openTab, closeTab, closeOthers, closeRight, setActiveTab, reloadTab, togglePin]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}
