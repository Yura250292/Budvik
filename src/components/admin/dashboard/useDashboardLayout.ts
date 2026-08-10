"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminRole } from "@/lib/admin-nav";
import { isKnownWidget, WIDGET_REGISTRY } from "./widget-registry";
import {
  defaultLayout,
  LAYOUT_VERSION,
  MAX_WIDGETS,
  WIDGET_SIZES,
  type DashboardLayout,
  type WidgetInstance,
  type WidgetSize,
  type WidgetType,
} from "./layout-schema";

const cacheKey = (userId: string | undefined) => `budvik:admin:dashboard:v1:${userId ?? "anon"}`;
const SAVE_DEBOUNCE_MS = 800;

/**
 * Відсіює віджети, яких більше немає в реєстрі або які не дозволені ролі.
 * Без цього видалений у деплої тип віджета ламав би дашборд усім, хто
 * встиг його додати.
 */
function sanitize(widgets: unknown, role: AdminRole): WidgetInstance[] {
  if (!Array.isArray(widgets)) return [];
  const seen = new Set<string>();
  return widgets
    .filter((w): w is WidgetInstance => {
      if (!w || typeof w !== "object") return false;
      const c = w as Partial<WidgetInstance>;
      if (typeof c.id !== "string" || typeof c.type !== "string") return false;
      if (!isKnownWidget(c.type)) return false;
      if (!WIDGET_REGISTRY[c.type as WidgetType].roles.includes(role)) return false;
      if (!WIDGET_SIZES.includes(c.size as WidgetSize)) return false;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .slice(0, MAX_WIDGETS)
    .map((w, i) => ({ ...w, order: i }));
}

export function useDashboardLayout(userId: string | undefined, role: AdminRole) {
  const [widgets, setWidgets] = useState<WidgetInstance[]>(() => defaultLayout(role).widgets);
  const [loaded, setLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<WidgetInstance[] | null>(null);

  // Спершу локальний кеш (миттєве відмальовування), потім серверна копія.
  useEffect(() => {
    let alive = true;

    try {
      const raw = localStorage.getItem(cacheKey(userId));
      if (raw) {
        const cached = sanitize((JSON.parse(raw) as DashboardLayout)?.widgets, role);
        if (cached.length) setWidgets(cached);
      }
    } catch {
      /* зіпсований кеш — ігноруємо */
    }

    fetch("/api/admin/me/dashboard-layout")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data?.layout) return;
        const server = sanitize(data.layout.widgets, role);
        if (server.length) setWidgets(server);
      })
      .catch(() => {
        /* офлайн — лишаємо локальний стан */
      })
      .finally(() => alive && setLoaded(true));

    return () => {
      alive = false;
    };
  }, [userId, role]);

  const persist = useCallback(
    (next: WidgetInstance[]) => {
      try {
        localStorage.setItem(cacheKey(userId), JSON.stringify({ version: LAYOUT_VERSION, widgets: next }));
      } catch {
        /* приватний режим */
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        fetch("/api/admin/me/dashboard-layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: LAYOUT_VERSION, widgets: next }),
        })
          .then((r) => {
            // Свідомо не відкочуємо стан: користувач бачить свою розкладку,
            // а невдалий запис відкладаємо до появи мережі.
            if (!r.ok) pendingRef.current = next;
            else pendingRef.current = null;
          })
          .catch(() => {
            pendingRef.current = next;
          });
      }, SAVE_DEBOUNCE_MS);
    },
    [userId]
  );

  // Повторна спроба збереження, коли зв'язок повернувся.
  useEffect(() => {
    const replay = () => {
      const pending = pendingRef.current;
      if (!pending) return;
      fetch("/api/admin/me/dashboard-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: LAYOUT_VERSION, widgets: pending }),
      })
        .then((r) => {
          if (r.ok) pendingRef.current = null;
        })
        .catch(() => {
          /* далі чекаємо */
        });
    };
    window.addEventListener("online", replay);
    return () => window.removeEventListener("online", replay);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const update = useCallback(
    (next: WidgetInstance[]) => {
      const normalized = next.map((w, i) => ({ ...w, order: i }));
      setWidgets(normalized);
      persist(normalized);
    },
    [persist]
  );

  const addWidget = useCallback(
    (type: WidgetType) => {
      const def = WIDGET_REGISTRY[type];
      if (!def || !def.roles.includes(role)) return;
      setWidgets((prev) => {
        if (prev.length >= MAX_WIDGETS) return prev;
        const next = [
          ...prev,
          { id: `${type}-${Date.now().toString(36)}`, type, size: def.defaultSize, order: prev.length },
        ];
        persist(next);
        return next;
      });
    },
    [role, persist]
  );

  const removeWidget = useCallback(
    (id: string) => {
      setWidgets((prev) => {
        const next = prev.filter((w) => w.id !== id).map((w, i) => ({ ...w, order: i }));
        persist(next);
        return next;
      });
    },
    [persist]
  );

  /** Наступний дозволений розмір по колу — простіше за вільний ресайз. */
  const cycleSize = useCallback(
    (id: string) => {
      setWidgets((prev) => {
        const next = prev.map((w) => {
          if (w.id !== id) return w;
          const allowed = WIDGET_REGISTRY[w.type].allowedSizes;
          const idx = allowed.indexOf(w.size);
          return { ...w, size: allowed[(idx + 1) % allowed.length] };
        });
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      setWidgets((prev) => {
        const idx = prev.findIndex((w) => w.id === id);
        const target = idx + direction;
        if (idx === -1 || target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[target]] = [next[target], next[idx]];
        const normalized = next.map((w, i) => ({ ...w, order: i }));
        persist(normalized);
        return normalized;
      });
    },
    [persist]
  );

  const reset = useCallback(() => {
    const next = defaultLayout(role).widgets;
    setWidgets(next);
    persist(next);
  }, [role, persist]);

  return { widgets, loaded, update, addWidget, removeWidget, cycleSize, move, reset };
}
