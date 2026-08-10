"use client";

import { useEffect, useRef, useState } from "react";
import { useTabs } from "./TabsProvider";
import { AdminIcon, type IconKey } from "../icons";
import useTabHotkeys from "./useTabHotkeys";

type Menu = { tabId: string; x: number; y: number };

const COLLAPSED_KEY = "budvik:admin:tabs:collapsed:v1";

export default function TabsBar() {
  const { tabs, activeTabId, enabled, setActiveTab, closeTab, closeOthers, closeRight, reloadTab, togglePin, openTab } =
    useTabs();
  const [menu, setMenu] = useState<Menu | null>(null);
  // Смужка вкладок з'їдає висоту — на телефоні це помітно, тому її можна
  // згорнути в тонкий рядок. Стан спільний для всіх ширин: людина, яка
  // згорнула вкладки, не хоче бачити їх і на планшеті.
  const [collapsed, setCollapsed] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useTabHotkeys();

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      /* приватний режим */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* приватний режим */
      }
      return next;
    });
  };

  // Активна вкладка завжди має бути видимою у смужці.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  if (!enabled) return null;

  const menuTab = menu ? tabs.find((t) => t.id === menu.tabId) : null;
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Згорнутий стан: один рядок 26px із назвою активної вкладки та
  // лічильником — видно, що відкрито ще щось, але висоту майже не з'їдає.
  if (collapsed) {
    return (
      <div className="relative flex h-[26px] flex-shrink-0 items-center gap-2 border-b border-g200 bg-g50 px-2">
        <span className="flex-shrink-0 text-g400 [&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">
          <AdminIcon name={(activeTab?.iconKey ?? "page") as IconKey} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-bk">{activeTab?.title}</span>
        {tabs.length > 1 && (
          <span className="flex-shrink-0 rounded-full bg-g200 px-1.5 text-[10px] font-semibold text-g600">
            +{tabs.length - 1}
          </span>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={false}
          aria-label="Показати вкладки"
          className="flex h-[26px] w-7 flex-shrink-0 items-center justify-center text-g400 transition-colors hover:text-bk"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-9 flex-shrink-0 items-stretch border-b border-g200 bg-g50">
      <div ref={stripRef} className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              ref={isActive ? activeRef : undefined}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              onAuxClick={(e) => {
                // Середня кнопка миші закриває вкладку — як у браузері.
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              title={tab.title}
              className={`group flex max-w-[200px] min-w-[110px] flex-shrink-0 items-center gap-1.5 border-r border-g200 px-2.5 text-[12px] transition-colors ${
                isActive
                  ? "border-b-2 border-b-primary bg-white font-semibold text-bk"
                  : "text-g400 hover:bg-white/60 hover:text-bk"
              }`}
            >
              <span className="flex-shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <AdminIcon name={tab.iconKey as IconKey} />
              </span>
              <span className="truncate">{tab.title}</span>
              {tab.pinned ? (
                <span className="flex-shrink-0 text-primary-dark" aria-label="Закріплена">
                  •
                </span>
              ) : (
                tabs.length > 1 && (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Закрити ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    // На тачі hover не існує — там хрестик видно завжди,
                    // інакше вкладку неможливо закрити пальцем.
                    className="ml-auto flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-g300 transition-opacity hover:bg-g200 hover:text-bk [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => openTab("/admin")}
        title="Новий дашборд (Alt+T)"
        aria-label="Нова вкладка"
        className="flex w-9 flex-shrink-0 items-center justify-center border-l border-g200 text-g400 transition-colors hover:bg-white hover:text-bk"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded
        title="Згорнути вкладки"
        aria-label="Згорнути вкладки"
        className="flex w-8 flex-shrink-0 items-center justify-center border-l border-g200 text-g400 transition-colors hover:bg-white hover:text-bk"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {menu && menuTab && (
        <div
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-[70] w-52 overflow-hidden rounded-[var(--radius-btn)] border border-g200 bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
          onClick={(e) => e.stopPropagation()}
        >
          {[
            { label: "Оновити", action: () => reloadTab(menu.tabId) },
            { label: menuTab.pinned ? "Відкріпити" : "Закріпити", action: () => togglePin(menu.tabId) },
            { label: "Закрити", action: () => closeTab(menu.tabId), disabled: tabs.length <= 1 },
            { label: "Закрити інші", action: () => closeOthers(menu.tabId), disabled: tabs.length <= 1 },
            { label: "Закрити праворуч", action: () => closeRight(menu.tabId) },
          ].map((row) => (
            <button
              key={row.label}
              type="button"
              role="menuitem"
              disabled={row.disabled}
              onClick={() => {
                row.action();
                setMenu(null);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-bk transition-colors hover:bg-g50 disabled:cursor-not-allowed disabled:text-g300 disabled:hover:bg-transparent"
            >
              {row.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
