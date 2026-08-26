"use client";

/**
 * Помічає новий деплой і перезавантажує сторінку сам.
 *
 * Навіщо. У PWA застосунок не «відкривають» — у нього повертаються: вікно
 * standalone живе днями. App Router у ньому продовжує ходити по чанках тієї
 * збірки, з якою стартував, тож після деплою людина ще довго бачить старий
 * код. Єдиним способом отримати зміни було вийти із застосунку й зайти
 * знову — і саме на це скаржилися: правка вже на проді, а на планшеті її
 * немає.
 *
 * Як. Порівнюємо ідентифікатор деплою, з яким СТАРТУВАВ цей документ, із
 * тим, що зараз віддає сервер. Свій беремо з адрес уже завантажених чанків:
 * Next дописує до них `?dpl=…`, тож нічого зашивати на етапі збірки не
 * треба, і не буває розбіжності «в бандлі одне, на сервері інше».
 *
 * Коли перезавантажуємо. Не будь-якої миті: висмикнути сторінку з-під
 * пальців — це втратити недописану нотатку. Робимо це у двох безпечних
 * точках, і обидві збігаються з тим, як застосунком користуються:
 *   • людина повернулась у застосунок (вкладка знову видима) — рівно той
 *     момент, коли вона й так робила це руками;
 *   • перейшла на іншу вкладку кабінету — природна пауза між справами.
 *
 * Захист від циклу. Мітка в sessionStorage: заради одного деплою
 * перезавантажуємось один раз. Інакше чанк, що лишився в кеші від
 * попередньої збірки, міг би вічно виглядати як «застаріла сторінка».
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Як часто питати сервер, поки застосунок відкритий. */
const CHECK_MS = 5 * 60_000;
const RELOADED_KEY = "budvik.deploy.reloaded";

/** З якою збіркою стартував цей документ — за адресами його ж чанків. */
function runningDeployment(): string | null {
  try {
    for (const entry of performance.getEntriesByType("resource")) {
      const m = /[?&]dpl=([A-Za-z0-9_-]+)/.exec(entry.name);
      if (m) return m[1];
    }
  } catch {
    // performance може бути урізаний — тоді покладаємось на перше значення
    // з сервера (див. нижче).
  }
  return null;
}

export default function DeploymentWatcher() {
  const pathname = usePathname();
  /** Збірка цього документа. null, поки не дізналися. */
  const mine = useRef<string | null>(null);
  /** Сервер уже пішов уперед — чекаємо безпечної миті. */
  const stale = useRef(false);

  useEffect(() => {
    mine.current = runningDeployment();
    let alive = true;

    const reloadIfStale = () => {
      if (!stale.current) return;
      const id = mine.current;
      try {
        // Заради одного деплою перезавантажуємось рівно раз.
        if (id && window.sessionStorage.getItem(RELOADED_KEY) === id) return;
        if (id) window.sessionStorage.setItem(RELOADED_KEY, id);
      } catch {
        // Приватний режим — лишаємось без захисту від повтору, але й тоді
        // після перезавантаження ідентифікатори збігатимуться.
      }
      window.location.reload();
    };

    const check = async () => {
      try {
        const res = await fetch("/api/build", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const { id } = (await res.json()) as { id?: string };
        if (!id || !alive) return;
        // Не змогли прочитати свою збірку з чанків — приймаємо перше, що
        // сказав сервер, за свою: далі порівнювати вже є з чим.
        if (!mine.current) {
          mine.current = id;
          return;
        }
        if (id !== mine.current) stale.current = true;
      } catch {
        // Немає зв'язку — просто спробуємо наступного разу.
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Спершу перезавантажуємось, якщо вже знаємо про новий деплой:
      // повернення в застосунок — найбезпечніша мить.
      reloadIfStale();
      void check().then(reloadIfStale);
    };

    void check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void check(), CHECK_MS);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  // Перехід між вкладками кабінету — друга безпечна мить. Ефект окремий,
  // бо залежить від шляху, а слухачі вище вішаються один раз.
  useEffect(() => {
    if (!stale.current) return;
    const id = mine.current;
    try {
      if (id && window.sessionStorage.getItem(RELOADED_KEY) === id) return;
      if (id) window.sessionStorage.setItem(RELOADED_KEY, id);
    } catch {
      // див. вище
    }
    window.location.reload();
  }, [pathname]);

  return null;
}
